import { useEffect, useMemo, useState } from 'react';
import { Alert, AutoComplete, Card, Checkbox, Input, Select, Spin, Typography } from 'antd';
import { fetchParcelAddressSuggest, fetchStats, type ParcelQuery } from '../api';
import { MapLibreView, type MapLibreUpdate } from '../components/MapLibreView';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import type { TileLoaderStatus } from '../mapTileLoader';
import { loadMapUserSettings, saveMapUserSettings } from '../mapUserSettings';
import { PARCEL_SOURCE_OPTIONS, isParcelDataSource, type ParcelAddressSuggestion, type ParcelSource, type Stats } from '../types';
import { isUsableStreetSearchQuery } from '../searchQuery';

function formatNumber(value: number | string | undefined) {
  return new Intl.NumberFormat('vi-VN').format(Number(value || 0));
}

export function MapPage() {
  const [initialPrefs] = useState(loadMapUserSettings);
  const [dataSource, setDataSource] = useState<ParcelSource>(initialPrefs.dataSource);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filters, setFilters] = useState<
    Omit<ParcelQuery, 'minLat' | 'maxLat' | 'minLng' | 'maxLng' | 'includeGeometry' | 'source'>
  >(() => ({
    district: initialPrefs.district,
    ward: initialPrefs.ward,
  }));
  const [searchInput, setSearchInput] = useState(initialPrefs.searchInput);
  // Chỉ chạy tìm thửa khi Enter / chọn gợi ý — không debounce theo từng lần dừng gõ.
  const [committedSearch, setCommittedSearch] = useState(initialPrefs.committedSearch);
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
  const [showParcels, setShowParcels] = useState(initialPrefs.showParcels);
  const [showHighways, setShowHighways] = useState(initialPrefs.showHighways);
  const [showQhsdd, setShowQhsdd] = useState(initialPrefs.showQhsdd);

  useEffect(() => {
    saveMapUserSettings({
      dataSource,
      district: filters.district,
      ward: filters.ward,
      searchInput,
      committedSearch,
      showParcels,
      showHighways,
      showQhsdd,
    });
  }, [
    dataSource,
    filters.district,
    filters.ward,
    searchInput,
    committedSearch,
    showParcels,
    showHighways,
    showQhsdd,
  ]);

  const activeFilters = useMemo(
    () => ({ ...filters, source: dataSource, q: committedSearch || undefined }),
    [filters, committedSearch, dataSource],
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
    setCommittedSearch('');
    setFilters({});
    setMapFocus(null);
  };

  const commitSearch = (raw: string) => {
    const query = raw.trim();
    if (!query) {
      setSearchInput('');
      setCommittedSearch('');
      setMapFocus(null);
      return;
    }
    // Chặn space / % / ký tự đặc biệt — không bypass zoom để dump thửa.
    if (!isUsableStreetSearchQuery(query)) {
      setSearchInput(query);
      setCommittedSearch('');
      setError('Nhập ít nhất 2 chữ hoặc số để tìm theo tên đường.');
      return;
    }
    setError('');
    setSearchInput(query);
    setCommittedSearch(query);
  };

  const handleSearchInputChange = (value: string) => {
    setSearchInput(value);
    // Xóa ô tìm → thoát chế độ search ngay, không đợi Enter.
    if (!value.trim()) {
      setCommittedSearch('');
      setMapFocus(null);
    }
  };

  const handleAddressSelect = (value: string) => {
    commitSearch(value);
    const item = suggestions.find(
      (suggestion) =>
        (suggestion.street_name || suggestion.full_address || suggestion.address) === value,
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
  const isAddressSearch = showsQhsddOverlay && Boolean(committedSearch.trim());
  // Đang tìm theo tên đường → tự tắt QHSDD trên UI; giữ preference khi xóa tìm kiếm.
  const effectiveShowQhsdd = showQhsdd && !isAddressSearch;
  const mapZoom = mapInfo?.zoom ?? 17;
  const tilesLoading = Boolean(tileStatus && tileStatus.inflight > 0);
  const tileStatusLabel = tileStatus?.slow
    ? 'Đang tải (mạng chậm)…'
    : tilesLoading
      ? 'Đang tải thửa…'
      : null;

  const suggestOptions = useMemo(
    () =>
      suggestions.map((item) => {
        const streetLabel = item.street_name || item.full_address || item.address;
        return {
          value: streetLabel,
          label: (
            <div className="address-suggest-option">
              <div>{streetLabel}</div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {[item.ward, item.district].filter(Boolean).join(', ')}
              </Typography.Text>
            </div>
          ),
        };
      }),
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
            onSearch={handleSearchInputChange}
            onChange={handleSearchInputChange}
            onSelect={handleAddressSelect}
            notFoundContent={suggestLoading ? <Spin size="small" /> : 'Không có gợi ý'}
          >
            <Input
              allowClear
              placeholder="Tìm theo tên đường (Enter)..."
              onPressEnter={(event) => commitSearch(event.currentTarget.value)}
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
              <Checkbox
                checked={showHighways}
                onChange={(event) => setShowHighways(event.target.checked)}
              >
                Lộ giới
              </Checkbox>
              <Checkbox
                checked={effectiveShowQhsdd}
                disabled={isAddressSearch}
                onChange={(event) => setShowQhsdd(event.target.checked)}
              >
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
          searchQuery={committedSearch}
          focusTarget={mapFocus}
          showParcels={showParcels}
          showHighways={showHighways}
          showQhsdd={effectiveShowQhsdd}
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
