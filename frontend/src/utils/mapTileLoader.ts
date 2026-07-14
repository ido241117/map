import maplibregl from 'maplibre-gl';

/** Custom scheme so MapLibre routes MVT fetches through our queue + retry. */
export const MAP_MVT_PROTOCOL = 'mapmvt';

/** Steady-state parallel tile fetches through Cloudflare (avoid ~29-at-once). */
const IDLE_CONCURRENCY = 6;
/** While the user is panning/zooming — keep some progress without flooding. */
const MOVING_CONCURRENCY = 3;
/** When recent tile latency looks bad — ease off further. */
const SLOW_CONCURRENCY = 3;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 250;
/** After moveend, wait this long before treating the map as idle (debounce). */
const MOVE_SETTLE_MS = 150;
/** Rolling latency window: median above this → "slow" mode. */
const SLOW_LATENCY_MS = 2000;
const LATENCY_SAMPLES = 12;

export type TileLoaderStatus = {
  inflight: number;
  interacting: boolean;
  slow: boolean;
};

type QueueWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
  signal: AbortSignal;
  onAbort: () => void;
};

let registered = false;
let interacting = false;
let settleTimer: number | null = null;
let limit = IDLE_CONCURRENCY;
let active = 0;
let inflight = 0;
let slow = false;
const waiters: QueueWaiter[] = [];
const moveWaiters = new Set<() => void>();
const latencyMs: number[] = [];
const statusListeners = new Set<(status: TileLoaderStatus) => void>();

function emitStatus() {
  const status: TileLoaderStatus = { inflight, interacting, slow };
  for (const listener of statusListeners) listener(status);
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function recomputeLimit() {
  const next = interacting ? MOVING_CONCURRENCY : slow ? SLOW_CONCURRENCY : IDLE_CONCURRENCY;
  if (next === limit) return;
  limit = next;
  pumpQueue();
}

function recordLatency(ms: number) {
  latencyMs.push(ms);
  if (latencyMs.length > LATENCY_SAMPLES) latencyMs.shift();
  const nextSlow = latencyMs.length >= 4 && median(latencyMs) >= SLOW_LATENCY_MS;
  if (nextSlow !== slow) {
    slow = nextSlow;
    recomputeLimit();
    emitStatus();
  }
}

function abortError() {
  return new DOMException('Aborted', 'AbortError');
}

function pumpQueue() {
  while (active < limit && waiters.length) {
    const waiter = waiters.shift()!;
    waiter.signal.removeEventListener('abort', waiter.onAbort);
    if (waiter.signal.aborted) {
      waiter.reject(abortError());
      continue;
    }
    active += 1;
    waiter.resolve();
  }
}

function acquireSlot(signal: AbortSignal): Promise<() => void> {
  if (signal.aborted) return Promise.reject(abortError());

  const release = () => {
    active = Math.max(0, active - 1);
    pumpQueue();
  };

  if (active < limit) {
    active += 1;
    return Promise.resolve(release);
  }

  return new Promise<() => void>((resolve, reject) => {
    const waiter: QueueWaiter = {
      signal,
      resolve: () => resolve(release),
      reject,
      onAbort: () => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(abortError());
      },
    };
    waiters.push(waiter);
    signal.addEventListener('abort', waiter.onAbort, { once: true });
  });
}

function wakeMoveWaiters() {
  for (const wake of moveWaiters) wake();
  moveWaiters.clear();
}

function waitWhileInteracting(signal: AbortSignal): Promise<void> {
  if (!interacting || signal.aborted) {
    if (signal.aborted) return Promise.reject(abortError());
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      moveWaiters.delete(wake);
      reject(abortError());
    };
    const wake = () => {
      signal.removeEventListener('abort', onAbort);
      moveWaiters.delete(wake);
      if (signal.aborted) reject(abortError());
      else if (interacting) {
        void waitWhileInteracting(signal).then(resolve, reject);
      } else {
        resolve();
      }
    };
    moveWaiters.add(wake);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function shouldRetryStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function toHttpUrl(protocolUrl: string) {
  const prefix = `${MAP_MVT_PROTOCOL}://`;
  if (protocolUrl.startsWith(prefix)) {
    return protocolUrl.slice(prefix.length);
  }
  return protocolUrl;
}

export function wrapMapMvtUrl(httpUrl: string) {
  if (httpUrl.startsWith(`${MAP_MVT_PROTOCOL}://`)) return httpUrl;
  return `${MAP_MVT_PROTOCOL}://${httpUrl}`;
}

export function notifyMapInteractionStart() {
  interacting = true;
  if (settleTimer != null) {
    window.clearTimeout(settleTimer);
    settleTimer = null;
  }
  recomputeLimit();
  emitStatus();
}

export function notifyMapInteractionEnd() {
  if (settleTimer != null) window.clearTimeout(settleTimer);
  settleTimer = window.setTimeout(() => {
    settleTimer = null;
    interacting = false;
    recomputeLimit();
    emitStatus();
    wakeMoveWaiters();
  }, MOVE_SETTLE_MS);
}

export function subscribeTileLoaderStatus(listener: (status: TileLoaderStatus) => void) {
  statusListeners.add(listener);
  listener({ inflight, interacting, slow });
  return () => {
    statusListeners.delete(listener);
  };
}

async function fetchTileOnce(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, {
    method: 'GET',
    signal,
    credentials: 'same-origin',
  });

  if (response.status === 204) {
    return new ArrayBuffer(0);
  }

  if (!response.ok) {
    const error = new Error(`Tile HTTP ${response.status}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  return response.arrayBuffer();
}

async function fetchTileWithRetry(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (signal.aborted) throw abortError();
    const started = performance.now();
    try {
      const data = await fetchTileOnce(url, signal);
      recordLatency(performance.now() - started);
      return data;
    } catch (error) {
      lastError = error;
      if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        throw abortError();
      }
      const status = (error as { status?: number })?.status;
      const retryable = status == null || shouldRetryStatus(status);
      if (!retryable || attempt === MAX_RETRIES) break;
      const backoff = BASE_BACKOFF_MS * 2 ** attempt;
      await sleep(backoff, signal);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Tile fetch failed');
}

async function loadMapMvt(
  requestParameters: { url: string },
  abortController: AbortController,
): Promise<{ data: ArrayBuffer }> {
  const signal = abortController.signal;
  const httpUrl = toHttpUrl(requestParameters.url);

  // Debounce continuous pan/zoom: don't start until camera settles (or request aborts).
  await waitWhileInteracting(signal);

  const release = await acquireSlot(signal);
  inflight += 1;
  emitStatus();
  try {
    // If user started moving again while we waited for a slot, defer once more.
    await waitWhileInteracting(signal);
    const data = await fetchTileWithRetry(httpUrl, signal);
    return { data };
  } finally {
    inflight = Math.max(0, inflight - 1);
    emitStatus();
    release();
  }
}

/** Register once for the app lifetime. Safe to call repeatedly. */
export function ensureMapMvtProtocol() {
  if (registered) return;
  maplibregl.addProtocol(MAP_MVT_PROTOCOL, loadMapMvt);
  // Basemap (CARTO) is separate from the tunnel — keep a modest parallel cap.
  maplibregl.setMaxParallelImageRequests(8);
  registered = true;
}
