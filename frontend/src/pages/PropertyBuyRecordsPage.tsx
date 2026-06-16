import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Card, Input, Select, Table, Typography } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import {
  fetchPropertyBuyFilterOptions,
  fetchPropertyBuyRecords,
  type PropertyBuyQuery,
} from '../api';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import type { PropertyBuyFilterOptions, PropertyBuyRecord } from '../types';

function formatPrice(value: number) {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('vi-VN');
}

export function PropertyBuyRecordsPage() {
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebouncedValue(searchInput, 400);
  const [district, setDistrict] = useState<string>();
  const [ward, setWard] = useState<string>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const [tableScrollY, setTableScrollY] = useState(360);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState<PropertyBuyRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [filterOptions, setFilterOptions] = useState<PropertyBuyFilterOptions | null>(null);

  useEffect(() => {
    fetchPropertyBuyFilterOptions()
      .then(setFilterOptions)
      .catch((err: Error) => setError(err.message));
  }, []);

  const wards = useMemo(() => {
    if (!filterOptions) return [];
    return filterOptions.wards.filter((item) => !district || item.district === district);
  }, [district, filterOptions]);

  const query = useMemo<PropertyBuyQuery>(
    () => ({
      q: debouncedSearch || undefined,
      district,
      ward,
      page,
      pageSize,
    }),
    [debouncedSearch, district, ward, page, pageSize],
  );

  useEffect(() => {
    setLoading(true);
    setError('');
    fetchPropertyBuyRecords(query)
      .then((result) => {
        setItems(result.items);
        setTotal(result.total);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [query]);

  useLayoutEffect(() => {
    const node = tableWrapRef.current;
    if (!node) return;

    const updateScrollHeight = () => {
      const pagination = node.querySelector<HTMLElement>('.ant-table-pagination');
      const thead = node.querySelector<HTMLElement>('.ant-table-thead');
      const paginationHeight = pagination?.offsetHeight ?? 56;
      const theadHeight = thead?.offsetHeight ?? 55;
      const next = node.clientHeight - paginationHeight - theadHeight - 8;
      setTableScrollY(Math.max(160, next));
    };

    updateScrollHeight();
    const observer = new ResizeObserver(updateScrollHeight);
    observer.observe(node);
    return () => observer.disconnect();
  }, [loading, items.length, total, page, pageSize]);

  const columns: ColumnsType<PropertyBuyRecord> = [
    { title: 'ID', dataIndex: 'record_id', width: 90 },
    { title: 'Khách hàng', dataIndex: 'customer_name', width: 160, render: (v) => v || '—' },
    { title: 'Địa chỉ', dataIndex: 'address', ellipsis: true },
    { title: 'Đường', dataIndex: 'street', width: 140, ellipsis: true },
    { title: 'Phường', dataIndex: 'ward', width: 120 },
    { title: 'Quận', dataIndex: 'district', width: 120 },
    { title: 'Thành phố', dataIndex: 'city', width: 120 },
    {
      title: 'Giá mua',
      dataIndex: 'price_buy',
      width: 150,
      align: 'right',
      render: (value: number) => formatPrice(value),
    },
    {
      title: 'Nhập lúc',
      dataIndex: 'imported_at',
      width: 170,
      render: (value: string) => formatDate(value),
    },
  ];

  const handleTableChange = (pagination: TablePaginationConfig) => {
    setPage(pagination.current || 1);
    setPageSize(Math.min(100, pagination.pageSize || 100));
  };

  return (
    <div className="property-buys-page">
      <Card size="small" className="property-buys-filters">
        <div className="property-buys-filter-row">
          <Input
            allowClear
            placeholder="Tìm theo tên, địa chỉ, đường..."
            value={searchInput}
            onChange={(event) => {
              setSearchInput(event.target.value);
              setPage(1);
            }}
            style={{ maxWidth: 320 }}
          />
          <Select
            allowClear
            placeholder="Quận/huyện"
            style={{ width: 200 }}
            value={district}
            onChange={(value) => {
              setDistrict(value);
              setWard(undefined);
              setPage(1);
            }}
            options={filterOptions?.districts.map((item) => ({
              value: item.district,
              label: `${item.district} (${item.count})`,
            }))}
          />
          <Select
            allowClear
            placeholder="Phường/xã"
            style={{ width: 200 }}
            value={ward}
            onChange={(value) => {
              setWard(value);
              setPage(1);
            }}
            options={wards.map((item) => ({
              value: item.ward,
              label: `${item.ward} (${item.count})`,
            }))}
          />
          <Typography.Text type="secondary">{total.toLocaleString('vi-VN')} bản ghi</Typography.Text>
        </div>
        {error ? <Alert type="error" message={error} showIcon style={{ marginTop: 12 }} /> : null}
      </Card>

      <Card className="property-buys-table-card">
        <div ref={tableWrapRef} className="property-buys-table-scroll">
          <Table
            rowKey="id"
            size="middle"
            loading={loading}
            columns={columns}
            dataSource={items}
            scroll={{ x: 1200, y: tableScrollY }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              pageSizeOptions: ['20', '50', '100'],
              showTotal: (count) => `${count.toLocaleString('vi-VN')} bản ghi`,
            }}
            onChange={handleTableChange}
          />
        </div>
      </Card>
    </div>
  );
}
