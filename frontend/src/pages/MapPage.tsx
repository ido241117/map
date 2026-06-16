import { useEffect, useMemo, useState } from 'react';
import { Alert, AutoComplete, Card, Col, Input, InputNumber, Row, Select, Space, Spin, Typography } from 'antd';
import { MapContainer, TileLayer } from 'react-leaflet';
import { fetchParcelAddressSuggest, fetchStats, type ParcelQuery } from '../api';
import { MapDataLayer } from '../components/MapDataLayer';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { PARCEL_SOURCE_OPTIONS, type ParcelAddressSuggestion, type ParcelListResponse, type ParcelSource, type Stats } from '../types';

const HCM_CENTER: [number, number] = [10.7769, 106.7009];

function formatNumber(value: number | string | undefined) {
  return new Intl.NumberFormat('vi-VN').format(Number(value || 0));
}

export function MapPage() {
  const [dataSource, setDataSource] = useState<ParcelSource>('land_parcels');
  const [stats, setStats] = useState<Stats | null>(null);
  const [filters, setFilters] = useState<
    Omit<ParcelQuery, 'minLat' | 'maxLat' | 'minLng' | 'maxLng' | 'includeGeometry' | 'source'>
  >({});
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebouncedValue(searchInput, 400);
  const debouncedSuggest = useDebouncedValue(searchInput, 250);
  const [suggestions, setSuggestions] = useState<ParcelAddressSuggestion[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [mapResult, setMapResult] = useState<ParcelListResponse | null>(null);
  const [mapZoom, setMapZoom] = useState(12);
  const [error, setError] = useState('');

  const activeFilters = useMemo(
    () => ({ ...filters, source: dataSource, q: debouncedSearch || undefined }),
    [filters, debouncedSearch, dataSource],
  );

  const filtersVersion = useMemo(
    () => JSON.stringify(activeFilters),
    [activeFilters],
  );

  useEffect(() => {
    fetchStats(dataSource)
      .then(setStats)
      .catch((err: Error) => setError(err.message));
  }, [dataSource]);

  useEffect(() => {
    const query = debouncedSuggest.trim();
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }

    const controller = new AbortController();
    setSuggestLoading(true);
    fetchParcelAddressSuggest({ source: dataSource, q: query, limit: 10 }, controller.signal)
      .then((result) => setSuggestions(result.items))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setSuggestions([]);
      })
      .finally(() => setSuggestLoading(false));

    return () => controller.abort();
  }, [debouncedSuggest, dataSource]);

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

  const handleSourceChange = (value: ParcelSource) => {
    setDataSource(value);
    resetFilters();
    setMapResult(null);
    setError('');
  };

  const statusText = mapResult
    ? debouncedSearch
      ? mapResult.truncated
        ? `${mapResult.returned}+ kết quả tìm địa chỉ`
        : `${mapResult.returned} kết quả tìm địa chỉ`
      : mapResult.truncated
        ? `${mapResult.returned}+ thửa trong vùng nhìn (zoom ${mapZoom})`
        : `${mapResult.returned} thửa trong vùng nhìn (zoom ${mapZoom})`
    : debouncedSearch
      ? 'Đang tìm địa chỉ...'
      : 'Di chuyển bản đồ để tải dữ liệu';

  const suggestOptions = useMemo(
    () =>
      suggestions.map((item) => ({
        value: item.full_address || item.address,
        label: (
          <div className="address-suggest-option">
            <div>{item.full_address || item.address}</div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {[item.ward, item.district].filter(Boolean).join(', ')}
              {item.property_code ? ` · Mã ${item.property_code}` : ''}
            </Typography.Text>
          </div>
        ),
      })),
    [suggestions],
  );

  const showInitialLoading = !mapResult && !error;

  return (
    <div className="map-page">
      <Card size="small" className="map-filters-card">
        <Row gutter={[12, 12]} align="middle">
          <Col xs={24} md={6} lg={4}>
            <Select
              value={dataSource}
              onChange={handleSourceChange}
              style={{ width: '100%' }}
              options={PARCEL_SOURCE_OPTIONS}
            />
          </Col>
          <Col xs={24} md={8} lg={6}>
            <AutoComplete
              value={searchInput}
              options={suggestOptions}
              onSearch={setSearchInput}
              onChange={setSearchInput}
              style={{ width: '100%' }}
              notFoundContent={suggestLoading ? <Spin size="small" /> : 'Không có gợi ý'}
            >
              <Input allowClear placeholder="Tìm địa chỉ, phường, quận, mã thửa..." />
            </AutoComplete>
          </Col>
          <Col xs={12} md={4} lg={3}>
            <Select
              allowClear
              placeholder="Quận/huyện"
              style={{ width: '100%' }}
              value={filters.district || undefined}
              onChange={(value) => updateFilters({ district: value, ward: undefined })}
              options={stats?.districts.map((item) => ({
                value: item.district,
                label: `${item.district} (${item.count})`,
              }))}
            />
          </Col>
          <Col xs={12} md={4} lg={3}>
            <Select
              allowClear
              placeholder="Phường/xã"
              style={{ width: '100%' }}
              value={filters.ward || undefined}
              onChange={(value) => updateFilters({ ward: value })}
              options={wards.map((item) => ({
                value: item.ward,
                label: `${item.ward} (${item.count})`,
              }))}
            />
          </Col>
          <Col xs={12} md={4} lg={3}>
            <Select
              allowClear
              placeholder="Loại đất"
              style={{ width: '100%' }}
              value={filters.landType || undefined}
              onChange={(value) => updateFilters({ landType: value })}
              options={stats?.landTypes.map((item) => ({
                value: item.planning_land_type,
                label: `${item.planning_land_type} (${item.count})`,
              }))}
            />
          </Col>
          <Col xs={6} md={2} lg={2}>
            <InputNumber
              min={0}
              placeholder="Từ m²"
              style={{ width: '100%' }}
              value={filters.minArea ? Number(filters.minArea) : undefined}
              onChange={(value) => updateFilters({ minArea: value ? String(value) : undefined })}
            />
          </Col>
          <Col xs={6} md={2} lg={2}>
            <InputNumber
              min={0}
              placeholder="Đến m²"
              style={{ width: '100%' }}
              value={filters.maxArea ? Number(filters.maxArea) : undefined}
              onChange={(value) => updateFilters({ maxArea: value ? String(value) : undefined })}
            />
          </Col>
          <Col xs={24} md={4} lg={5}>
            <Space wrap>
              <Typography.Text type="secondary">{statusText}</Typography.Text>
              <Typography.Link onClick={resetFilters}>Xóa lọc</Typography.Link>
            </Space>
          </Col>
        </Row>
        {error ? <Alert type="error" message={error} showIcon style={{ marginTop: 12 }} /> : null}
      </Card>

      <div className="map-container-wrap">
        {showInitialLoading ? (
          <div className="map-loading">
            <Spin />
          </div>
        ) : null}
        <MapContainer
          center={HCM_CENTER}
          zoom={12}
          className="map"
          preferCanvas
          zoomAnimation={false}
          fadeAnimation={false}
          markerZoomAnimation={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; CARTO'
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            updateWhenIdle
            updateWhenZooming={false}
          />
          <MapDataLayer
            filters={activeFilters}
            filtersVersion={filtersVersion}
            onUpdate={(result, zoom) => {
              setMapResult(result);
              setMapZoom(zoom);
            }}
            onError={setError}
            fitToResults={Boolean(debouncedSearch)}
          />
        </MapContainer>
      </div>

      <div className="map-metrics">
        <span>Đang hiển thị: <strong>{formatNumber(mapResult?.returned || 0)}</strong></span>
        <span>TB diện tích: <strong>{formatNumber(stats?.summary.avg_area)} m²</strong></span>
        <span>Tổng thửa: <strong>{formatNumber(stats?.summary.parcel_count || 0)}</strong></span>
      </div>
    </div>
  );
}
