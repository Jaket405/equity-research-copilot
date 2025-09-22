import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getFilingSummary } from "../lib/api";

// Quick helper for SEC link
function edgarLinkForAccession(accession: string, cik: string = "0000320193") {
  const cikNum = String(parseInt(cik, 10));
  const accNoDash = accession.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNoDash}/${accNoDash}-index.htm`;
}

export default function FilingPage() {
  const { accession = "" } = useParams();

  const summaryQ = useQuery({
    queryKey: ["summary", accession],
    queryFn: () => getFilingSummary(accession),
    enabled: !!accession,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Filing: <span className="font-mono text-base">{accession}</span></h2>
        <div className="space-x-2">
          <Link to="/" className="text-sm underline">Back</Link>
          <a
            href={edgarLinkForAccession(accession)}
            target="_blank"
            rel="noreferrer"
            className="text-sm underline"
            title="Open on SEC EDGAR (new tab)"
          >
            Open on SEC
          </a>
        </div>
      </div>

      {/* Two-column ready layout; right side will hold compare UI later */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Summary */}
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4">
          <h3 className="font-medium mb-2">Key Highlights</h3>
          {summaryQ.isLoading && <div>Loading…</div>}
          {summaryQ.data && (
            <ul className="list-disc pl-6 space-y-1">
              {summaryQ.data.highlights.map((h, i) => <li key={i}>{h}</li>)}
            </ul>
          )}
        </div>

        {/* Right: Placeholder for future “Compare” or metrics-by-filing */}
        <div className="rounded-2xl border border-dashed border-neutral-200 dark:border-neutral-800 p-4">
          <h3 className="font-medium mb-2">Compare / Details</h3>
          <p className="text-sm text-neutral-500">
            This panel will show selected metrics or a comparison with another filing.
          </p>
        </div>
      </div>
    </div>
  );
}
