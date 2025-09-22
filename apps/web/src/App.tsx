import { Link, Route, Routes, useNavigate } from "react-router-dom";
import TickerPage from "./pages/Ticker";
import FilingPage from "./pages/Filing";
import ComparePage from "./pages/Compare";

export default function App() {
  const nav = useNavigate();
  return (
    <div className="min-h-screen p-6 bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Equity Research Copilot</h1>
        <div className="space-x-2">
          <button
            onClick={() => nav("/ticker/AAPL")}
            className="px-3 py-1.5 rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
          >
            Demo: AAPL
          </button>
          <Link to="/" className="underline">Dashboard</Link>
        </div>
      </header>

      <Routes>
        <Route path="/" element={<div className="text-sm text-neutral-500">Click “Demo: AAPL”.</div>} />
        <Route path="/ticker/:symbol" element={<TickerPage />} />
        <Route path="/filing/:accession" element={<FilingPage />} />
        <Route path="/compare" element={<ComparePage />} />
      </Routes>
    </div>
  );
}
