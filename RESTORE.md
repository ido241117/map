# Khôi phục database HCM Land MVP

## Yêu cầu

- Docker Desktop (hoặc Docker Engine + Docker Compose)

## Bước 1: Khởi động PostgreSQL/PostGIS

Từ thư mục gốc project (có file `docker-compose.postgis.yml`):

```bash
docker compose -f docker-compose.postgis.yml up -d postgis
```

Đợi container `hcm_land_postgis` healthy (khoảng 10–30 giây).

## Bước 2: Restore database

### Cách A — restore vào DB trống (khuyến nghị khi setup mới)

```bash
# Copy file dump vào container
docker cp hcm_land_mvp.dump hcm_land_postgis:/tmp/hcm_land_mvp.dump

# Restore (ghi đè schema public, giữ extensions PostGIS)
docker exec hcm_land_postgis pg_restore -U postgres -d hcm_land_mvp --clean --if-exists --no-owner --no-acl /tmp/hcm_land_mvp.dump

# Dọn file tạm
docker exec hcm_land_postgis rm /tmp/hcm_land_mvp.dump
```

### Cách B — DB chưa tồn tại

Nếu chưa chạy docker-compose lần nào, bước 1 sẽ tự tạo DB `hcm_land_mvp`. Sau đó chạy lệnh restore ở Cách A.

## Bước 3: Kiểm tra

```bash
docker exec hcm_land_postgis psql -U postgres -d hcm_land_mvp -c "\dt public.*"
docker exec hcm_land_postgis psql -U postgres -d hcm_land_mvp -c "SELECT COUNT(*) FROM land_parcels;"
```

## Kết nối từ app

```
DATABASE_URL=postgres://postgres:postgres@localhost:5433/hcm_land_mvp
```

## Nội dung dump

- Database: `hcm_land_mvp`
- Bao gồm: extensions PostGIS + schema `public` (land_parcels, hcm_qhsdd, users, ...)
- Không bao gồm: schema `tiger`, `topology` (dữ liệu hệ thống PostGIS, tự tạo lại khi cần)

## Thông tin container mặc định

| Mục      | Giá trị        |
|----------|----------------|
| User     | postgres       |
| Password | postgres       |
| Port     | 5433 (host)    |
| DB name  | hcm_land_mvp   |
