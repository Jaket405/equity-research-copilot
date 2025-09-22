from datetime import date
from sqlalchemy.orm import Session
from src.db import Base, engine, SessionLocal
from src.models import Company, Filing, Metric, MetricPoint

def seed():
    Base.metadata.create_all(bind=engine)
    db: Session = SessionLocal()
    try:
        symbol = "AAPL"
        company = db.query(Company).filter_by(symbol=symbol).first()
        if not company:
            company = Company(symbol=symbol, name="Apple Inc.", cik="0000320193")
            db.add(company)
            db.flush()

        filings_data = [
            ("0000320193-24-000010", "10-Q", date(2024, 3, 31), date(2024, 5, 2)),
            ("0000320193-24-000001", "10-Q", date(2023,12,31), date(2024, 2, 1)),
            ("0000320193-23-000108", "10-K", date(2023, 9, 30), date(2023,11, 3)),
        ]
        existing = {x[0] for x in db.query(Filing.accession).all()}
        for acc, form, per_end, filed in filings_data:
            if acc not in existing:
                db.add(Filing(company_id=company.id, accession=acc, form_type=form,
                              period_end=per_end, filed_at=filed, parse_status="seed"))

        def upsert_metric(key: str, unit: str) -> Metric:
            m = db.query(Metric).filter_by(company_id=company.id, metric_key=key).first()
            if not m:
                m = Metric(company_id=company.id, metric_key=key, unit=unit)
                db.add(m); db.flush()
            return m

        rev = upsert_metric("revenue", "USDm")
        gm  = upsert_metric("gm", "ratio")

        db.query(MetricPoint).filter(MetricPoint.metric_id.in_([rev.id, gm.id])).delete(synchronize_session=False)

        rev_series = [("2023-06-30",81700),("2023-09-30",89500),("2023-12-31",119600),("2024-03-31",90700)]
        gm_series  = [("2023-06-30",0.445), ("2023-09-30",0.448), ("2023-12-31",0.458), ("2024-03-31",0.452)]

        def to_date(s: str):
            y,m,d = map(int, s.split("-")); return date(y,m,d)

        for ds, val in rev_series:
            db.add(MetricPoint(metric_id=rev.id, filed_at=to_date(ds), period_end=to_date(ds), value=val))
        for ds, val in gm_series:
            db.add(MetricPoint(metric_id=gm.id,  filed_at=to_date(ds), period_end=to_date(ds), value=val))

        db.commit()
        print("Seeded ./erc.db with AAPL filings and metrics.")
    finally:
        db.close()

if __name__ == "__main__":
    seed()
