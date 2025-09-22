from sqlalchemy import Column, Integer, String, Date, Float, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from .db import Base

class Company(Base):
    __tablename__ = "companies"
    id = Column(Integer, primary_key=True)
    symbol = Column(String, unique=True, index=True, nullable=False)
    cik = Column(String, nullable=True)
    name = Column(String, nullable=True)

    filings = relationship("Filing", back_populates="company")
    metrics = relationship("Metric", back_populates="company")

class Filing(Base):
    __tablename__ = "filings"
    id = Column(Integer, primary_key=True)
    company_id = Column(Integer, ForeignKey("companies.id"), index=True, nullable=False)
    accession = Column(String, unique=True, index=True, nullable=False)
    form_type = Column(String, nullable=False)
    period_end = Column(Date, nullable=True)
    filed_at = Column(Date, nullable=True)
    parse_status = Column(String, default="seed", nullable=True)

    company = relationship("Company", back_populates="filings")

class Metric(Base):
    __tablename__ = "metrics"
    id = Column(Integer, primary_key=True)
    company_id = Column(Integer, ForeignKey("companies.id"), index=True, nullable=False)
    metric_key = Column(String, nullable=False)  # e.g., "revenue", "gm"
    unit = Column(String, nullable=True)

    company = relationship("Company", back_populates="metrics")
    points = relationship("MetricPoint", back_populates="metric", cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint("company_id", "metric_key", name="uq_company_metrickey"),)

class MetricPoint(Base):
    __tablename__ = "metric_points"
    id = Column(Integer, primary_key=True)
    metric_id = Column(Integer, ForeignKey("metrics.id"), index=True, nullable=False)
    filed_at = Column(Date, nullable=True)
    period_end = Column(Date, nullable=True)
    value = Column(Float, nullable=False)
    source_filing_id = Column(Integer, ForeignKey("filings.id"), nullable=True)

    metric = relationship("Metric", back_populates="points")
