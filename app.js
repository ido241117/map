const HCM_CENTER = [10.7769, 106.7009];
const CSV_PATH = "./scan/crawler/data/hcm_land_data.csv";

const map = L.map("map", {
  preferCanvas: true,
  zoomControl: true,
  worldCopyJump: true,
  fadeAnimation: false,
  markerZoomAnimation: false,
  zoomAnimation: false,
  inertia: false,
}).setView(HCM_CENTER, 12);

L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  maxZoom: 20,
  minZoom: 0,
  subdomains: "abcd",
  keepBuffer: 1,
  updateWhenIdle: true,
  updateWhenZooming: false,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
}).addTo(map);

map.createPane("parcelPane");
map.getPane("parcelPane").style.zIndex = 350;
map.getPane("parcelPane").style.pointerEvents = "none";

const pointRenderer = L.canvas({ padding: 0.25 });
const parcelRenderer = L.canvas({ padding: 0.35, pane: "parcelPane" });
const pointLayer = L.layerGroup().addTo(map);
const parcelOutlineLayer = L.layerGroup().addTo(map);
let selectedParcelLayer = null;
let selectedPoint = null;

function parseLandRow(row) {
  const lat = Number(row.latitude);
  const lng = Number(row.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    ...row,
    latitude: lat,
    longitude: lng,
    total_area: Number(row.total_area) || 0,
  };
}

function loadPreviewPoints() {
  Papa.parse(CSV_PATH, {
    header: true,
    download: true,
    skipEmptyLines: true,
    complete: ({ data }) => {
      const rows = data.map(parseLandRow).filter(Boolean);
      console.info(`Loaded ${rows.length} land rows`);
      renderParcelOutlines(rows);
      renderPoints(rows);

      if (rows.length) {
        const bounds = L.latLngBounds(rows.map((row) => [row.latitude, row.longitude]));
        map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });
      }
    },
    error: (error) => {
      console.error(`Không đọc được ${CSV_PATH}:`, error);
    },
  });
}

function renderPoints(rows) {
  pointLayer.clearLayers();

  renderInChunks(rows, 500, (row) => {
    const marker = L.circleMarker([row.latitude, row.longitude], {
      renderer: pointRenderer,
      radius: 3,
      stroke: true,
      color: "#0f172a",
      weight: 0.5,
      fillColor: "#0f766e",
      fillOpacity: 0.62,
    });

    marker.bindPopup(buildPopupHtml(row), { maxWidth: 320 });
    marker.on("click", () => selectParcel(row, marker));
    marker.bindTooltip(row.property_code || "Thửa đất", {
      direction: "top",
      offset: [0, -6],
      opacity: 0.92,
    });
    marker.addTo(pointLayer);
  });
}

function renderParcelOutlines(rows) {
  parcelOutlineLayer.clearLayers();

  renderInChunks(rows, 250, (row) => {
    const polygon = buildParcelPolygon(row, {
      interactive: false,
      color: "#334155",
      fillOpacity: 0,
      opacity: 0.42,
      weight: 0.7,
    });

    if (polygon) {
      polygon.addTo(parcelOutlineLayer);
    }
  });
}

function renderInChunks(rows, batchSize, renderRow) {
  let index = 0;

  function step() {
    const end = Math.min(index + batchSize, rows.length);
    for (; index < end; index += 1) {
      renderRow(rows[index]);
    }

    if (index < rows.length) {
      requestAnimationFrame(step);
    }
  }

  requestAnimationFrame(step);
}

function selectParcel(row, marker) {
  if (selectedParcelLayer) {
    selectedParcelLayer.remove();
    selectedParcelLayer = null;
  }

  if (selectedPoint) {
    selectedPoint.setStyle({
      radius: 5,
      color: "#ffffff",
      weight: 1,
      fillColor: "#0f766e",
      fillOpacity: 0.78,
    });
  }

  marker.openPopup();

  const polygon = buildParcelPolygon(row, {
    interactive: false,
    color: "#e11d48",
    fillColor: "#fb7185",
    fillOpacity: 0.25,
    weight: 2,
  });

  if (polygon) {
    selectedParcelLayer = polygon.addTo(map);
  }

  selectedPoint = marker;
  selectedPoint.setStyle({
    radius: 9,
    color: "#e11d48",
    weight: 2,
    fillColor: "#ffffff",
    fillOpacity: 0.95,
  });
}

function buildParcelPolygon(row, style = {}) {
  if (!row.geometry_json) return null;

  try {
    const geometry = JSON.parse(row.geometry_json);
    if (geometry.type !== "MultiPolygon") return null;

    const latLngs = geometry.coordinates.map((polygon) =>
      polygon.map((ring) => ring.map(([lng, lat]) => [lat, lng]))
    );

    return L.polygon(latLngs, {
      renderer: parcelRenderer,
      pane: "parcelPane",
      ...style,
    });
  } catch (error) {
    console.warn("Không parse được geometry_json:", error);
    return null;
  }
}

function buildPopupHtml(row) {
  return `
    <div class="parcel-popup">
      <strong>${escapeHtml(row.address || row.property_code || "Thửa đất")}</strong>
      <div>Mã: ${escapeHtml(row.property_code || "")}</div>
      <div>Diện tích: ${formatNumber(row.total_area)} m2</div>
      <div>Loại đất: ${escapeHtml(row.planning_land_type || "")}</div>
      <div>${escapeHtml([row.ward, row.district].filter(Boolean).join(", "))}</div>
    </div>
  `;
}

function formatNumber(value) {
  return new Intl.NumberFormat("vi-VN").format(Number(value) || 0);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

map.on("popupclose", () => {
  if (selectedParcelLayer) {
    selectedParcelLayer.remove();
    selectedParcelLayer = null;
  }
  if (selectedPoint) {
    selectedPoint.setStyle({
      radius: 5,
      color: "#ffffff",
      weight: 1,
      fillColor: "#0f766e",
      fillOpacity: 0.78,
    });
    selectedPoint = null;
  }
});

loadPreviewPoints();
