import { useEffect, useMemo, useState } from 'react';
import { Alert, AutoComplete, Card, Input, Select, Spin, Typography } from 'antd';
import { MapContainer, TileLayer } from 'react-leaflet';
import { fetchParcelAddressSuggest, fetchStats, type ParcelQuery } from '../api';
import { MapDataLayer } from '../components/MapDataLayer';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { PARCEL_SOURCE_OPTIONS, isParcelDataSource, isQhsddMapSource, type ParcelAddressSuggestion, type ParcelListResponse, type ParcelSource, type Stats } from '../types';

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
  const [mapFocus, setMapFocus] = useState<{
    lat: number;
    lng: number;
    zoom?: number;
    key: string;
  } | null>(null);

  const activeFilters = useMemo(
    () => ({ ...filters, source: dataSource, q: debouncedSearch || undefined }),
    [filters, debouncedSearch, dataSource],
  );

  const filtersVersion = useMemo(
    () => JSON.stringify(activeFilters),
    [activeFilters],
  );

  useEffect(() => {
    if (dataSource === 'property_buy_records' || isQhsddMapSource(dataSource)) {
      setStats(null);
      return;
    }
    fetchStats(dataSource)
      .then(setStats)
      .catch((err: Error) => setError(err.message));
  }, [dataSource]);

  useEffect(() => {
    const query = debouncedSuggest.trim();
    if (dataSource === 'property_buy_records' || isQhsddMapSource(dataSource)) {
      setSuggestions([]);
      return;
    }
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
    setMapFocus(null);
  };

  const handleAddressSelect = (value: string) => {
    setSearchInput(value);
    const item = suggestions.find(
      (suggestion) => (suggestion.full_address || suggestion.address) === value,
    );
    if (!item?.latitude || !item?.longitude) return;
    setMapFocus({
      lat: item.latitude,
      lng: item.longitude,
      zoom: 16,
      key: `${item.source}:${item.id}:${Date.now()}`,
    });
  };

  const handleSourceChange = (value: ParcelSource) => {
    setDataSource(value);
    resetFilters();
    setMapResult(null);
    setError('');
  };

  const isOsmSource = dataSource === 'osm_hcm';
  const isPropertyBuySource = dataSource === 'property_buy_records';
  const isQhsddSource = isQhsddMapSource(dataSource);
  const showsDistrictFilters = isParcelDataSource(dataSource);

  const statusText = mapResult
    ? debouncedSearch
      ? mapResult.truncated
        ? `${mapResult.returned}+ kết quả tìm kiếm`
        : `${mapResult.returned} kết quả tìm kiếm`
      : mapResult.mode === 'clusters'
        ? mapResult.truncated
          ? `${mapResult.returned}+ ô gom · ~${formatNumber(mapResult.cluster_parcels || 0)}+ thửa (zoom ${mapZoom})`
          : `${mapResult.returned} ô gom · ~${formatNumber(mapResult.cluster_parcels || 0)} thửa (zoom ${mapZoom})`
        : mapResult.truncated
          ? `${mapResult.returned}+ ${isPropertyBuySource ? 'tọa độ giao dịch' : isQhsddSource ? 'vùng QHSDD' : isOsmSource ? 'đối tượng' : 'thửa'} trong vùng nhìn (zoom ${mapZoom})`
          : `${mapResult.returned} ${isPropertyBuySource ? 'tọa độ giao dịch' : isQhsddSource ? 'vùng QHSDD' : isOsmSource ? 'đối tượng' : 'thửa'} trong vùng nhìn (zoom ${mapZoom})`
    : debouncedSearch
      ? 'Đang tìm kiếm...'
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
        <div className="map-filters-row">
          <Select
            className="map-filter-source"
            value={dataSource}
            onChange={handleSourceChange}
            options={PARCEL_SOURCE_OPTIONS}
          />
          <AutoComplete
            className="map-filter-search"
            value={searchInput}
            options={suggestOptions}
            onSearch={setSearchInput}
            onChange={setSearchInput}
            onSelect={handleAddressSelect}
            notFoundContent={suggestLoading ? <Spin size="small" /> : 'Không có gợi ý'}
          >
            <Input
              allowClear
              placeholder={
                isQhsddSource
                  ? 'Chế độ QHSDD — không hỗ trợ tìm kiếm'
                  : isOsmSource
                    ? 'Tìm tên địa điểm OSM...'
                    : 'Tìm địa chỉ, phường, quận, mã thửa...'
              }
              disabled={isQhsddSource}
            />
          </AutoComplete>
          {!isOsmSource && !isPropertyBuySource && showsDistrictFilters ? (
            <>
              <Select
                className="map-filter-district"
                value={filters.district ?? ''}
                onChange={(value) => updateFilters({ district: value || undefined, ward: undefined })}
                options={[
                  { value: '', label: 'Tất cả quận/huyện' },
                  ...(stats?.districts.map((item) => ({
                    value: item.district,
                    label: `${item.district} (${item.count})`,
                  })) ?? []),
                ]}
              />
              <Select
                className="map-filter-ward"
                value={filters.ward ?? ''}
                onChange={(value) => updateFilters({ ward: value || undefined })}
                options={[
                  { value: '', label: 'Tất cả phường/xã' },
                  ...wards.map((item) => ({
                    value: item.ward,
                    label: `${item.ward} (${item.count})`,
                  })),
                ]}
              />
            </>
          ) : isOsmSource ? (
            <>
              <Select
                className="map-filter-ward"
                value={filters.landType ?? ''}
                onChange={(value) => updateFilters({ landType: value || undefined })}
                options={[
                  { value: '', label: 'Tất cả loại OSM' },
                  ...(stats?.landTypes.map((item) => ({
                    value: item.planning_land_type,
                    label: `${item.planning_land_type} (${item.count})`,
                  })) ?? []),
                ]}
              />
            </>
          ) : null}
          <Typography.Text type="secondary" className="map-status-text" ellipsis>
            {statusText}
          </Typography.Text>
        </div>
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
            focusTarget={mapFocus}
          />
        </MapContainer>
      </div>

      <div className="map-metrics">
        <span>
          Đang hiển thị:{' '}
          <strong>
            {mapResult?.mode === 'clusters'
              ? `${formatNumber(mapResult.returned)} ô`
              : formatNumber(mapResult?.returned || 0)}
          </strong>
          {mapResult?.mode === 'clusters' && mapResult.cluster_parcels ? (
            <> · ~<strong>{formatNumber(mapResult.cluster_parcels)}</strong> thửa</>
          ) : null}
        </span>
        {isPropertyBuySource ? (
          <span>Tổng giao dịch map: <strong>{formatNumber(mapResult?.returned || 0)}</strong></span>
        ) : isQhsddSource ? (
          <span>Lớp QHSDD: <strong>47.882</strong> vùng · nhãn zoom ≥17</span>
        ) : isOsmSource ? (
          <span>Tổng OSM: <strong>{formatNumber(stats?.summary.parcel_count || 0)}</strong> (polygon + line + point)</span>
        ) : (
          <>
            <span>TB diện tích: <strong>{formatNumber(stats?.summary.avg_area)} m²</strong></span>
            <span>Tổng thửa: <strong>{formatNumber(stats?.summary.parcel_count || 0)}</strong></span>
          </>
        )}
      </div>
    </div>
  );
}
