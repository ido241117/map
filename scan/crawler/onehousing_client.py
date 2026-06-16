"""Client for OneHousing Maps API (land plot data)."""
import time
from typing import Any, Dict, List, Optional, Set, Tuple

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

# Legacy GSO district codes used by OneHousing for TP.HCM
HCM_DISTRICT_NAMES: Dict[str, str] = {
    "760": "Q. 01",
    "761": "Q. 12",
    "762": "Q. Thủ Đức (cũ)",
    "763": "Q. 09",
    "764": "Q. Gò Vấp",
    "765": "Q. Bình Thạnh",
    "766": "Q. Tân Bình",
    "767": "Q. Tân Phú",
    "768": "Q. Phú Nhuận",
    "769": "TP. Thủ Đức",
    "770": "Q. 03",
    "771": "Q. 10",
    "772": "Q. 11",
    "773": "Q. 04",
    "774": "Q. 05",
    "775": "Q. 06",
    "776": "Q. 08",
    "777": "Q. Bình Tân",
    "778": "Q. 07",
    "779": "Q. Tân Phú (cũ)",
    "780": "Q. 02",
    "781": "Q. Tân Phú (cũ)",
    "782": "Q. Tân Bình (cũ)",
    "783": "H. Củ Chi",
    "784": "H. Hóc Môn",
    "785": "H. Bình Chánh",
    "786": "H. Nhà Bè",
    "787": "H. Cần Giờ",
}

