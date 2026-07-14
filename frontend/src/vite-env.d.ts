/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** Serve/request MVT thửa đất từ zoom này. */
  readonly LAND_PARCELS_MIN_ZOOM?: string;
  /** Hiện lớp thửa đất / geometry từ zoom này. */
  readonly PARCELS_GEOMETRY_MIN_ZOOM?: string;
  /** Hiện số nhà từ zoom này. */
  readonly HOUSE_NO_LABEL_MIN_ZOOM?: string;
  /** Hiện/load QHSDD từ zoom này. */
  readonly QHSDD_MIN_ZOOM?: string;
  /** Label QHSDD từ zoom này. */
  readonly QHSDD_LABEL_MIN_ZOOM?: string;
  /** Hiện lớp lộ giới từ zoom này. */
  readonly HIGHWAYS_MIN_ZOOM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
