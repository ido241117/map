import { useEffect, useMemo, useState } from 'react';
import { Alert, AutoComplete, Card, Checkbox, Input, Select, Spin, Typography } from 'antd';
import { fetchParcelAddressSuggest, fetchStats, type ParcelQuery } from '../api';
import { MapLibreView, type MapLibreUpdate } from '../components/MapLibreView';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import type { TileLoaderStatus } from '../mapTileLoader';
import { PARCEL_SOURCE_OPTIONS, isParcelDataSource, type ParcelAddressSuggestion, type ParcelSource, type Stats } from '../types';

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
  const [mapInfo, setMapInfo] = useState<MapLibreUpdate | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [tileStatus, setTileStatus] = useState<TileLoaderStatus | null>(null);
  const [error, setError] = useState('');
  const [mapFocus, setMapFocus] = useState<{
    lat: number;
    lng: number;
    zoom?: number;
    key: string;
  } | null>(null);
  const [showParcels, setShowParcels] = useState(true);
  const [showQhsdd, setShowQhsdd] = useState(true);

  const activeFilters = useMemo(
    () => ({ ...filters, source: dataSource, q: debouncedSearch || undefined }),
    [filters, debouncedSearch, dataSource],
  );

  const filtersVersion = useMemo(
    () => JSON.stringify(activeFilters),
    [activeFilters],
  );

  useEffect(() => {
    if (dataSource === 'property_buy_records') {
      setStats(null);
      return;
    }
    fetchStats(dataSource)
      .then(setStats)
      .catch((err: Error) => setError(err.message));
  }, [dataSource]);

  useEffect(() => {
    const query = debouncedSuggest.trim();
    if (dataSource === 'property_buy_records') {
      setSuggestions([]);
      return;
    }
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }

    const controller = new AbortController();
    setSuggestLoading(true);
    fetchParcelAddressSuggest({ source: dataSource, q: query, limit: 10, district: filters.district, ward: filters.ward }, controller.signal)
      .then((result) => setSuggestions(result.items))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setSuggestions([]);
      })
      .finally(() => setSuggestLoading(false));

    return () => controller.abort();
  }, [debouncedSuggest, dataSource, filters.district, filters.ward]);

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
    setMapInfo(null);
    setError('');
  };

  const isPropertyBuySource = dataSource === 'property_buy_records';
  const showsDistrictFilters = isParcelDataSource(dataSource);
  const showsQhsddOverlay = dataSource === 'land_parcels';
  const mapZoom = mapInfo?.zoom ?? 17;
  const tilesLoading = Boolean(tileStatus && tileStatus.inflight > 0);
  const tileStatusLabel = tileStatus?.slow
    ? 'Đang tải (mạng chậm)…'
    : tilesLoading
      ? 'Đang tải thửa…'
      : null;

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
              placeholder="Tìm địa chỉ, phường, quận, mã thửa..."
            />
          </AutoComplete>
          {!isPropertyBuySource && showsDistrictFilters ? (
            <>
              <Select
                key={`district-${dataSource}`}
                className="map-filter-district"
                placeholder="Quận/huyện"
                value={filters.district ?? ''}
                loading={!stats}
                onChange={(value) => updateFilters({ district: value || undefined, ward: undefined })}
                options={[
                  { value: '', label: 'Tất cả quận/huyện' },
                  ...(stats?.districts.map((item) => ({
                    value: item.district,
                    label: item.district,
                  })) ?? []),
                ]}
              />
              <Select
                key={`ward-${filters.district ?? '__all__'}`}
                className="map-filter-ward"
                placeholder="Phường/xã"
                value={filters.ward ?? ''}
                loading={!stats}
                onChange={(value) => updateFilters({ ward: value || undefined })}
                options={[
                  { value: '', label: 'Tất cả phường/xã' },
                  ...wards.map((item) => ({
                    value: item.ward,
                    label: item.ward,
                  })),
                ]}
              />
            </>
          ) : null}
          {showsQhsddOverlay ? (
            <div className="map-layer-toggles">
              <Checkbox checked={showParcels} onChange={(event) => setShowParcels(event.target.checked)}>
                Thửa đất
              </Checkbox>
              <Checkbox checked={showQhsdd} onChange={(event) => setShowQhsdd(event.target.checked)}>
                QHSDD
              </Checkbox>
            </div>
          ) : null}
        </div>
        {error ? <Alert type="error" message={error} showIcon style={{ marginTop: 12 }} /> : null}
      </Card>

      <div className="map-container-wrap">
        {!mapReady ? (
          <div className="map-loading">
            <Spin />
          </div>
        ) : null}
        {mapReady && tileStatusLabel ? (
          <div className="map-tile-status" role="status" aria-live="polite">
            <Spin size="small" />
            <span>{tileStatusLabel}</span>
          </div>
        ) : null}
        <MapLibreView
          dataSource={dataSource}
          filters={filters}
          filtersVersion={filtersVersion}
          searchQuery={debouncedSearch}
          focusTarget={mapFocus}
          showParcels={showParcels}
          showQhsdd={showQhsdd}
          onUpdate={setMapInfo}
          onError={setError}
          onReady={() => setMapReady(true)}
          onTileStatus={setTileStatus}
        />
      </div>

      <div className="map-metrics">
        {showsQhsddOverlay ? (
          <>
            <span>Thửa: <strong>{formatNumber(mapInfo?.visibleParcels ?? 0)}</strong></span>
            <span>QHSDD: <strong>{formatNumber(mapInfo?.visibleQhsdd ?? 0)}</strong></span>
            <span>Zoom: <strong>{mapZoom}</strong></span>
          </>
        ) : isPropertyBuySource ? (
          <>
            <span>Điểm: <strong>{formatNumber(mapInfo?.propertyBuyCount ?? 0)}</strong></span>
            <span>Zoom: <strong>{mapZoom}</strong></span>
          </>
        ) : null}
      </div>
    </div>
  );
}
