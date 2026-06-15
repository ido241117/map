"""
Crawl land plot data for Ho Chi Minh City from OneHousing Maps API.
Outputs CSV + GeoJSON for map visualization.
"""
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional, Set

import pandas as pd

from onehousing_client import (
    HCM_CITY_CODE,
    MAX_PAGE_INDEX,
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


def collect_raw_properties(client: OneHousingClient) -> List[Dict[str, Any]]:
    all_props: List[Dict[str, Any]] = []
    seen_ids: Set[str] = set()

    print("Discovering HCM districts...")
    districts = client.list_hcm_districts()
    print(f"Found {len(districts)} districts with data")

    for dist in districts:
        d_code = dist["code"]
        d_name = dist["name"]
        print(f"\n[{d_code}] {d_name}")

        district_rows = client.fetch_all_in_scope(HCM_CITY_CODE, district_code=d_code)

        total_hint = dist.get("total_hint", 0)
        needs_ward_split = total_hint > MAX_PAGE_SIZE or len(district_rows) >= MAX_PAGE_SIZE

        if needs_ward_split:
            page1 = client.filter_properties(
                city_codes=[HCM_CITY_CODE],
                district_codes=[d_code],
                limit=MAX_PAGE_SIZE,
                page=1,
            )
            if page1.get("data") or total_hint > MAX_PAGE_SIZE:
                print(f"  Large district (hint={total_hint}), splitting by ward...")
                district_rows = []
                wards = client.list_wards(d_code, d_name)
                if wards:
                    for ward in wards:
                        w_code = ward["code"]
                        w_name = ward["name"]
                        ward_rows = client.fetch_all_in_scope(
                            HCM_CITY_CODE,
                            district_code=d_code,
                            ward_code=w_code,
                        )
                        print(f"    ward {w_code} ({w_name}): {len(ward_rows)} plots")
                        for row in ward_rows:
                            sfid = row.get("shape_file_id")
                            if sfid and sfid not in seen_ids:
                                seen_ids.add(sfid)
                                all_props.append(row)
                    continue
                print(f"  No wards found — fallback district pagination (max 10k)")
                district_rows = client.fetch_all_in_scope(
                    HCM_CITY_CODE, district_code=d_code
                )

        print(f"  Collected {len(district_rows)} plots at district level")
        for row in district_rows:
            sfid = row.get("shape_file_id")
            if sfid and sfid not in seen_ids:
                seen_ids.add(sfid)
                all_props.append(row)

    return all_props


def enrich_with_details(
    client: OneHousingClient,
    properties: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    print(f"\nFetching area/details for {len(properties)} plots...")

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


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except Exception:
        pass
    client = OneHousingClient(delay=0.12)

    properties = collect_raw_properties(client)
    print(f"\nTotal unique plots collected: {len(properties)}")

    if not properties:
        print("No data collected. Check network or API availability.")
        return

    rows = enrich_with_details(client, properties)
    save_outputs(rows)

    with_area = sum(1 for r in rows if r.get("total_area"))
    print(f"\nDone. Plots with area: {with_area}/{len(rows)}")


if __name__ == "__main__":
    main()
