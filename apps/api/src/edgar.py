import httpx
from datetime import datetime, date
from typing import Dict, List, Optional

# Be polite: SEC requires a descriptive User-Agent with contact info
SEC_HEADERS = {
    "User-Agent": "EquityResearchCopilot/0.1 (your-email@example.com)",
    "Accept-Encoding": "gzip, deflate",
    "Host": "data.sec.gov",
}

def cik_from_symbol(symbol: str) -> Optional[str]:
    # Minimal demo mapping; extend as needed
    mapping = {
        "AAPL": "0000320193",
    }
    return mapping.get(symbol.upper())

async def fetch_recent_submissions(cik: str) -> dict:
    url = f"https://data.sec.gov/submissions/CIK{cik}.json"
    async with httpx.AsyncClient(timeout=30.0, headers=SEC_HEADERS) as client:
        r = await client.get(url)
        r.raise_for_status()
        return r.json()

async def fetch_company_facts(cik: str) -> dict:
    """
    SEC standardized metrics (XBRL) for a company.
    https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json
    """
    url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
    async with httpx.AsyncClient(timeout=30.0, headers=SEC_HEADERS) as client:
        r = await client.get(url)
        r.raise_for_status()
        return r.json()

def parse_yyyy_mm_dd(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except Exception:
        return None

# -------- helpers for companyfacts extraction --------

def _pick_units(units: Dict[str, List[dict]], preferred: List[str]) -> Optional[List[dict]]:
    """Pick a units list by preference (e.g., 'USD' for amounts, 'USD/shares' for EPS)."""
    if not units:
        return None
    for p in preferred:
        if p in units:
            return units[p]
    # fallback: any unit with 'USD'
    for k, v in units.items():
        if "USD" in k:
            return v
    # last resort: first available
    for v in units.values():
        return v
    return None

def _extract_tag(values: List[dict], only_10k: bool = True) -> List[dict]:
    """
    Normalize values → [{end: date, filed: date, accn: str, form: str, val: float}]
    Filters to form == '10-K' if only_10k True.
    """
    out = []
    for row in values or []:
        form = row.get("form")
        if only_10k and form != "10-K":
            continue
        end = parse_yyyy_mm_dd(row.get("end"))
        filed = parse_yyyy_mm_dd(row.get("filed"))
        val = row.get("val")
        accn = row.get("accn")
        if end and isinstance(val, (int, float)):
            out.append({"end": end, "filed": filed, "accn": accn, "form": form, "val": float(val)})
    # dedupe by (end, accn) keeping latest filed
    out.sort(key=lambda r: (r["end"], r["filed"] or date.min))
    dedup = {}
    for r in out:
        key = (r["end"], r.get("accn"))
        dedup[key] = r
    return list(dedup.values())

def extract_series(facts: dict, tag_candidates: List[str], unit_pref: List[str]) -> List[dict]:
    """
    From companyfacts, pick the first available tag from tag_candidates (taxonomy: us-gaap),
    pick preferred units, and return normalized 10-K series.
    """
    if not facts:
        return []
    gaap = (facts.get("facts") or {}).get("us-gaap") or {}
    for tag in tag_candidates:
        node = gaap.get(tag)
        if not node:
            continue
        units = node.get("units") or {}
        vals = _pick_units(units, unit_pref)
        if not vals:
            continue
        return _extract_tag(vals, only_10k=True)
    return []
