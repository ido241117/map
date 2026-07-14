/** Read Vite env int at module load (rebuild/restart after .env change). */
export function viteEnvInt(name: string, fallback: number): number {
  const raw = import.meta.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}
