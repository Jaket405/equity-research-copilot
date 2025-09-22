import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getFilings, getTickerMetrics, getFilingSummary } from "../lib/api";
import { useMemo, useState } from "react";

type SeriesPoint = { date: string; value: number };
type Series = { key: string; unit?: string; points: SeriesPoint[] };

function pctDelta(from?: number, to?: number) {
  if (from == null || to == null || from === 0) return undefined;
  return ((to - from) / from) * 100;
}
function fmt(n?: number, digits = 0) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

// --- tiny chart bits (Recharts) ---
import {
  ResponsiveContainer, CartesianGrid, BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
} from "recharts";

export default function ComparePage() {
  const [params] = useSearchParams();
  const symbol = params.get("symbol") ?? "AAPL";
  const leftAcc = params.get("left") ?? "";
  const rightAcc = params.get("right") ?? "";

  const filingsQ = useQuery({ queryKey: ["filings", symbol], queryFn: () => getFilings(symbol) });
  const metricsQ = useQuery<{series: Series[]}>({ queryKey: ["metrics", symbol], queryFn: () => getTickerMetrics(symbol) });

  const leftSummaryQ  = useQuery({ queryKey: ["summary", leftAcc],  queryFn: () => getFilingSummary(leftAcc),  enabled: !!leftAcc  });
  const rightSummaryQ = useQuery({ queryKey: ["summary", rightAcc], queryFn: () => getFilingSummary(rightAcc), enabled: !!rightAcc });

  const fLeft  = filingsQ.data?.find(f => f.accession === leftAcc);
  const fRight = filingsQ.data?.find(f => f.accession === rightAcc);
  const leftDate  = fLeft?.periodEnd;
  const rightDate = fRight?.periodEnd;

  const ready = !!(leftAcc && rightAcc && leftDate && rightDate);

  // metric tabs
  const METRICS: { key: string; label: string; digits?: number; asPct?: boolean }[] = [
    { key: "revenue",         label: "Revenue ($m)" },
    { key: "gm",              label: "Gross Margin (%)", digits: 1, asPct: true },
    { key: "eps_diluted",     label: "EPS (diluted, $/sh)", digits: 2 },
    { key: "assets",          label: "Assets ($m)" },
    { key: "liabilities",     label: "Liabilities ($m)" },
    { key: "operating_income",label: "Operating Inc. ($m)" },
    { key: "net_income",      label: "Net Income ($m)" },
    { key: "equity",          label: "Equity ($m)" },
    // you can add "cfo","capex","fcf" later if desired
  ];
  const [metricKey, setMetricKey] = useState<string>(METRICS[0].key);

  // helpers
  function valAt(key: string, d?: string): number | undefined {
    if (!d) return undefined;
    const s = metricsQ.data?.series.find(x => x.key === key)?.points ?? [];
    const p = s.find(pt => pt.date === d);
    return p?.value;
  }

  // rows for the table
  const TABLE_KEYS: { key: string; label: string; digits?: number; asPct?: boolean }[] = [
    { key: "revenue",         label: "Revenue ($m)" },
    { key: "gm",              label: "Gross Margin (%)", digits: 1, asPct: true },
    { key: "eps_diluted",     label: "EPS (diluted, $/sh)", digits: 2 },
    { key: "assets",          label: "Assets ($m)" },
    { key: "liabilities",     label: "Liabilities ($m)" },
    { key: "operating_income",label: "Operating Inc. ($m)" },
    { key: "net_income",      label: "Net Income ($m)" },
    { key: "equity",          label: "Equity ($m)" },
  ];

  const rows = TABLE_KEYS.map(k => {
    const lRaw = valAt(k.key, leftDate);
    const rRaw = valAt(k.key, rightDate);
    const l = k.asPct ? (lRaw != null ? lRaw * 100 : undefined) : lRaw;
    const r = k.asPct ? (rRaw != null ? rRaw * 100 : undefined) : rRaw;
    const d = (l != null && r != null) ? (r - l) : undefined;
    const dpct = pctDelta(l, r);
    return { ...k, l, r, d, dpct };
  });

  // chart data for the chosen metric
  const activeMeta = METRICS.find(m => m.key === metricKey)!;
  const chartData = useMemo(() => {
    if (!ready) return [];
    const lRaw = valAt(metricKey, leftDate);
    const rRaw = valAt(metricKey, rightDate);
    const l = activeMeta.asPct ? (lRaw != null ? lRaw * 100 : undefined) : lRaw;
    const r = activeMeta.asPct ? (rRaw != null ? rRaw * 100 : undefined) : rRaw;
    return [
      { name: leftDate,  value: l },
      { name: rightDate, value: r },
    ];
  }, [ready, metricKey, leftDate, rightDate, metricsQ.data]);

  // Deterministic "AI" bullets from deltas (unchanged, extended to use rows)
  function bullets() {
    if (!ready) return [] as string[];
    const get = (k: string) => rows.find(r => r.key === k);
    const rev = get("revenue"), gm = get("gm"), eps = get("eps_diluted");
    const ast = get("assets"), li = get("liabilities");
    const oi = get("operating_income"), ni = get("net_income"), eq = get("equity");

    const out: string[] = [];
    if (rev?.dpct != null) out.push(`Revenue ${rev.dpct >= 0 ? "increased" : "decreased"} ${Math.abs(rev.dpct).toFixed(1)}% (${rev.d! >= 0 ? "+" : ""}${fmt(rev.d, 0)}), from ${fmt(rev.l, 0)} to ${fmt(rev.r, 0)}.`);
    if (gm?.d != null)     out.push(`Gross margin ${(gm.d ?? 0) >= 0 ? "expanded" : "contracted"} ${Math.abs(gm.d!).toFixed(1)} p.p., from ${fmt(gm.l, 1)}% to ${fmt(gm.r, 1)}%.`);
    if (eps?.dpct != null) out.push(`EPS (diluted) ${eps.dpct >= 0 ? "rose" : "fell"} ${Math.abs(eps.dpct).toFixed(1)}%, from ${fmt(eps.l, 2)} to ${fmt(eps.r, 2)}.`);
    if (oi?.dpct != null)  out.push(`Operating income ${oi.dpct >= 0 ? "up" : "down"} ${Math.abs(oi.dpct).toFixed(1)}% (${oi.d! >= 0 ? "+" : ""}${fmt(oi.d, 0)}).`);
    if (ni?.dpct != null)  out.push(`Net income ${ni.dpct >= 0 ? "improved" : "declined"} ${Math.abs(ni.dpct).toFixed(1)}% (${ni.d! >= 0 ? "+" : ""}${fmt(ni.d, 0)}).`);
    if (ast?.dpct != null) out.push(`Assets ${ast.dpct >= 0 ? "grew" : "declined"} ${Math.abs(ast.dpct).toFixed(1)}%.`);
    if (li?.dpct != null)  out.push(`Liabilities ${li.dpct >= 0 ? "increased" : "decreased"} ${Math.abs(li.dpct).toFixed(1)}%.`);
    if (eq?.dpct != null)  out.push(`Equity ${eq.dpct >= 0 ? "expanded" : "contracted"} ${Math.abs(eq.dpct).toFixed(1)}%.`);
    return out;
  }

  function headerLine() {
    if (!ready) return "";
    return `${symbol} 10-K comparison — ${leftDate} → ${rightDate}`;
    }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Compare</h2>
        <Link to={`/ticker/${symbol}`} className="text-sm underline">Back to {symbol}</Link>
      </div>

      {!ready && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200 p-3 text-sm">
          Choose two 10-K filings on the ticker page (A & B), then click <b>Compare</b>.
        </div>
      )}

      {ready && (
        <>
          <div className="text-sm text-neutral-500">{headerLine()}</div>

          {/* Metric tabs + chart */}
          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex flex-wrap gap-1">
                {METRICS.map(m => (
                  <button
                    key={m.key}
                    onClick={() => setMetricKey(m.key)}
                    className={`text-xs px-2 py-1 rounded-md ${
                      metricKey === m.key
                        ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                        : "border border-neutral-300 dark:border-neutral-700"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <div className="text-xs text-neutral-500">
                {activeMeta.label}
              </div>
            </div>

            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData as any}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="value" name="Value" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Meta header for each side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3 text-sm">
              <div className="font-mono truncate">{leftAcc}</div>
              <div className="text-neutral-500">Period end: {leftDate}</div>
            </div>
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3 text-sm">
              <div className="font-mono truncate">{rightAcc}</div>
              <div className="text-neutral-500">Period end: {rightDate}</div>
            </div>
          </div>

          {/* Numeric comparison table */}
          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4">
            <h3 className="font-medium mb-3">Key metrics (10-K)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-neutral-500">
                  <tr>
                    <th className="py-2">Metric</th>
                    <th className="py-2">Left</th>
                    <th className="py-2">Right</th>
                    <th className="py-2">Δ</th>
                    <th className="py-2">%Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const good = (r.d ?? 0) >= 0;
                    const col = (r.d == null) ? "text-neutral-500" : (good ? "text-green-600" : "text-red-600");
                    return (
                      <tr key={r.key} className="border-t border-neutral-200 dark:border-neutral-800">
                        <td className="py-2">{r.label}</td>
                        <td className="py-2">{fmt(r.l, r.digits)}</td>
                        <td className="py-2">{fmt(r.r, r.digits)}</td>
                        <td className="py-2"><span className={col}>{fmt(r.d, r.digits)}</span></td>
                        <td className="py-2"><span className={col}>{r.dpct != null ? `${r.dpct >= 0 ? "+" : ""}${r.dpct.toFixed(1)}%` : "—"}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Deterministic "AI-style" summary */}
          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4">
            <h3 className="font-medium mb-2">Summary</h3>
            <ul className="list-disc pl-6 space-y-1 text-sm">
              {bullets().map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