# Typical ward-code prefixes per district (fallback when geocode is unavailable)
DISTRICT_WARD_PREFIX_HINTS: Dict[str, List[str]] = {
    "760": ["267"],
    "761": ["267"],
    "764": ["268"],
    "765": ["269"],
    "766": ["270"],
    "767": ["270"],
    "768": ["270"],
    "769": ["268", "269"],
    "770": ["271"],
    "771": ["271"],
    "772": ["272"],
    "773": ["272"],
    "774": ["273"],
    "775": ["273"],
    "776": ["274"],
    "777": ["274"],
    "778": ["274"],
    "783": ["275"],
    "784": ["275"],
    "785": ["276"],
    "786": ["276"],
    "787": ["276"],
}


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

    def district_has_data(self, district_code: str, retries: int = 3) -> bool:
        """True if the district filter returns at least one plot."""
        for attempt in range(retries):
            resp = self.filter_properties(
                city_codes=[HCM_CITY_CODE],
                district_codes=[district_code],
                limit=5,
                page=0,
            )
            if resp.get("data"):
                return True
            if attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))
        return False

    def district_hits_page_limit(self, district_code: str) -> bool:
        """True if district has more plots than the 10k ES pagination window."""
        resp = self.filter_properties(
            city_codes=[HCM_CITY_CODE],
            district_codes=[district_code],
            limit=MAX_PAGE_SIZE,
            page=MAX_PAGE_INDEX,
        )
        return len(resp.get("data", [])) >= MAX_PAGE_SIZE

    def ward_has_data(self, district_code: str, ward_code: str) -> bool:
        resp = self.filter_properties(
            city_codes=[HCM_CITY_CODE],
            district_codes=[district_code],
            ward_codes=[ward_code],
            limit=1,
            page=0,
        )
        return bool(resp.get("data"))

    def list_hcm_districts(
        self,
        codes: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """List HCM districts; probe API for data (codes 760–798 or a subset)."""
        code_list = codes or [f"{code:03d}" for code in range(760, 799)]
        districts: List[Dict[str, Any]] = []
        for code_str in code_list:
            has_data = self.district_has_data(code_str)
            districts.append(
                {
                    "code": code_str,
                    "name": HCM_DISTRICT_NAMES.get(code_str, code_str),
                    "has_data": has_data,
                    "needs_ward_split": (
                        self.district_hits_page_limit(code_str) if has_data else False
                    ),
                }
            )
        return districts

    def list_wards(self, district_code: str, district_name: str = "") -> List[Dict[str, str]]:
        filter_expr = f"province.code={HCM_CITY_CODE}#district.code={district_code},"
        keywords = [
            district_name,
            HCM_DISTRICT_NAMES.get(district_code, ""),
            f"Q. {district_code}",
            "Phường",
            "P.",
        ]
        wards: List[Dict[str, str]] = []
        seen: Set[str] = set()
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

    def _ward_prefixes_for_district(self, district_code: str) -> List[str]:
        prefixes: Set[str] = set(DISTRICT_WARD_PREFIX_HINTS.get(district_code, []))
        for page in (0, 4, 8):
            resp = self.filter_properties(
                city_codes=[HCM_CITY_CODE],
                district_codes=[district_code],
                limit=30,
                page=page,
            )
            for row in resp.get("data", []):
                detail = self.get_shape_file(row.get("shape_file_id", ""))
                ward_code = (detail or {}).get("ward_code")
                if ward_code and len(ward_code) >= 3:
                    prefixes.add(ward_code[:3])
        return sorted(prefixes)

    def _scan_ward_codes(
        self, district_code: str, prefixes: List[str]
    ) -> Dict[str, str]:
        found: Dict[str, str] = {}
        for prefix in prefixes:
            for suffix in range(100):
                ward_code = f"{prefix}{suffix:02d}"
                if ward_code in found:
                    continue
                if not self.ward_has_data(district_code, ward_code):
                    continue
                detail = None
                resp = self.filter_properties(
                    city_codes=[HCM_CITY_CODE],
                    district_codes=[district_code],
                    ward_codes=[ward_code],
                    limit=1,
                    page=0,
                )
                batch = resp.get("data", [])
                if batch:
                    detail = self.get_shape_file(batch[0].get("shape_file_id", ""))
                found[ward_code] = (detail or {}).get("ward") or ward_code
        return found

    def discover_wards(self, district_code: str, district_name: str = "") -> List[Dict[str, str]]:
        """
        Discover ward codes for a district.
        Geocode is often empty; fall back to shape-file sampling + ward-code scan.
        """
        wards = self.list_wards(district_code, district_name)
        if wards:
            return wards

        print(f"    geocode returned 0 wards — discovering via API scan...")
        prefixes = self._ward_prefixes_for_district(district_code)
        if not prefixes:
            print(f"    warning: no ward prefixes found for district {district_code}")
            return []

        ward_map = self._scan_ward_codes(district_code, prefixes)
        wards = [{"code": code, "name": name} for code, name in sorted(ward_map.items())]
        print(f"    discovered {len(wards)} wards (prefixes: {', '.join(prefixes)})")
        return wards

    def count_properties(
        self,
        city_code: str,
        district_code: Optional[str] = None,
        ward_code: Optional[str] = None,
    ) -> int:
        """Estimate plot count. API meta.total is unreliable (page size, not total)."""
        district_codes = [district_code] if district_code else None
        ward_codes = [ward_code] if ward_code else None
        resp = self.filter_properties(
            city_codes=[city_code],
            district_codes=district_codes,
            ward_codes=ward_codes,
            limit=MAX_PAGE_SIZE,
            page=MAX_PAGE_INDEX,
        )
        last_page_count = len(resp.get("data", []))
        if last_page_count >= MAX_PAGE_SIZE:
            return (MAX_PAGE_INDEX + 1) * MAX_PAGE_SIZE
        if last_page_count == 0 and MAX_PAGE_INDEX > 0:
            resp0 = self.filter_properties(
                city_codes=[city_code],
                district_codes=district_codes,
                ward_codes=ward_codes,
                limit=MAX_PAGE_SIZE,
                page=0,
            )
            first = resp0.get("data", [])
            if not first:
                return 0
            total = len(first)
            for page in range(1, MAX_PAGE_INDEX + 1):
                resp_p = self.filter_properties(
                    city_codes=[city_code],
                    district_codes=district_codes,
                    ward_codes=ward_codes,
                    limit=MAX_PAGE_SIZE,
                    page=page,
                )
                batch = resp_p.get("data", [])
                if not batch:
                    break
                total += len(batch)
                if len(batch) < MAX_PAGE_SIZE:
                    break
            return total
        return MAX_PAGE_INDEX * MAX_PAGE_SIZE + last_page_count

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
