import axios from "axios";
const api = axios.create({ baseURL: import.meta.env.VITE_API_URL });

export type Filing = {
  accession: string;
  form: string;
  periodEnd: string;
  filedAt: string;
  parseStatus: string;
};

export async function getFilings(symbol: string) {
  const { data } = await api.get<Filing[]>(`/api/tickers/${symbol}/filings`);
  return data;
}
export type SeriesPoint = { date: string; value: number };
export type MetricSeries = { key: string; points: SeriesPoint[] };

export async function getTickerMetrics(symbol: string) {
  const { data } = await api.get<{ series: MetricSeries[] }>(`/api/tickers/${symbol}/metrics`);
  return data;
}
// add at the bottom
export async function getFilingSummary(accession: string) {
  const { data } = await api.get<{ highlights: string[] }>(`/api/filings/${accession}/summary`);
  return data;
}
export async function getPrice(symbol: string, range = "1y", interval: "1d" | "1wk" | "1mo" = "1d") {
  const { data } = await api.get<{ series: { date: string; close: number }[] }>(`/api/price/${symbol}`, {
    params: { range, interval },
  });
  return data;
}

