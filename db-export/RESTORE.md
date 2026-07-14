# Restore database — HCM Land Map MVP

Hướng dẫn khôi phục PostgreSQL/PostGIS từ backup trong thư mục này.  
Chỉ cần **Docker** + **Node.js** — không cần cài PostgreSQL/`psql` trên host.

---

## Nội dung backup

| File | Mô tả |
|------|--------|
| `hcm_land_mvp.dump` | PostGIS thửa đất + QHSDD — `pg_dump -Fc` — **~405 MB** (tháng 7/2026) |
| `osm_highways.dump` | PostGIS **chỉ** đường OSM (`osm_highways`) — **~20–30 MB** |
| `RESTORE.md` | Tài liệu này |

### `hcm_land_mvp.dump` có gì

- Schema + data DB `hcm_land_mvp` (port **5433**)
- `land_parcels` (~1.86M), `hcm_qhsdd` (~54k), `users`, `property_buy_records`, …

### `osm_highways.dump` có gì

- DB `osm_highways` (port **5435**), bảng `osm_highways` (~218k line), GIST indexes
- Đủ để vẽ overlay đường trên map (zoom ≥ 16)

### **Không** có trong dump

| Thành phần | Cách lấy lại |
|------------|----------------|
| **Elasticsearch** `parcels` | `npm run es:setup` (hoặc giữ index cũ trên VPS) |
| **Tile cache** parcels/QHSDD | `npm run tiles:pregen` (hoặc giữ `data/tile-cache/` cũ) |
| **OSM full** (`planet_osm_*`, volume `map_osm_pg_data`) | **Không cần trên VPS** — chỉ dùng slim highways |
| Pre-gen tile highways | Không bắt buộc (cache-on-read khi serve `/tiles/highways`) |

---

## Cập nhật VPS đã có parcels + QHSDD + tiles + ES

VPS **đã chạy** bản cũ (land DB, tile pregen, Elasticsearch) — **không** restore lại `hcm_land_mvp.dump`, **không** cần OSM full.

Trên máy dev (đã có volume highways):

```bash
npm run db:osm:highways:export
# → db-export/osm_highways.dump
```

Copy lên VPS:

```
map/db-export/osm_highways.dump
```

Trên VPS:

```bash
cd /path/to/map
git pull

# 1. Restore highways slim (tạo volume map_osm_highways_pg_data + container port 5435)
npm run db:osm:highways:restore

# 2. Env — thêm / sửa (giữ nguyên DATABASE_URL / ES / TILE_*)
# OSM_DATABASE_URL=postgres://postgres:postgres@localhost:5435/osm_highways

# 3. Restart API (để đọc OSM_DATABASE_URL + code tiles highways)
# systemctl restart …  hoặc  pm2 restart …  hoặc chạy lại npm run dev:backend

# 4. Bật highways cùng stack ngày thường
npm run db:osm:highways:up
```

**Không** chạy `npm run db:osm:up` / extract từ OSM full trên VPS.

Kiểm tra:

```bash
docker exec osm_highways_postgis psql -U postgres -d osm_highways -c "SELECT count(*) FROM osm_highways;"
# Kỳ vọng: ~218460

curl -sI "http://localhost:3001/tiles/highways/16/52192/30794"
# 200 + Content-Type: application/vnd.mapbox-vector-tile  (hoặc 204 nếu điểm ngoài HCM)
```

Map: mode thửa đất, zoom ≥ 16 → thấy lớp đường; click thửa vẫn hoạt động.

---

## Restore nhanh (PC / VPS mới từ zero)

```powershell
cd path\to\map
npm install
copy .env.example .env

# Land + QHSDD
npm run db:docker:restore

# Highways overlay (bắt buộc nếu muốn lớp đường)
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
```

---

## Chi tiết lệnh

### `npm run db:docker:restore`

Script `scripts/docker-restore-db.js`: restore `hcm_land_mvp.dump` → container `hcm_land_postgis` (5433).

### `npm run db:osm:highways:restore`

Script `scripts/docker-restore-osm-highways.js`:

1. `docker volume create map_osm_highways_pg_data` (nếu chưa có)
2. `docker compose -f docker-compose.osm-highways.yml up -d`
3. `CREATE EXTENSION postgis` + `pg_restore` file `db-export/osm_highways.dump`

Connection: `postgres://postgres:postgres@localhost:5435/osm_highways`

### `npm run db:osm:highways:export`

Dump lại từ volume slim đang chạy (máy nguồn).

### Extract từ OSM full (chỉ máy có `map_osm_pg_data`)

```bash
npm run db:osm:up
npm run db:osm:highways:up
npm run db:osm:highways:extract   # hoặc -- --force
npm run db:osm:highways:export
# xong có thể: npm run db:osm:down
```

VPS **không** cần bước này nếu đã nhận sẵn `osm_highways.dump`.

---

## Kiểm tra sau restore

```powershell
npm run db:docker:status
# land_parcels ~ 1.858.982 ; hcm_qhsdd ~ 53.805

docker exec osm_highways_postgis psql -U postgres -d osm_highways -c "SELECT count(*) FROM osm_highways;"
# ~ 218460

docker exec hcm-land-elasticsearch curl -s "http://localhost:9200/_cat/indices/parcels?v"
```

---

## Export backup mới

```powershell
npm run db:docker:export              # → hcm_land_mvp.dump
npm run db:osm:highways:export        # → osm_highways.dump
```

Copy thư mục `db-export/` (dump không commit git — xem `.gitignore`).

---

## Xử lý lỗi

### `Không tìm thấy: db-export/osm_highways.dump`

Copy file từ máy đã `npm run db:osm:highways:export` vào `map/db-export/`.

### Container name conflict / volume project warning

```bash
docker volume create map_osm_highways_pg_data
npm run db:osm:highways:up
```

Compose dùng volume **external** `map_osm_highways_pg_data`.

### Map không hiện đường

1. `OSM_DATABASE_URL` đúng port **5435**
2. `npm run db:osm:highways:up` đang chạy
3. Zoom ≥ **16**, mode thửa đất
4. Restart backend sau khi sửa `.env`

### Không cần / không restore OSM full

Overlay chỉ đọc DB slim. Bỏ qua `docker-compose.osm.yml` trên VPS trừ khi muốn re-extract.

---

## Tóm tắt lệnh

| Mục đích | Lệnh |
|----------|------|
| Restore land+QHSDD | `npm run db:docker:restore` |
| Restore highways slim | `npm run db:osm:highways:restore` |
| Export highways | `npm run db:osm:highways:export` |
| Index ES | `npm run es:setup` |
| Pre-gen tiles parcels/QHSDD | `npm run tiles:pregen` + `:z16` |
| Ngày thường | `db:docker:up` + `db:osm:highways:up` + `es:up` |

Tài liệu liên quan: `db.md`, `run.md`, `.env.example`.
