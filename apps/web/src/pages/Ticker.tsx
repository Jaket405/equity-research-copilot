import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getFilings, getTickerMetrics, getFilingSummary } from "../lib/api";
import type { Filing } from "../lib/api";
import {
  ResponsiveContainer, CartesianGrid, BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
} from "recharts";
import { useMemo, useRef, useState } from "react";

// --- helpers ---
function edgarLinkForAccession(symbol: string, accession: string): string {
  const map: Record<string, string> = { AAPL: "0000320193" };
  const cik = map[symbol.toUpperCase()];
  if (!cik) return `https://www.sec.gov/edgar/search/#/q=${encodeURIComponent(accession)}`;
  const cikNum = String(parseInt(cik, 10));
  const accNoDash = accession.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNoDash}/${accNoDash}-index.htm`;
}
function fmt(n?: number, digits = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}
const LIST_SIZE = 5 as const;

type SeriesPoint = { date: string; value: number };
type Series = { key: string; unit?: string; points: SeriesPoint[] };

export default function TickerPage() {
  const { symbol = "AAPL" } = useParams();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const slotA = searchParams.get("a") ?? "";
  const slotB = searchParams.get("b") ?? "";
  const setSlot = (slot: "a" | "b", accession?: string) => {
    const sp = new URLSearchParams(searchParams);
    if (accession) sp.set(slot, accession); else sp.delete(slot);
    setSearchParams(sp, { replace: true });
  };

  const [selected, setSelected] = useState<Filing | null>(null);

  const filingsQ = useQuery<Filing[]>({ queryKey: ["filings", symbol], queryFn: () => getFilings(symbol) });
  const metricsQ = useQuery<{series: Series[]}>({ queryKey: ["metrics", symbol], queryFn: () => getTickerMetrics(symbol) });

  const tenKAll = useMemo(() => (filingsQ.data ?? []).filter(f => f.form === "10-K"), [filingsQ.data]);
  const defaultFiling = tenKAll[0] ?? null;

  const latestAccession = tenKAll[0]?.accession;
  const summaryQ = useQuery({
    queryKey: ["summary", latestAccession],
    queryFn: () => getFilingSummary(latestAccession!),
    enabled: !!latestAccession,
  });

  // Helper: get a metric value at a specific 10-K period end
  const series = metricsQ.data?.series ?? [];
  const valAt = (key: string, d?: string): number | undefined => {
    if (!d) return undefined;
    const pts = series.find(s => s.key === key)?.points ?? [];
    const p = pts.find(pt => pt.date === d);
    return p?.value;
  };

  // Selected 10-K date
  const selectedDate = selected?.periodEnd || (series.find(s => s.key === "revenue")?.points.slice(-1)[0]?.date);

  // Pull single-period amounts for the snapshot chart
  const snapshot = useMemo(() => {
    const d = selectedDate;
    const rows = [
      { key: "Revenue",          value: valAt("revenue", d) },
      { key: "Gross Profit",     value: valAt("gross_profit", d) },
      { key: "Operating Income", value: valAt("operating_income", d) },
      { key: "Net Income",       value: valAt("net_income", d) },
    ].filter(r => r.value != null) as {key: string; value: number}[];
    return rows;
  }, [selectedDate, series]);

  // Compute margins for the same 10-K
  const rev = valAt("revenue", selectedDate);
  const gp  = valAt("gross_profit", selectedDate);
  const gmRatio  = (gp != null && rev) ? gp / rev : undefined;
  const oi  = valAt("operating_income", selectedDate);
  const ni  = valAt("net_income", selectedDate);
  const opMargin = (oi != null && rev) ? (oi / rev) : undefined;
  const netMargin = (ni != null && rev) ? (ni / rev) : undefined;

  const assets = valAt("assets", selectedDate);
  const liabs  = valAt("liabilities", selectedDate);
  const eps    = valAt("eps_diluted", selectedDate);

  // Compare controls
  const enableCompare = slotA && slotB;
  const goCompare = () => nav(`/compare?symbol=${encodeURIComponent(symbol)}&left=${encodeURIComponent(slotA)}&right=${encodeURIComponent(slotB)}`);

  // Smooth-scroll to snapshot when "View" is clicked
  const chartRef = useRef<HTMLDivElement>(null);

  return (
    <div className="space-y-4">
      {/* Header with dynamic context */}
      <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
        <h2 className="text-xl font-semibold">{symbol}</h2>
        <div className="text-sm text-neutral-500">
          {(selected ?? defaultFiling) ? <> — 10-K • Filed {(selected ?? defaultFiling)!.filedAt ?? "—"}</> : null}
        </div>
      </div>

      {/* Top row: Single 10-K Snapshot (bar chart) + Focus metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div ref={chartRef} className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-medium">Single 10-K Snapshot {selectedDate ? <span className="text-neutral-500 text-sm">({selectedDate})</span> : null}</h3>
            <div className="text-xs text-neutral-500">Values in USD millions</div>
          </div>

          {snapshot.length === 0 ? (
            <div className="text-sm text-neutral-500">No data for this filing yet.</div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={snapshot}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="key" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="value" name="Amount" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Focus metrics for the selected 10-K */}
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4">
          <h3 className="font-medium mb-3">Focus metrics {selectedDate ? <span className="text-neutral-500 text-sm">({selectedDate})</span> : null}</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <MetricCard label="Revenue ($m)"        value={fmt(rev)} />
            <MetricCard label="Gross Profit ($m)"   value={fmt(gp)} />
            <MetricCard label="Operating Inc. ($m)" value={fmt(oi)} />
            <MetricCard label="Net Income ($m)"     value={fmt(ni)} />
            <MetricCard label="Gross Margin (%)"    value={fmt(gmRatio != null ? gmRatio * 100 : undefined, 1)} />
            <MetricCard label="Op Margin (%)"       value={fmt(opMargin != null ? opMargin * 100 : undefined, 1)} />
            <MetricCard label="Net Margin (%)"      value={fmt(netMargin != null ? netMargin * 100 : undefined, 1)} />
            <MetricCard label="Assets ($m)"         value={fmt(assets)} />
            <MetricCard label="Liabilities ($m)"    value={fmt(liabs)} />
            <MetricCard label="EPS (diluted)"       value={fmt(eps, 2)} />
          </div>
        </div>
      </div>

      {/* Compare tray in the middle */}
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">Compare</span>
          <div className="flex-1 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-2 text-sm flex items-center justify-between">
              <span className="font-mono truncate">{slotA || "Slot A: empty"}</span>
              {slotA && <button onClick={() => setSlot("a")} className="text-xs underline ml-2">Clear</button>}
            </div>
            <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-2 text-sm flex items-center justify-between">
              <span className="font-mono truncate">{slotB || "Slot B: empty"}</span>
              {slotB && <button onClick={() => setSlot("b")} className="text-xs underline ml-2">Clear</button>}
            </div>
          </div>
          <button
            onClick={() => nav(`/compare?symbol=${encodeURIComponent(symbol)}&left=${encodeURIComponent(slotA)}&right=${encodeURIComponent(slotB)}`)}
            disabled={!slotA || !slotB}
            className={`px-3 py-1.5 rounded-lg ${slotA && slotB ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300 cursor-not-allowed"}`}
          >
            Compare
          </button>
        </div>
      </div>

      {/* 10-K list */}
      <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-medium">10-K</h3>
          {tenKAll.length > LIST_SIZE && (
            <span className="text-sm text-neutral-500">Showing latest {LIST_SIZE} of {tenKAll.length}</span>
          )}
        </div>

        <div className="space-y-2">
          {tenKAll.slice(0, LIST_SIZE).map(f => {
            const isSel = selected?.accession === f.accession;
            const aSel = slotA === f.accession;
            const bSel = slotB === f.accession;
            return (
              <div
                key={f.accession}
                className={`rounded-xl border p-2 ${isSel ? "border-neutral-900 dark:border-white" : "border-neutral-200 dark:border-neutral-800"}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-xs truncate">
                      <a href={edgarLinkForAccession(symbol, f.accession)} target="_blank" rel="noreferrer" className="underline">
                        {f.accession}
                      </a>
                    </div>
                    <div className="text-xs text-neutral-500">
                      {f.form} • Period {f.periodEnd ?? "—"} • Filed {f.filedAt ?? "—"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setSelected(f);
                        setTimeout(() => chartRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
                      }}
                      className="px-2 py-1 rounded-md text-xs border border-neutral-300 dark:border-neutral-700"
                      title="View this 10-K on the page"
                    >
                      View
                    </button>
                    <button
                      onClick={() => setSlot("a", aSel ? "" : f.accession)}
                      className={`px-2 py-1 rounded-md text-xs ${aSel ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : "border border-neutral-300 dark:border-neutral-700"}`}
                      title="Select to Compare (A)"
                    >A</button>
                    <button
                      onClick={() => setSlot("b", bSel ? "" : f.accession)}
                      className={`px-2 py-1 rounded-md text-xs ${bSel ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : "border border-neutral-300 dark:border-neutral-700"}`}
                      title="Select to Compare (B)"
                    >B</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Optional: latest highlights */}
      {summaryQ.data && (
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4">
          <h3 className="font-medium mb-2">Latest highlights</h3>
          <ul className="list-disc pl-6 space-y-1">
            {summaryQ.data.highlights.map((h: string, i: number) => <li key={i}>{h}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3">
      <div className="text-xs text-neutral-500 mb-1">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
