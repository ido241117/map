import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Layers, Search, SlidersHorizontal } from 'lucide-react';
import { MapContainer, TileLayer } from 'react-leaflet';
import { fetchStats, type ParcelQuery } from './api';
import { MapDataLayer } from './components/MapDataLayer';
import { useDebouncedValue } from './hooks/useDebouncedValue';
import type { ParcelListResponse, Stats } from './types';

const HCM_CENTER: [number, number] = [10.7769, 106.7009];

function formatNumber(value: number | string | undefined) {
  return new Intl.NumberFormat('vi-VN').format(Number(value || 0));
}

function App() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [filters, setFilters] = useState<Omit<ParcelQuery, 'minLat' | 'maxLat' | 'minLng' | 'maxLng' | 'includeGeometry'>>({});
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebouncedValue(searchInput, 400);
  const [mapResult, setMapResult] = useState<ParcelListResponse | null>(null);
  const [mapZoom, setMapZoom] = useState(12);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const activeFilters = useMemo(
    () => ({ ...filters, q: debouncedSearch || undefined }),
    [filters, debouncedSearch],
  );

  useEffect(() => {
    fetchStats()
      .then(setStats)
      .catch((err: Error) => setError(err.message));
  }, []);

  const wards = useMemo(() => {
    if (!stats) return [];
    return stats.wards.filter((item) => !filters.district || item.district === filters.district);
  }, [filters.district, stats]);

  const updateFilters = (patch: Partial<typeof filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
  };

  const resetFilters = () => {
    setSearchInput('');
    setFilters({});
  };

  const statusText = loading
    ? 'Đang tải dữ liệu...'
    : mapResult
      ? mapResult.truncated
        ? `${mapResult.returned}+ thửa trong vùng nhìn (zoom ${mapZoom})`
        : `${mapResult.returned} thửa trong vùng nhìn (zoom ${mapZoom})`
      : 'Di chuyển bản đồ để tải dữ liệu';

  return (
    <main className={`app ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <Layers size={22} />
          </div>
          <div>
            <h1>HCM Land</h1>
            <p>{formatNumber(stats?.summary.parcel_count || 0)} thửa đất trong Postgres</p>
          </div>
        </div>

        <section className="panel">
          <div className="panel-title">
            <Search size={18} />
            <h2>Tìm kiếm</h2>
          </div>
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Mã thửa, UUID hoặc địa chỉ"
          />
        </section>

        <section className="panel">
          <div className="panel-title">
            <SlidersHorizontal size={18} />
            <h2>Bộ lọc</h2>
          </div>
          <label>
            Quận/huyện
            <select
              value={filters.district || ''}
              onChange={(event) => updateFilters({ district: event.target.value, ward: '' })}
            >
              <option value="">Tất cả</option>
              {stats?.districts.map((item) => (
                <option key={item.district} value={item.district}>
                  {item.district} ({item.count})
                </option>
              ))}
            </select>
          </label>

          <label>
            Phường/xã
            <select
              value={filters.ward || ''}
              onChange={(event) => updateFilters({ ward: event.target.value })}
            >
              <option value="">Tất cả</option>
              {wards.map((item) => (
                <option key={`${item.district}-${item.ward}`} value={item.ward}>
                  {item.ward} ({item.count})
                </option>
              ))}
            </select>
          </label>

          <label>
            Loại đất
            <select
              value={filters.landType || ''}
              onChange={(event) => updateFilters({ landType: event.target.value })}
            >
              <option value="">Tất cả</option>
              {stats?.landTypes.map((item) => (
                <option key={item.planning_land_type} value={item.planning_land_type}>
                  {item.planning_land_type} ({item.count})
                </option>
              ))}
            </select>
          </label>

          <div className="range-row">
            <label>
              Từ m²
              <input
                type="number"
                min="0"
                value={filters.minArea || ''}
                onChange={(event) => updateFilters({ minArea: event.target.value })}
              />
            </label>
            <label>
              Đến m²
              <input
                type="number"
                min="0"
                value={filters.maxArea || ''}
                onChange={(event) => updateFilters({ maxArea: event.target.value })}
              />
            </label>
          </div>

          <button type="button" onClick={resetFilters}>
            Xóa lọc
          </button>
        </section>

        <section className="metric-grid">
          <div>
            <span>Đang hiển thị</span>
            <strong>{formatNumber(mapResult?.returned || 0)}</strong>
          </div>
          <div>
            <span>TB diện tích</span>
            <strong>{formatNumber(stats?.summary.avg_area)} m²</strong>
          </div>
        </section>

        <p className="hint">
          Dữ liệu tải theo vùng bản đồ. Zoom ≥ {14} để xem ranh thửa, zoom thấp hơn hiển thị điểm.
        </p>

        {error ? <div className="error">{error}</div> : null}
      </aside>

      <section className="map-shell">
        <button
          className="sidebar-toggle"
          type="button"
          onClick={() => setSidebarOpen((open) => !open)}
          aria-label={sidebarOpen ? 'Ẩn bộ lọc' : 'Hiện bộ lọc'}
          title={sidebarOpen ? 'Ẩn bộ lọc' : 'Hiện bộ lọc'}
        >
          {sidebarOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
        </button>

        <div className="status-bar">
          <span>{statusText}</span>
          <span>API: /api → :3001</span>
        </div>

        <MapContainer center={HCM_CENTER} zoom={12} className="map" preferCanvas>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; CARTO'
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          />
          <MapDataLayer
            filters={activeFilters}
            onUpdate={(result, zoom) => {
              setMapResult(result);
              setMapZoom(zoom);
            }}
            onLoading={setLoading}
            onError={setError}
            fitToResults={Boolean(debouncedSearch)}
          />
        </MapContainer>
      </section>
    </main>
  );
}

export default App;
