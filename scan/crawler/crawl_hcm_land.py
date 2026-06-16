"""
Crawl land plot data for Ho Chi Minh City from OneHousing Maps API.
Outputs CSV + GeoJSON for map visualization.

Usage:
  python crawl_hcm_land.py                  # full crawl, merge with existing CSV
  python crawl_hcm_land.py --only-missing   # only districts not in existing CSV
  python crawl_hcm_land.py --districts 760,766,767
  python crawl_hcm_land.py --fresh          # ignore existing CSV
"""
import argparse
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional, Set, Tuple

import pandas as pd

from onehousing_client import (
    HCM_CITY_CODE,
    HCM_DISTRICT_NAMES,
    MAX_PAGE_SIZE,
    OneHousingClient,
)

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
CSV_PATH = os.path.join(DATA_DIR, "hcm_land_data.csv")
GEOJSON_PATH = os.path.join(DATA_DIR, "hcm_land.geojson")
MAX_SHAPE_THREADS = 6


def geometry_to_geojson(geom: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not geom:
        return None
    if geom.get("type") in ("Point", "Polygon", "MultiPolygon"):
        return geom
    multi = geom.get("multi_polygon")
    if multi:
        return {"type": "MultiPolygon", "coordinates": multi}
    return None


def merge_property_row(
    base: Dict[str, Any],
    detail: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    row = {
        "shape_file_id": base.get("shape_file_id"),
        "property_code": base.get("property_code"),
        "address": base.get("address"),
        "latitude": base.get("latitude"),
        "longitude": base.get("longitude"),
        "total_area": None,
        "planning_land_type": None,
        "province": None,
        "province_code": None,
        "district": None,
        "district_code": None,
        "ward": None,
        "ward_code": None,
        "property_uuid": None,
    }
    if detail:
        row.update(
            {
                "address": detail.get("address") or row["address"],
                "latitude": detail.get("latitude") or row["latitude"],
                "longitude": detail.get("longitude") or row["longitude"],
                "total_area": detail.get("total_area"),
                "planning_land_type": detail.get("planning_land_type"),
                "province": detail.get("province"),
                "province_code": detail.get("province_code"),
                "district": detail.get("district"),
                "district_code": detail.get("district_code"),
                "ward": detail.get("ward"),
                "ward_code": detail.get("ward_code"),
                "property_uuid": detail.get("property_uuid"),
            }
        )
    geom = geometry_to_geojson(base.get("geometry"))
    row["geometry_json"] = json.dumps(geom, ensure_ascii=False) if geom else ""
    return row


def load_existing_csv() -> Tuple[List[Dict[str, Any]], Set[str], Set[str]]:
    """Return (rows, shape_file_ids, district_codes already present)."""
    if not os.path.exists(CSV_PATH):
        return [], set(), set()

    df = pd.read_csv(CSV_PATH, dtype=str)
    rows = df.to_dict("records")
    seen_ids = {
        str(r["shape_file_id"])
        for r in rows
        if r.get("shape_file_id") and str(r["shape_file_id"]) != "nan"
    }
    district_codes = {
        str(r["district_code"])
        for r in rows
        if r.get("district_code") and str(r["district_code"]) != "nan"
    }
    return rows, seen_ids, district_codes


def print_coverage(existing_districts: Set[str], all_districts: List[Dict[str, Any]]):
    print("\n=== District coverage (300k CSV vs full HCM) ===")
    print(
        f"{'Code':<6} {'District':<22} {'In CSV':<8} {'API data':<10} {'Ward split'}"
    )
    print("-" * 66)
    for dist in sorted(all_districts, key=lambda d: int(d["code"])):
        code = dist["code"]
        in_csv = "yes" if code in existing_districts else "NO"
        api = "yes" if dist.get("has_data") else "no"
        split = "yes" if dist.get("needs_ward_split") else "no"
        print(f"{code:<6} {dist['name']:<22} {in_csv:<8} {api:<10} {split}")

    missing_csv = [d for d in all_districts if d["code"] not in existing_districts]
    missing_api = [d for d in missing_csv if d.get("has_data")]
    no_api = [d for d in missing_csv if not d.get("has_data")]

    if missing_csv:
        print(f"\nNot in CSV yet: {len(missing_csv)} districts")
        if missing_api:
            print("  With API data (can crawl now):")
            for d in missing_api:
                print(f"    [{d['code']}] {d['name']}")
        if no_api:
            print("  No API response right now (retry later with --only-missing):")
            for d in no_api:
                print(f"    [{d['code']}] {d['name']}")
    else:
        print("\nAll known districts already present in CSV.")


def collect_district_plots(
    client: OneHousingClient,
    district_code: str,
    district_name: str,
    needs_ward_split: bool,
    seen_ids: Set[str],
) -> List[Dict[str, Any]]:
    collected: List[Dict[str, Any]] = []

    def add_rows(rows: List[Dict[str, Any]]) -> int:
        added = 0
        for row in rows:
            sfid = row.get("shape_file_id")
            if sfid and sfid not in seen_ids:
                seen_ids.add(sfid)
                collected.append(row)
                added += 1
        return added

    if needs_ward_split:
        wards = client.discover_wards(district_code, district_name)
        if wards:
            for ward in wards:
                w_code = ward["code"]
                w_name = ward["name"]
                ward_rows = client.fetch_all_in_scope(
                    HCM_CITY_CODE,
                    district_code=district_code,
                    ward_code=w_code,
                )
                added = add_rows(ward_rows)
                print(f"    ward {w_code} ({w_name}): {len(ward_rows)} plots, +{added} new")
            return collected

        print("    ward discovery failed — fallback district pagination (max 10k)")

    district_rows = client.fetch_all_in_scope(HCM_CITY_CODE, district_code=district_code)
    added = add_rows(district_rows)
    print(f"  district-level: {len(district_rows)} plots, +{added} new")
    return collected


def collect_raw_properties(
    client: OneHousingClient,
    seen_ids: Set[str],
    only_districts: Optional[Set[str]] = None,
    only_missing: bool = False,
    existing_districts: Optional[Set[str]] = None,
) -> List[Dict[str, Any]]:
    all_props: List[Dict[str, Any]] = []
    existing_districts = existing_districts or set()

    known_codes = sorted(HCM_DISTRICT_NAMES.keys(), key=lambda c: int(c))
    print(f"Probing {len(known_codes)} known HCM district codes...")
    all_districts = client.list_hcm_districts(codes=known_codes)

    if only_missing:
        districts = [d for d in all_districts if d["code"] not in existing_districts]
        print(f"Crawling {len(districts)} district(s) missing from CSV")
    else:
        districts = [d for d in all_districts if d.get("has_data")]
        print(f"API has data for {len(districts)} district(s)")

    if only_districts:
        districts = [d for d in districts if d["code"] in only_districts]
        print(f"Filtered to: {', '.join(sorted(only_districts))}")

    for dist in districts:
        d_code = dist["code"]
        d_name = dist["name"]

        if not dist.get("has_data"):
            print(f"\n[{d_code}] {d_name} — retrying API...")
            if not client.district_has_data(d_code, retries=5):
                print(f"  skipped (no data from API)")
                continue
            dist["needs_ward_split"] = client.district_hits_page_limit(d_code)

        needs_split = dist.get("needs_ward_split", False)
        est = client.count_properties(HCM_CITY_CODE, d_code)
        est_label = f"{est:,}+" if est >= 10_000 else f"~{est:,}"
        print(f"\n[{d_code}] {d_name} (est. {est_label}, ward_split={needs_split})")

        district_props = collect_district_plots(
            client, d_code, d_name, needs_split, seen_ids
        )
        all_props.extend(district_props)
        print(f"  => +{len(district_props)} new plots for this district")

    return all_props


def enrich_with_details(
    client: OneHousingClient,
    properties: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    if not properties:
        return []

    print(f"\nFetching area/details for {len(properties)} new plots...")

    def fetch_detail(prop: Dict[str, Any]) -> Dict[str, Any]:
        sfid = prop.get("shape_file_id")
        detail = client.get_shape_file(sfid) if sfid else None
        return merge_property_row(prop, detail)

    results: List[Dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=MAX_SHAPE_THREADS) as executor:
        futures = {executor.submit(fetch_detail, p): p for p in properties}
        done = 0
        for future in as_completed(futures):
            done += 1
            if done % 200 == 0 or done == len(properties):
                print(f"  enriched {done}/{len(properties)}")
            try:
                results.append(future.result())
            except Exception as exc:
                print(f"  warning: {exc}")

    return results


def save_outputs(rows: List[Dict[str, Any]]):
    os.makedirs(DATA_DIR, exist_ok=True)

    df = pd.DataFrame(rows)
    df.to_csv(CSV_PATH, index=False, encoding="utf-8-sig")
    print(f"Saved CSV: {CSV_PATH} ({len(df)} rows)")

    if "district" in df.columns and "district_code" in df.columns:
        summary = (
            df.groupby(["district_code", "district"], dropna=False)
            .size()
            .reset_index(name="count")
            .sort_values("count", ascending=False)
        )
        print("\nRows per district in CSV:")
        for _, row in summary.iterrows():
            print(f"  [{row['district_code']}] {row['district']}: {row['count']:,}")

    features = []
    for row in rows:
        geom_str = row.get("geometry_json")
        if not geom_str:
            continue
        geometry = json.loads(geom_str)
        props = {k: v for k, v in row.items() if k != "geometry_json"}
        features.append(
            {
                "type": "Feature",
                "properties": props,
                "geometry": geometry,
            }
        )

    geojson = {"type": "FeatureCollection", "features": features}
    with open(GEOJSON_PATH, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False)
    print(f"Saved GeoJSON: {GEOJSON_PATH} ({len(features)} features)")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Crawl HCM land plots from OneHousing API")
    parser.add_argument(
        "--only-missing",
        action="store_true",
        help="Only crawl districts not already present in existing CSV",
    )
    parser.add_argument(
        "--districts",
        type=str,
        default="",
        help="Comma-separated district codes to crawl, e.g. 760,766,767",
    )
    parser.add_argument(
        "--fresh",
        action="store_true",
        help="Ignore existing CSV and crawl everything from scratch",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        dest="list_only",
        help="List district coverage and exit (no crawl)",
    )
    return parser.parse_args()


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except Exception:
        pass

    args = parse_args()
    client = OneHousingClient(delay=0.12)

    existing_rows: List[Dict[str, Any]] = []
    seen_ids: Set[str] = set()
    existing_districts: Set[str] = set()

    if not args.fresh:
        existing_rows, seen_ids, existing_districts = load_existing_csv()
        if existing_rows:
            print(f"Loaded existing CSV: {len(existing_rows):,} rows, {len(existing_districts)} districts")

    api_districts = client.list_hcm_districts(
        codes=sorted(HCM_DISTRICT_NAMES.keys(), key=lambda c: int(c))
    )
    print_coverage(existing_districts, api_districts)

    if args.list_only:
        return

    only_districts: Optional[Set[str]] = None
    if args.districts.strip():
        only_districts = {c.strip() for c in args.districts.split(",") if c.strip()}

    new_properties = collect_raw_properties(
        client,
        seen_ids,
        only_districts=only_districts,
        only_missing=args.only_missing,
        existing_districts=existing_districts,
    )
    print(f"\nNew unique plots collected this run: {len(new_properties)}")

    if not new_properties and not existing_rows:
        print("No data collected. Check network or API availability.")
        return

    new_rows = enrich_with_details(client, new_properties) if new_properties else []
    merged_rows = existing_rows + new_rows
    print(f"Total after merge: {len(merged_rows):,} rows")

    save_outputs(merged_rows)

    with_area = sum(1 for r in merged_rows if r.get("total_area"))
    print(f"\nDone. Plots with area: {with_area:,}/{len(merged_rows):,}")


if __name__ == "__main__":
    main()
