export default function SummaryCard({ highlights }: { highlights: string[] }) {
  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-4">
      <h3 className="font-medium mb-2">Key Highlights</h3>
      <ul className="list-disc pl-6 space-y-1">
        {highlights.map((h, i) => <li key={i}>{h}</li>)}
      </ul>
    </div>
  );
}
