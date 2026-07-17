# Restore database — HCM Land Map MVP

Hướng dẫn khôi phục PostgreSQL/PostGIS từ backup trong thư mục này.  
Chỉ cần **Docker** + **Node.js** — không cần cài PostgreSQL/`psql` trên host.

---

## Nội dung backup

| File | Mô tả |
|------|--------|
| `hcm_land_mvp.dump` | PostGIS thửa đất + QHSDD — `pg_dump -Fc` — **~405 MB** |
| `osm_highways.dump` | PostGIS OSM slim: **`osm_highways` + `osm_railways`** — **~20 MB** |
| `RESTORE.md` | Tài liệu này |

### `hcm_land_mvp.dump` có gì

- Schema + data DB `hcm_land_mvp` (port **5433**)
- `land_parcels` (~1.86M), `hcm_qhsdd` (~54k), `users`, `property_buy_records`, …

### `osm_highways.dump` có gì

- DB `osm_highways` (port **5435**)
- `osm_highways` (~218k line) — lớp **Lộ giới**
- `osm_railways` (~303 line) — lớp **Đường sắt**
- GIST indexes; đủ overlay trên map (zoom ≥ `HIGHWAYS_MIN_ZOOM` / `RAILWAYS_MIN_ZOOM`, mặc định 10)

### **Không** có trong dump

| Thành phần | Cách lấy lại |
|------------|----------------|
| **Elasticsearch** `parcels` | `npm run es:setup` (hoặc giữ index cũ trên VPS) |
| **Tile cache** parcels/QHSDD | `npm run tiles:pregen` (hoặc giữ `data/tile-cache/` cũ) |
| **OSM full** (`planet_osm_*`, volume `map_osm_pg_data`) | **Không cần trên VPS** — chỉ dùng slim |
| Pre-gen tile highways/railways | Không bắt buộc (cache-on-read) |

---

## Cập nhật VPS (đã có parcels + QHSDD + tiles + ES)

Chỉ cần dump OSM slim mới (có railways) + `git pull` code.

**Máy dev:**

```bash
npm run db:osm:highways:export
# → db-export/osm_highways.dump
```

Copy lên VPS: `map/db-export/osm_highways.dump`

**Trên VPS:**

```bash
cd /path/to/map
git pull

# Restore OSM slim (highways + railways) — ghi đè volume map_osm_highways_pg_data
npm run db:osm:highways:restore

# Env (nếu chưa có)
# OSM_DATABASE_URL=postgres://postgres:postgres@localhost:5435/osm_highways
# RAILWAYS_MIN_ZOOM=10

# Ngày thường
npm run db:docker:up
npm run db:osm:highways:up
npm run es:up
npm run dev:backend
npm run dev:frontend
```

**Không** chạy `npm run db:osm:up` / extract từ OSM full trên VPS.

Kiểm tra:

```bash
docker exec osm_highways_postgis psql -U postgres -d osm_highways -c \
  "SELECT 'highways' AS t, count(*) FROM osm_highways
   UNION ALL SELECT 'railways', count(*) FROM osm_railways;"
# Kỳ vọng: highways ~218460 ; railways ~303

curl -sI "http://localhost:3001/tiles/highways/16/52192/30794"
curl -sI "http://localhost:3001/tiles/railways/16/52192/30794"
```

Map: mode thửa đất → bật checkbox **Lộ giới** / **Đường sắt**.

---

## Restore nhanh (PC / VPS mới từ zero)

```powershell
cd path\to\map
npm install
copy .env.example .env

# Land + QHSDD
npm run db:docker:restore

# Highways + railways overlay
npm run db:osm:highways:restore

# Elasticsearch
npm run es:setup

# (Khuyến nghị) tile parcels/QHSDD
npm run tiles:pregen
npm run tiles:pregen:z16

npm run db:docker:up
npm run db:osm:highways:up
npm run es:up
npm run dev:backend
npm run dev:frontend
```

Root `.env` tối thiểu:

```env
PORT=3001
DATABASE_URL=postgres://postgres:postgres@localhost:5433/hcm_land_mvp
OSM_DATABASE_URL=postgres://postgres:postgres@localhost:5435/osm_highways
JWT_SECRET=change-me-in-production
ELASTICSEARCH_URL=http://localhost:9200
ELASTICSEARCH_PARCELS_INDEX=parcels
TILE_CACHE_ENABLED=1
HIGHWAYS_MIN_ZOOM=10
RAILWAYS_MIN_ZOOM=10
```

---

## Chi tiết lệnh

### `npm run db:docker:restore`

Restore `hcm_land_mvp.dump` → container `hcm_land_postgis` (5433).

### `npm run db:osm:highways:restore`

1. `docker volume create map_osm_highways_pg_data` (nếu chưa có)
2. `docker compose -f docker-compose.osm-highways.yml up -d`
3. `CREATE EXTENSION postgis` + `pg_restore` file `db-export/osm_highways.dump`

→ DB có cả `osm_highways` và `osm_railways`.

### `npm run db:osm:highways:export`

Dump lại từ volume slim đang chạy (máy nguồn).

### Extract từ OSM full (chỉ máy có `map_osm_pg_data`)

```bash
npm run db:osm:up
npm run db:osm:highways:up
npm run db:osm:highways:extract   # highways + railways; -- --force để làm lại
npm run db:osm:highways:export
npm run db:osm:down
```

---

## Kiểm tra sau restore

```powershell
npm run db:docker:status
# land_parcels ~ 1.858.982 ; hcm_qhsdd ~ 53.805

docker exec osm_highways_postgis psql -U postgres -d osm_highways -c \
  "SELECT 'highways' AS t, count(*) FROM osm_highways
   UNION ALL SELECT 'railways', count(*) FROM osm_railways;"
# ~218460 / ~303

docker exec hcm-land-elasticsearch curl -s "http://localhost:9200/_cat/indices/parcels?v"
```

---

## Export backup mới

```powershell
npm run db:docker:export              # → hcm_land_mvp.dump
npm run db:osm:highways:export        # → osm_highways.dump (highways + railways)
```

Copy thư mục `db-export/` (dump **không** commit git — xem `.gitignore`).

---

## Xử lý lỗi

### `Không tìm thấy: db-export/osm_highways.dump`

Copy file từ máy đã `npm run db:osm:highways:export` vào `map/db-export/`.

### Map không hiện đường / đường sắt

1. `OSM_DATABASE_URL` đúng port **5435**
2. `npm run db:osm:highways:up` đang chạy
3. Đã restore dump mới (có bảng `osm_railways`)
4. Bật checkbox trên UI; restart backend sau khi sửa `.env`

### Không cần OSM full trên VPS

Overlay chỉ đọc DB slim. Bỏ qua `docker-compose.osm.yml` trừ khi muốn re-extract.

---

## Tóm tắt lệnh

| Mục đích | Lệnh |
|----------|------|
| Restore land+QHSDD | `npm run db:docker:restore` |
| Restore highways+railways | `npm run db:osm:highways:restore` |
| Export OSM slim | `npm run db:osm:highways:export` |
| Ngày thường | `db:docker:up` + `db:osm:highways:up` + `es:up` |

Tài liệu liên quan: `.env.example`, `run.md` (local).
