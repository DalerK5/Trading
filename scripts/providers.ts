/* Server-side XAUUSD data providers (Node 20+, no CORS limits). */
import { aggregate } from "../src/engine/data";
import type { Candle, CandleSet } from "../src/engine/types";
import { TF_MS } from "../src/engine/types";

const UA = "Mozilla/5.0 (compatible; aurum-runner/1.0)";

async function get(url: string, timeout = 20_000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`${new URL(url).host} HTTP ${r.status}`);
    return r;
  } finally {
    clearTimeout(t);
  }
}

/** XAUUSD spot market is closed from Friday 22:00 UTC to Sunday 22:00 UTC (approx.). */
export function marketOpen(t: number) {
  const d = new Date(t);
  const day = d.getUTCDay();
  const h = d.getUTCHours();
  if (day === 6) return false;
  if (day === 5 && h >= 22) return false;
  if (day === 0 && h < 22) return false;
  return true;
}

/* ── live spot quote ── */

export interface Quote {
  bid: number;
  ask: number;
  mid: number;
  at: number;
  source: string;
}

export async function spotQuote(): Promise<Quote | null> {
  try {
    const j = (await (await get("https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD")).json()) as {
      ts?: number;
      spreadProfilePrices: { spreadProfile: string; bid: number; ask: number }[];
    }[];
    const p = j[0].spreadProfilePrices.find((x) => x.spreadProfile === "elite") ?? j[0].spreadProfilePrices[0];
    return { bid: p.bid, ask: p.ask, mid: (p.bid + p.ask) / 2, at: j[0].ts ?? Date.now(), source: "Swissquote" };
  } catch (e) {
    console.warn("swissquote failed:", String(e));
  }
  try {
    const j = (await (await get("https://api.gold-api.com/price/XAU")).json()) as { price: number; updatedAt: string };
    return { bid: j.price, ask: j.price, mid: j.price, at: new Date(j.updatedAt).getTime(), source: "gold-api.com" };
  } catch (e) {
    console.warn("gold-api failed:", String(e));
  }
  return null;
}

/* ── Twelve Data: true XAU/USD OHLC (free API key) ── */

async function tdSeries(key: string, interval: string, size: number): Promise<Candle[]> {
  const url = `https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=${interval}&outputsize=${size}&timezone=UTC&order=ASC&apikey=${key}`;
  const j = (await (await get(url, 30_000)).json()) as { status: string; message?: string; values?: { datetime: string; open: string; high: string; low: string; close: string; volume?: string }[] };
  if (j.status !== "ok" || !j.values) throw new Error(`twelvedata: ${j.message ?? j.status}`);
  return j.values.map((v) => ({
    t: Date.parse(v.datetime.length <= 10 ? `${v.datetime}T00:00:00Z` : `${v.datetime.replace(" ", "T")}Z`),
    o: +v.open,
    h: +v.high,
    l: +v.low,
    c: +v.close,
    v: v.volume ? +v.volume : 0,
  }));
}

/* ── Binance public market-data mirror: PAXG/USDT (1 token = 1 troy oz) ── */

async function binance(interval: string, total: number): Promise<Candle[]> {
  let out: Candle[] = [];
  let end: number | undefined;
  while (out.length < total) {
    const n = Math.min(1000, total - out.length);
    const url = `https://data-api.binance.vision/api/v3/klines?symbol=PAXGUSDT&interval=${interval}&limit=${n}${end ? `&endTime=${end}` : ""}`;
    const rows = (await (await get(url)).json()) as (string | number)[][];
    if (!rows.length) break;
    out = [...rows.map((k) => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })), ...out];
    end = +rows[0][0] - 1;
    if (rows.length < n) break;
  }
  return out;
}

function merge(a: Candle[], b: Candle[], keep: number) {
  const m = new Map<number, Candle>();
  for (const x of a) m.set(x.t, x);
  for (const x of b) m.set(x.t, x);
  return [...m.values()].sort((x, y) => x.t - y.t).slice(-keep);
}

const KEEP = { M15: 6000, H1: 2200, H4: 700, D1: 400 };

export interface FetchResult {
  set: CandleSet;
  provider: string;
  basis: number;
}

/**
 * Returns XAUUSD candles. With a Twelve Data key: real XAU/USD (full history on cold start,
 * then incremental — fits the free 800 credits/day). Otherwise PAXG/USDT candles shifted by a
 * smoothed basis to the Swissquote XAU/USD spot, with weekend (spot-closed) candles removed.
 */
export async function fetchXau(prev: CandleSet | null, prevProvider: string | null, basisPrev: number | null, quote: Quote | null, tdKey?: string): Promise<FetchResult> {
  if (tdKey) {
    try {
      const cold = !prev || prevProvider !== "twelvedata" || prev.M15.length < 500;
      const m15 = await tdSeries(tdKey, "15min", cold ? 5000 : 24);
      let h1: Candle[];
      let d1: Candle[];
      if (cold) {
        h1 = await tdSeries(tdKey, "1h", 2200);
        d1 = await tdSeries(tdKey, "1day", 400);
      } else {
        h1 = aggregate(m15, TF_MS.H1);
        d1 = aggregate(merge(prev!.M15, m15, KEEP.M15).filter((c) => c.t >= m15[0].t - 2 * TF_MS.D1), TF_MS.D1);
      }
      const M15 = merge(cold ? [] : prev!.M15, m15, KEEP.M15);
      const H1 = merge(cold ? [] : prev!.H1, h1, KEEP.H1);
      const D1 = merge(cold ? [] : prev!.D1, d1, KEEP.D1);
      const H4 = aggregate(H1, TF_MS.H4).slice(-KEEP.H4);
      return { set: { M15, H1, H4, D1 }, provider: "twelvedata", basis: 0 };
    } catch (e) {
      console.warn("twelvedata failed, falling back:", String(e));
    }
  }
  const cold = !prev || prevProvider !== "paxg-basis";
  const [m15, h1, d1] = await Promise.all([binance("15m", cold ? 5200 : 40), binance("1h", cold ? 2200 : 10), binance("1d", cold ? 400 : 5)]);
  // basis: XAU spot − PAXG, smoothed so historical prices stay stable between runs
  let basis = basisPrev ?? 0;
  if (quote) {
    const last = m15[m15.length - 1].c;
    const raw = quote.mid - last;
    basis = basisPrev == null || Math.abs(raw - basisPrev) > 40 ? raw : basisPrev + 0.05 * (raw - basisPrev);
  }
  const shift = (c: Candle[]) => c.map((x) => ({ t: x.t, o: r2(x.o + basis), h: r2(x.h + basis), l: r2(x.l + basis), c: r2(x.c + basis), v: x.v }));
  const open = (c: Candle[]) => c.filter((x) => marketOpen(x.t));
  // on warm runs keep previously-adjusted history untouched (immutable track record)
  const M15 = merge(cold ? [] : prev!.M15, open(shift(m15)), KEEP.M15);
  const H1 = merge(cold ? [] : prev!.H1, open(shift(h1)), KEEP.H1);
  const D1 = merge(cold ? [] : prev!.D1, shift(d1).filter((x) => new Date(x.t).getUTCDay() !== 6), KEEP.D1);
  const H4 = aggregate(H1, TF_MS.H4).slice(-KEEP.H4);
  return { set: { M15, H1, H4, D1 }, provider: "paxg-basis", basis };
}

const r2 = (x: number) => Math.round(x * 100) / 100;
