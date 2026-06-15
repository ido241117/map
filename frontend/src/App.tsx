import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Layers, Search, SlidersHorizontal } from 'lucide-react';
import { MapContainer, Polygon, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import { fetchParcels, fetchStats, type ParcelQuery } from './api';
import type { Parcel, Stats } from './types';

const HCM_CENTER: [number, number] = [10.7769, 106.7009];

function FitBounds({ parcels }: { parcels: Parcel[] }) {
  const map = useMap();

  useEffect(() => {
    if (!parcels.length) return;

    const bounds = L.latLngBounds(
      parcels.map((parcel) => [parcel.latitude, parcel.longitude]),
    );
    map.fitBounds(bounds, { padding: [32, 32], maxZoom: 16 });
  }, [map, parcels]);

  return null;
}

function geometryToLatLngs(geometry: GeoJSON.MultiPolygon) {
  return geometry.coordinates.map((polygon) =>
    polygon.map((ring) => ring.map(([lng, lat]) => [lat, lng] as [number, number])),
  );
}

function formatNumber(value: number | string | undefined) {
  return new Intl.NumberFormat('vi-VN').format(Number(value || 0));
}

function App() {
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [query, setQuery] = useState<ParcelQuery>({ limit: '300' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    fetchStats()
      .then(setStats)
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    setLoading(true);
    setError('');

    fetchParcels(query)
      .then(setParcels)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [query]);

  const wards = useMemo(() => {
    if (!stats) return [];
    return stats.wards.filter((item) => !query.district || item.district === query.district);
  }, [query.district, stats]);

  const updateQuery = (patch: ParcelQuery) => {
    setQuery((current) => ({ ...current, ...patch }));
  };

  const resetFilters = () => {
    setQuery({ limit: '300' });
  };

  return (
    <main className={`app ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <Layers size={22} />
          </div>
          <div>
            <h1>HCM Land</h1>
            <p>{stats?.summary.parcel_count || 0} thửa demo trong Postgres</p>
          </div>
        </div>

        <section className="panel">
          <div className="panel-title">
            <Search size={18} />
            <h2>Tìm kiếm</h2>
          </div>
          <input
            value={query.q || ''}
            onChange={(event) => updateQuery({ q: event.target.value })}
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
              value={query.district || ''}
              onChange={(event) => updateQuery({ district: event.target.value, ward: '' })}
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
              value={query.ward || ''}
              onChange={(event) => updateQuery({ ward: event.target.value })}
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
              value={query.landType || ''}
              onChange={(event) => updateQuery({ landType: event.target.value })}
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
              Từ m2
              <input
                type="number"
                min="0"
                value={query.minArea || ''}
                onChange={(event) => updateQuery({ minArea: event.target.value })}
              />
            </label>
            <label>
              Đến m2
              <input
                type="number"
                min="0"
                value={query.maxArea || ''}
                onChange={(event) => updateQuery({ maxArea: event.target.value })}
              />
            </label>
          </div>

          <label>
            Số kết quả
            <select
              value={query.limit || '300'}
              onChange={(event) => updateQuery({ limit: event.target.value })}
            >
              <option value="100">100</option>
              <option value="300">300</option>
              <option value="600">600</option>
              <option value="1000">1000</option>
              <option value="10000">10000</option>
            </select>
          </label>

          <button type="button" onClick={resetFilters}>
            Xóa lọc
          </button>
        </section>

        <section className="metric-grid">
          <div>
            <span>Đang hiển thị</span>
            <strong>{formatNumber(parcels.length)}</strong>
          </div>
          <div>
            <span>TB diện tích</span>
            <strong>{formatNumber(stats?.summary.avg_area)} m2</strong>
          </div>
        </section>

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
          <span>{loading ? 'Đang tải dữ liệu...' : `${parcels.length} thửa đất`}</span>
          <span>API: localhost:3001</span>
        </div>

        <MapContainer center={HCM_CENTER} zoom={12} className="map" preferCanvas>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; CARTO'
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          />
          <FitBounds parcels={parcels} />

          {parcels.map((parcel) => (
            <Polygon
              key={parcel.id}
              pathOptions={{
                color: '#14532d',
                fillColor: '#22c55e',
                fillOpacity: 0.28,
                opacity: 0.82,
                weight: 1,
              }}
              positions={geometryToLatLngs(parcel.geometry_json)}
            >
              <Popup maxWidth={320}>
                <div className="popup">
                  <strong>{parcel.address || parcel.property_code}</strong>
                  <span>Mã: {parcel.property_code}</span>
                  <span>Diện tích: {formatNumber(parcel.total_area)} m2</span>
                  <span>Loại đất: {parcel.planning_land_type}</span>
                  <span>
                    {parcel.ward}, {parcel.district}
                  </span>
                </div>
              </Popup>
            </Polygon>
          ))}
        </MapContainer>
      </section>
    </main>
  );
}

export default App;
