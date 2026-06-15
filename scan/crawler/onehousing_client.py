"""Client for OneHousing Maps API (land plot data)."""
import time
from typing import Any, Dict, List, Optional

import requests

API_BASE = "https://api.onehousing.vn/onehousing-channel/v1"

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0 Safari/537.36"
    ),
    "Accept": "application/json",
    "Origin": "https://maps.onehousing.vn",
    "Referer": "https://maps.onehousing.vn/quy-hoach",
    "Content-Type": "application/json",
    "Accept-Language": "vi-VN,vi;q=0.9",
}

MAX_PAGE_SIZE = 1000
MAX_PAGE_INDEX = 9  # Elasticsearch window: (page+1)*limit <= 10000
HCM_CITY_CODE = "79"


class OneHousingClient:
    def __init__(self, delay: float = 0.15, max_retries: int = 4):
        self.delay = delay
        self.max_retries = max_retries
        self.session = requests.Session()
        self.session.headers.update(DEFAULT_HEADERS)

    def _sleep(self):
        if self.delay:
            time.sleep(self.delay)

    def _request(self, method: str, path: str, **kwargs) -> requests.Response:
        url = f"{API_BASE}{path}"
        for attempt in range(self.max_retries):
            self._sleep()
            try:
                resp = self.session.request(method, url, timeout=60, **kwargs)
                if resp.status_code in (429, 502, 503, 504):
                    time.sleep(2 ** attempt)
                    continue
                return resp
            except requests.RequestException:
                time.sleep(2 ** attempt)
        raise RuntimeError(f"Failed after {self.max_retries} retries: {method} {path}")

    def geocode(
        self,
        keyword: str,
        filter_expr: str = "",
        depth_search: bool = False,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        params = {
            "keyword": keyword,
            "depth-search": "true" if depth_search else "false",
            "limit": str(limit),
        }
        if filter_expr:
            params["filter"] = filter_expr
        resp = self._request("GET", "/geocode", params=params)
        if resp.status_code != 200:
            return []
        return resp.json().get("data", [])

    def filter_properties(
        self,
        city_codes: List[str],
        district_codes: Optional[List[str]] = None,
        ward_codes: Optional[List[str]] = None,
        limit: int = MAX_PAGE_SIZE,
        page: int = 0,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {
            "city_codes": city_codes,
            "limit": limit,
            "page": page,
        }
        if district_codes:
            body["district_codes"] = district_codes
        if ward_codes:
            body["ward_codes"] = ward_codes
        resp = self._request("POST", "/digital-map/properties/filter", json=body)
        if resp.status_code != 200:
            return {"data": [], "meta": {"code": resp.status_code}}
        return resp.json()

    def get_shape_file(self, shape_file_id: str) -> Optional[Dict[str, Any]]:
        resp = self._request(
            "GET",
            f"/digital-map/properties/shape-file/{shape_file_id}",
        )
        if resp.status_code != 200:
            return None
        return resp.json().get("data")

    def list_hcm_districts(self) -> List[Dict[str, str]]:
        """Scan legacy HCM district codes (760–798) used by OneHousing."""
        districts: List[Dict[str, str]] = []
        for code in range(760, 799):
            code_str = f"{code:03d}"
            total = self.count_properties(HCM_CITY_CODE, code_str)
            if total > 0:
                districts.append({"code": code_str, "name": code_str, "total_hint": total})
        return districts

    def list_wards(self, district_code: str, district_name: str = "") -> List[Dict[str, str]]:
        filter_expr = f"province.code={HCM_CITY_CODE}#district.code={district_code},"
        keywords = [
            district_name,
            f"Q. {district_code}",
            "Phường",
            "P.",
        ]
        wards: List[Dict[str, str]] = []
        seen = set()
        for keyword in keywords:
            if not keyword:
                continue
            items = self.geocode(
                keyword,
                filter_expr=filter_expr,
                depth_search=True,
                limit=100,
            )
            for item in items:
                if item.get("type") != "ward":
                    continue
                ward_code = None
                ward_name = item.get("address", "")
                for comp in item.get("address_components", []):
                    if comp.get("type") == "ward":
                        ward_code = comp.get("code")
                        ward_name = comp.get("name") or ward_name
                if ward_code and ward_code not in seen:
                    seen.add(ward_code)
                    wards.append({"code": ward_code, "name": ward_name})
        return sorted(wards, key=lambda w: w["code"])

    def count_properties(
        self,
        city_code: str,
        district_code: Optional[str] = None,
        ward_code: Optional[str] = None,
    ) -> int:
        district_codes = [district_code] if district_code else None
        ward_codes = [ward_code] if ward_code else None
        resp = self.filter_properties(
            city_codes=[city_code],
            district_codes=district_codes,
            ward_codes=ward_codes,
            limit=1,
            page=0,
        )
        return int(resp.get("meta", {}).get("total", 0))

    def fetch_all_in_scope(
        self,
        city_code: str,
        district_code: Optional[str] = None,
        ward_code: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        district_codes = [district_code] if district_code else None
        ward_codes = [ward_code] if ward_code else None
        rows: List[Dict[str, Any]] = []
        for page in range(MAX_PAGE_INDEX + 1):
            resp = self.filter_properties(
                city_codes=[city_code],
                district_codes=district_codes,
                ward_codes=ward_codes,
                limit=MAX_PAGE_SIZE,
                page=page,
            )
            batch = resp.get("data", [])
            if not batch:
                break
            rows.extend(batch)
            if len(batch) < MAX_PAGE_SIZE:
                break
        return rows
