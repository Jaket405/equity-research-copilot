from datetime import date
from typing import Dict, List
from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from sqlalchemy import and_
from src.db import Base, engine, SessionLocal
from src.models import Company, Filing, Metric, MetricPoint
from src.edgar import (
    fetch_recent_submissions, cik_from_symbol, parse_yyyy_mm_dd,
    fetch_company_facts, extract_series
)
import yfinance as yf
import os

app = FastAPI(title="ERC API (10-K focus)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ALLOW_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@app.get("/")
def root():
    return RedirectResponse(url="/docs")

# ===== DB-backed =====
@app.get("/api/tickers/{symbol}/filings")
def filings(symbol: str, db: Session = Depends(get_db)):
    c = db.query(Company).filter_by(symbol=symbol).first()
    if not c:
        return []
    rows = db.query(Filing).filter_by(company_id=c.id).order_by(Filing.filed_at.desc()).all()
    return [{
        "accession": f.accession,
        "form": f.form_type,
        "periodEnd": f.period_end.isoformat() if isinstance(f.period_end, date) else f.period_end,
        "filedAt":   f.filed_at.isoformat()   if isinstance(f.filed_at,   date) else f.filed_at,
        "parseStatus": f.parse_status or "seed",
    } for f in rows]

@app.get("/api/tickers/{symbol}/metrics")
def metrics(symbol: str, db: Session = Depends(get_db)):
    """
    Return ALL metric series for the company (not just revenue/gm).
    """
    c = db.query(Company).filter_by(symbol=symbol).first()
    if not c:
        return {"series": []}
    out = []
    metrics = db.query(Metric).filter_by(company_id=c.id).all()
    for m in metrics:
        pts = db.query(MetricPoint).filter_by(metric_id=m.id).order_by(MetricPoint.filed_at.asc()).all()
        out.append({
            "key": m.metric_key,
            "unit": m.unit,
            "points": [{"date": p.filed_at.isoformat() if isinstance(p.filed_at, date) else p.filed_at,
                        "value": p.value} for p in pts]
        })
    return {"series": out}

@app.get("/api/filings/{accession}/summary")
def summary(accession: str):
    # stub (LLM later)
    return {
        "highlights":[
            "Revenue up y/y; margins stable.",
            "Operating expenses disciplined; cash position solid.",
            "Risk factors materially unchanged vs prior year."
        ]
    }

# ===== EDGAR list/import (still 10-K only) =====
@app.get("/api/edgar/{symbol}/recent")
async def edgar_recent(symbol: str):
    cik = cik_from_symbol(symbol)
    if not cik:
        raise HTTPException(status_code=400, detail="Unknown symbol in demo mapping")
    data = await fetch_recent_submissions(cik)
    recent = data.get("filings", {}).get("recent", {})
    out = []
    if recent:
        acc = recent.get("accessionNumber", [])
        forms = recent.get("form", [])
        filed = recent.get("filingDate", [])
        report = recent.get("reportDate", [])
        prim = recent.get("primaryDocument", [])
        for i in range(min(10, len(acc))):
            if forms[i] != "10-K":
                continue
            out.append({
                "accession": acc[i],
                "form": forms[i],
                "filedAt": filed[i],
                "reportDate": report[i] if i < len(report) else None,
                "primaryDoc": prim[i] if i < len(prim) else None,
            })
    return {"recent": out}

@app.get("/api/edgar/{symbol}/import")
async def edgar_import(symbol: str, db: Session = Depends(get_db)):
    """
    Import recent 10-K filings (metadata only).
    """
    cik = cik_from_symbol(symbol)
    if not cik:
        raise HTTPException(status_code=400, detail="Unknown symbol in demo mapping")

    data = await fetch_recent_submissions(cik)
    name = data.get("name") or symbol
    company = db.query(Company).filter_by(symbol=symbol).first()
    if not company:
        company = Company(symbol=symbol, cik=cik, name=name)
        db.add(company)
        db.flush()

    recent = data.get("filings", {}).get("recent", {})
    if not recent:
        return {"inserted": 0, "skipped": 0, "message": "No recent filings in SEC response."}

    allowed_forms = {"10-K"}
    acc = recent.get("accessionNumber", [])
    forms = recent.get("form", [])
    filed = recent.get("filingDate", [])
    report = recent.get("reportDate", [])

    inserted = 0
    skipped = 0
    for i in range(len(acc)):
        form = forms[i] if i < len(forms) else None
        if form not in allowed_forms:
            continue
        accession = acc[i]
        if db.query(Filing).filter_by(accession=accession).first():
            skipped += 1
            continue
        filed_at = parse_yyyy_mm_dd(filed[i] if i < len(filed) else None)
        period_end = parse_yyyy_mm_dd(report[i] if i < len(report) else None)
        f = Filing(
            company_id=company.id,
            accession=accession,
            form_type=form,
            filed_at=filed_at,
            period_end=period_end,
            parse_status="imported",
        )
        db.add(f)
        inserted += 1

    db.commit()
    return {"company": {"symbol": company.symbol, "name": company.name}, "inserted": inserted, "skipped": skipped}

# ===== EDGAR companyfacts → DB (10-K metrics) =====
@app.get("/api/edgar/{symbol}/facts/import")
async def facts_import(symbol: str, db: Session = Depends(get_db)):
    """
    Pull standardized 10-K metrics and persist as Metric/MetricPoint:
      - revenue (USDm)
      - gross_profit (USDm)
      - gm (ratio = GP/Revenue)
      - operating_income (USDm)
      - net_income (USDm)
      - assets (USDm)
      - liabilities (USDm)
      - equity (USDm)
      - cfo (USDm)
      - capex (USDm)         # usually negative in CF, we store as-is
      - fcf (USDm)           # computed as cfo + capex
    Points aligned by period_end and linked to source_filing when possible.
    """
    from sqlalchemy import and_
    cik = cik_from_symbol(symbol)
    if not cik:
        raise HTTPException(status_code=400, detail="Unknown symbol in demo mapping")

    company = db.query(Company).filter_by(symbol=symbol).first()
    if not company:
        company = Company(symbol=symbol, cik=cik, name=symbol)
        db.add(company); db.flush()

    facts = await fetch_company_facts(cik)

    # Base series
    rev     = extract_series(facts, ["RevenueFromContractWithCustomerExcludingAssessedTax","SalesRevenueNet","Revenues"], ["USD"])
    gp      = extract_series(facts, ["GrossProfit"], ["USD"])
    eps     = extract_series(facts, ["EarningsPerShareDiluted"], ["USD/shares","USD/share"])
    assets  = extract_series(facts, ["Assets"], ["USD"])
    liabs   = extract_series(facts, ["Liabilities"], ["USD"])

    # New series
    opinc   = extract_series(facts, ["OperatingIncomeLoss"], ["USD"])
    netinc  = extract_series(facts, ["NetIncomeLoss","ProfitLoss"], ["USD"])
    equity  = extract_series(facts, ["StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest","StockholdersEquity"], ["USD"])
    cfo     = extract_series(facts, ["NetCashProvidedByUsedInOperatingActivities"], ["USD"])
    capex   = extract_series(facts, ["PaymentsToAcquirePropertyPlantAndEquipment","PaymentsForProceedsFromProductiveAssets"], ["USD"])

    # helpers
    def upsert_metric(key: str, unit: str) -> Metric:
        m = db.query(Metric).filter_by(company_id=company.id, metric_key=key).first()
        if not m:
            m = Metric(company_id=company.id, metric_key=key, unit=unit)
            db.add(m); db.flush()
        else:
            if not m.unit:
                m.unit = unit
        return m

    def filing_id_for(accn: str | None, end_date: date | None) -> int | None:
        if accn:
            f = db.query(Filing).filter_by(accession=accn).first()
            if f: return f.id
        if end_date:
            f = db.query(Filing).filter(and_(Filing.company_id == company.id, Filing.form_type == "10-K", Filing.period_end == end_date)).first()
            if f: return f.id
        return None

    def upsert_points(metric: Metric, series: List[dict], *, scale_millions: bool = False):
        for row in series:
            d: date = row["end"]
            v: float = row["val"]
            if scale_millions:
                v = v / 1_000_000.0
            src_id = filing_id_for(row.get("accn"), d)
            existing = db.query(MetricPoint).filter_by(metric_id=metric.id, filed_at=d).first()
            if existing:
                existing.value = v
                if src_id: existing.source_filing_id = src_id
            else:
                db.add(MetricPoint(metric_id=metric.id, filed_at=d, period_end=d, value=v, source_filing_id=src_id))

    # Create metrics
    m_rev   = upsert_metric("revenue", "USDm")
    m_gp    = upsert_metric("gross_profit", "USDm")
    m_gm    = upsert_metric("gm", "ratio")
    m_eps   = upsert_metric("eps_diluted", "USD/sh")
    m_ast   = upsert_metric("assets", "USDm")
    m_liab  = upsert_metric("liabilities", "USDm")
    m_oi    = upsert_metric("operating_income", "USDm")
    m_ni    = upsert_metric("net_income", "USDm")
    m_eq    = upsert_metric("equity", "USDm")
    m_cfo   = upsert_metric("cfo", "USDm")
    m_capex = upsert_metric("capex", "USDm")
    m_fcf   = upsert_metric("fcf", "USDm")

    # Upsert base & new series (scale USD → USDm where appropriate)
    upsert_points(m_rev,   rev,   scale_millions=True)
    upsert_points(m_gp,    gp,    scale_millions=True)
    upsert_points(m_eps,   eps,   scale_millions=False)
    upsert_points(m_ast,   assets,scale_millions=True)
    upsert_points(m_liab,  liabs, scale_millions=True)
    upsert_points(m_oi,    opinc, scale_millions=True)
    upsert_points(m_ni,    netinc,scale_millions=True)
    upsert_points(m_eq,    equity,scale_millions=True)
    upsert_points(m_cfo,   cfo,   scale_millions=True)
    upsert_points(m_capex, capex, scale_millions=True)

    # Compute GM = GP / Revenue
    rev_by_date: Dict[date, float] = {}
    gp_by_date: Dict[date, float]  = {}
    for p in db.query(MetricPoint).filter_by(metric_id=m_rev.id).all():
        rev_by_date[p.filed_at] = p.value
    for p in db.query(MetricPoint).filter_by(metric_id=m_gp.id).all():
        gp_by_date[p.filed_at] = p.value
    for d, rv in rev_by_date.items():
        gpv = gp_by_date.get(d)
        if gpv is None or rv == 0:
            continue
        gm_val = gpv / rv
        existing = db.query(MetricPoint).filter_by(metric_id=m_gm.id, filed_at=d).first()
        if existing: existing.value = gm_val
        else:
            src = db.query(Filing).filter(and_(Filing.company_id == company.id, Filing.form_type=="10-K", Filing.period_end==d)).first()
            db.add(MetricPoint(metric_id=m_gm.id, filed_at=d, period_end=d, value=gm_val, source_filing_id=src.id if src else None))

    # Compute FCF = CFO + Capex (capex is typically negative outflow)
    cfo_by_date: Dict[date, float] = {p.filed_at: p.value for p in db.query(MetricPoint).filter_by(metric_id=m_cfo.id).all()}
    capex_by_date: Dict[date, float] = {p.filed_at: p.value for p in db.query(MetricPoint).filter_by(metric_id=m_capex.id).all()}
    for d, cfo_v in cfo_by_date.items():
        capex_v = capex_by_date.get(d)
        if capex_v is None: continue
        fcf_v = cfo_v + capex_v
        existing = db.query(MetricPoint).filter_by(metric_id=m_fcf.id, filed_at=d).first()
        if existing: existing.value = fcf_v
        else:
            src = db.query(Filing).filter(and_(Filing.company_id == company.id, Filing.form_type=="10-K", Filing.period_end==d)).first()
            db.add(MetricPoint(metric_id=m_fcf.id, filed_at=d, period_end=d, value=fcf_v, source_filing_id=src.id if src else None))

    db.commit()
    return {
        "inserted_or_updated": True,
        "metrics": ["revenue","gross_profit","gm","operating_income","net_income","assets","liabilities","equity","cfo","capex","fcf"],
        "note": "USD millions (except eps_diluted in USD/sh). GM is a ratio (0–1).",
    }

# ===== Price (yfinance) =====
@app.get("/api/price/{symbol}")
def price(
    symbol: str,
    range: str = Query("1y", pattern="^(1mo|3mo|6mo|1y|5y|max)$"),
    interval: str = Query("1d", pattern="^(1d|1wk|1mo)$"),
):
    try:
        df = yf.download(symbol, period=range, interval=interval, auto_adjust=True, progress=False)
        if df is None or df.empty:
            return {"series": []}
        out = [{"date": idx.strftime("%Y-%m-%d"), "close": float(row["Close"])} for idx, row in df.iterrows()]
        return {"series": out}
    except Exception as e:
        return {"series": [], "error": str(e)}
