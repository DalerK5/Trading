import { atr, atrSeries, clamp, percentileRank, rsiSeries } from "./indicators";
import type {
  Candle,
  Divergence,
  Level,
  PatternInfo,
  Session,
  StructureInfo,
  Sweep,
  TF,
  VolumeProfile,
} from "./types";
import { TF_MS, TF_WEIGHT } from "./types";

/* ── swings (Williams fractals, order n) ─────────────────────────── */

export function swings(c: Candle[], n = 3) {
  const highs: { t: number; p: number; i: number }[] = [];
  const lows: { t: number; p: number; i: number }[] = [];
  for (let i = n; i < c.length - n; i++) {
    let isH = true;
    let isL = true;
    for (let k = 1; k <= n; k++) {
      if (!(c[i].h > c[i - k].h && c[i].h >= c[i + k].h)) isH = false;
      if (!(c[i].l < c[i - k].l && c[i].l <= c[i + k].l)) isL = false;
      if (!isH && !isL) break;
    }
    if (isH) highs.push({ t: c[i].t, p: c[i].h, i });
    if (isL) lows.push({ t: c[i].t, p: c[i].l, i });
  }
  return { highs, lows };
}

/* ── market structure: BOS / CHoCH ───────────────────────────────── */

export interface StructEvent {
  type: "BOS" | "CHoCH";
  dir: "up" | "down";
  i: number;
  at: number;
  price: number;
  fromSwingIdx: number; // index of opposite swing that started the impulse
}

export function marketStructure(c: Candle[], n = 3): StructureInfo & { events: StructEvent[] } {
  const { highs, lows } = swings(c, n);
  const events: StructEvent[] = [];
  let trend: "up" | "down" | "range" = "range";
  let hiPtr = 0;
  let loPtr = 0;
  let lastHigh: { p: number; i: number; broken: boolean } | null = null;
  let lastLow: { p: number; i: number; broken: boolean } | null = null;
  for (let j = 0; j < c.length; j++) {
    // a swing at index i is only known once candle i+n has closed
    while (hiPtr < highs.length && highs[hiPtr].i + n <= j) {
      lastHigh = { p: highs[hiPtr].p, i: highs[hiPtr].i, broken: false };
      hiPtr++;
    }
    while (loPtr < lows.length && lows[loPtr].i + n <= j) {
      lastLow = { p: lows[loPtr].p, i: lows[loPtr].i, broken: false };
      loPtr++;
    }
    if (lastHigh && !lastHigh.broken && c[j].c > lastHigh.p) {
      lastHigh.broken = true;
      const type = trend === "down" ? "CHoCH" : "BOS";
      events.push({ type, dir: "up", i: j, at: c[j].t, price: lastHigh.p, fromSwingIdx: lastLow?.i ?? Math.max(0, j - 10) });
      trend = "up";
    }
    if (lastLow && !lastLow.broken && c[j].c < lastLow.p) {
      lastLow.broken = true;
      const type = trend === "up" ? "CHoCH" : "BOS";
      events.push({ type, dir: "down", i: j, at: c[j].t, price: lastLow.p, fromSwingIdx: lastHigh?.i ?? Math.max(0, j - 10) });
      trend = "down";
    }
  }
  // range if no structural event in the recent window
  if (events.length && c.length - events[events.length - 1].i > 60) trend = "range";
  const last = events[events.length - 1];
  return {
    trend,
    lastEvent: last ? { type: last.type, dir: last.dir, at: last.at, price: last.price } : null,
    swingHighs: highs.slice(-8),
    swingLows: lows.slice(-8),
    events,
  };
}

/* ── order blocks ────────────────────────────────────────────────── */

export function orderBlocks(c: Candle[], events: StructEvent[], tf: TF, atrV: number): Level[] {
  const out: Level[] = [];
  for (const e of events.slice(-12)) {
    let ob = -1;
    for (let k = e.i - 1; k >= Math.max(e.fromSwingIdx, e.i - 15); k--) {
      const bearish = c[k].c < c[k].o;
      if ((e.dir === "up" && bearish) || (e.dir === "down" && !bearish)) {
        ob = k;
        break;
      }
    }
    if (ob < 0) continue;
    const buf = 0.05 * atrV;
    let low = c[ob].l - buf;
    let high = c[ob].h + buf;
    const minW = 0.3 * atrV;
    if (high - low < minW) {
      const mid = (high + low) / 2;
      low = mid - minW / 2;
      high = mid + minW / 2;
    }
    const demand = e.dir === "up";
    let mitigated = false;
    let touches = 1;
    let lastTestAt: number | null = null;
    let inside = false;
    for (let k = e.i + 1; k < c.length; k++) {
      if (demand ? c[k].c < low : c[k].c > high) {
        mitigated = true;
        break;
      }
      const hit = demand ? c[k].l <= high : c[k].h >= low;
      if (hit && !inside) {
        touches++;
        lastTestAt = c[k].t;
      }
      inside = hit;
    }
    if (mitigated) continue;
    const ageH = (c[c.length - 1].t - c[ob].t) / 3_600_000;
    const decay = Math.exp(-ageH / (24 * 20));
    const impulse = Math.abs(c[e.i].c - c[ob].o) / Math.max(atrV, 1e-9);
    const strength = clamp((0.35 + 0.1 * TF_WEIGHT[tf] + 0.1 * Math.min(impulse, 3)) * decay * (touches > 3 ? 0.85 : 1), 0, 1);
    out.push({
      id: `ob_${tf}_${Math.round(low)}_${c[ob].t}`,
      tf,
      kind: "order_block",
      direction: demand ? "demand" : "supply",
      low,
      high,
      strength,
      touches,
      formedAt: c[ob].t,
      lastTestAt,
      mitigated: false,
      confluences: [e.type === "CHoCH" ? "choch_origin" : "bos_origin"],
    });
  }
  return out;
}

/* ── fair value gaps ─────────────────────────────────────────────── */

export function fvgs(c: Candle[], tf: TF, atrV: number, lookback = 60): Level[] {
  const out: Level[] = [];
  const start = Math.max(1, c.length - lookback);
  for (let i = start; i < c.length - 1; i++) {
    const a = c[i - 1];
    const b = c[i + 1];
    let zone: { low: number; high: number; dir: "demand" | "supply" } | null = null;
    if (a.h < b.l && b.l - a.h > 0.15 * atrV) zone = { low: a.h, high: b.l, dir: "demand" };
    else if (a.l > b.h && a.l - b.h > 0.15 * atrV) zone = { low: b.h, high: a.l, dir: "supply" };
    if (!zone) continue;
    let filled = false;
    for (let k = i + 2; k < c.length; k++) {
      if (zone.dir === "demand" ? c[k].l <= zone.low : c[k].h >= zone.high) {
        filled = true;
        break;
      }
    }
    if (filled) continue;
    out.push({
      id: `fvg_${tf}_${c[i].t}`,
      tf,
      kind: "fvg",
      direction: zone.dir,
      low: zone.low,
      high: zone.high,
      strength: clamp(0.25 + 0.08 * TF_WEIGHT[tf], 0, 1),
      touches: 0,
      formedAt: c[i].t,
      lastTestAt: null,
      mitigated: false,
      confluences: [],
    });
  }
  return out;
}

/* ── swing-level clustering (1-D DBSCAN, minPts = 1) ─────────────── */

export function swingLevels(
  sets: { tf: TF; c: Candle[]; atr: number }[],
  eps: number,
  now: number,
  price: number,
): Level[] {
  type P = { p: number; t: number; tf: TF; kind: "h" | "l" };
  const pts: P[] = [];
  for (const s of sets) {
    const { highs, lows } = swings(s.c, 3);
    for (const h of highs.slice(-25)) pts.push({ p: h.p, t: h.t, tf: s.tf, kind: "h" });
    for (const l of lows.slice(-25)) pts.push({ p: l.p, t: l.t, tf: s.tf, kind: "l" });
  }
  pts.sort((a, b) => a.p - b.p);
  const clusters: P[][] = [];
  for (const p of pts) {
    const last = clusters[clusters.length - 1];
    if (last && p.p - last[last.length - 1].p <= eps && p.p - last[0].p <= 3 * eps) last.push(p);
    else clusters.push([p]);
  }
  const raw = clusters.map((cl) => {
    let s = 0;
    for (const p of cl) s += Math.exp(-(now - p.t) / (30 * 86_400_000)) * TF_WEIGHT[p.tf];
    return s;
  });
  const maxRaw = Math.max(1e-9, ...raw);
  const atrByTf = Object.fromEntries(sets.map((s) => [s.tf, s.atr])) as Record<TF, number>;
  return clusters.map((cl, idx) => {
    const lo = Math.min(...cl.map((p) => p.p));
    const hi = Math.max(...cl.map((p) => p.p));
    const topTf = cl.reduce((a, p) => (TF_WEIGHT[p.tf] > TF_WEIGHT[a] ? p.tf : a), cl[0].tf);
    const minW = 0.3 * (atrByTf[topTf] ?? eps);
    let low = lo;
    let high = hi;
    if (high - low < minW) {
      const mid = (high + low) / 2;
      low = mid - minW / 2;
      high = mid + minW / 2;
    }
    const sameKind = cl.filter((p) => p.kind === cl[0].kind).length;
    const lowerOnly = cl.every((p) => p.tf === "M15" || p.tf === "H1");
    const kind = sameKind >= 2 && lowerOnly ? "liquidity_pool" : "swing";
    const mid = (low + high) / 2;
    return {
      id: `lvl_${topTf}_${Math.round(mid)}_${idx}`,
      tf: topTf,
      kind,
      direction: mid < price ? "demand" : "supply",
      low,
      high,
      strength: clamp(Math.sqrt(raw[idx] / maxRaw), 0, 1),
      touches: cl.length,
      formedAt: Math.min(...cl.map((p) => p.t)),
      lastTestAt: Math.max(...cl.map((p) => p.t)),
      mitigated: false,
      confluences: Array.from(new Set(cl.map((p) => `${p.tf}_${p.kind === "h" ? "swing_high" : "swing_low"}`))),
    } as Level;
  });
}

/* ── liquidity sweeps ───────────────────────────────────────────── */

export function detectSweeps(c: Candle[], tf: TF, atrV: number, recent: number): Sweep[] {
  const out: Sweep[] = [];
  const { highs, lows } = swings(c, 3);
  for (let k = Math.max(0, c.length - recent); k < c.length; k++) {
    const knownLows = lows.filter((s) => s.i + 3 < k && k - s.i <= 80);
    const knownHighs = highs.filter((s) => s.i + 3 < k && k - s.i <= 80);
    const sl = knownLows[knownLows.length - 1];
    const sh = knownHighs[knownHighs.length - 1];
    const recency = 1 - (c.length - 1 - k) / (recent + 2);
    if (sl && c[k].l < sl.p && sl.p - c[k].l <= 0.5 * atrV && c[k].c > sl.p) {
      const depth = (sl.p - c[k].l) / (0.5 * atrV);
      const wick = (Math.min(c[k].o, c[k].c) - c[k].l) / Math.max(c[k].h - c[k].l, 1e-9);
      out.push({ tf, dir: "bull", at: c[k].t, level: sl.p, extreme: c[k].l, score: clamp((0.5 + 0.3 * depth + 0.3 * wick) * recency, 0, 1) });
    }
    if (sh && c[k].h > sh.p && c[k].h - sh.p <= 0.5 * atrV && c[k].c < sh.p) {
      const depth = (c[k].h - sh.p) / (0.5 * atrV);
      const wick = (c[k].h - Math.max(c[k].o, c[k].c)) / Math.max(c[k].h - c[k].l, 1e-9);
      out.push({ tf, dir: "bear", at: c[k].t, level: sh.p, extreme: c[k].h, score: clamp((0.5 + 0.3 * depth + 0.3 * wick) * recency, 0, 1) });
    }
  }
  return out;
}

/* ── candle patterns ─────────────────────────────────────────────── */

export function candlePattern(c: Candle[]): PatternInfo | null {
  if (c.length < 2) return null;
  const a = c[c.length - 2];
  const b = c[c.length - 1];
  const range = Math.max(b.h - b.l, 1e-9);
  const bodyB = Math.abs(b.c - b.o);
  const bodyA = Math.abs(a.c - a.o);
  if (a.c < a.o && b.c > b.o && b.c >= a.o && b.o <= a.c && bodyB > bodyA * 1.05)
    return { name: "engulfing", dir: "bull", quality: clamp(0.5 + (bodyB / Math.max(bodyA, 1e-9) - 1) * 0.25, 0, 1), at: b.t };
  if (a.c > a.o && b.c < b.o && b.c <= a.o && b.o >= a.c && bodyB > bodyA * 1.05)
    return { name: "engulfing", dir: "bear", quality: clamp(0.5 + (bodyB / Math.max(bodyA, 1e-9) - 1) * 0.25, 0, 1), at: b.t };
  const lower = Math.min(b.o, b.c) - b.l;
  const upper = b.h - Math.max(b.o, b.c);
  if (lower >= 2 * bodyB && lower >= 0.6 * range) return { name: "pin_bar", dir: "bull", quality: clamp(lower / range, 0, 1), at: b.t };
  if (upper >= 2 * bodyB && upper >= 0.6 * range) return { name: "pin_bar", dir: "bear", quality: clamp(upper / range, 0, 1), at: b.t };
  if (bodyB < 0.1 * range) return { name: "doji", dir: "neutral", quality: 0.3, at: b.t };
  return null;
}

/* ── RSI divergence ──────────────────────────────────────────────── */

export function rsiDivergence(c: Candle[], tf: TF): Divergence | null {
  if (c.length < 40) return null;
  const rsi = rsiSeries(c, 14);
  const { highs, lows } = swings(c.slice(-60), 2);
  const off = Math.max(0, c.length - 60);
  const recentLimit = 12;
  if (lows.length >= 2) {
    const [p1, p2] = lows.slice(-2);
    if (c.length - 1 - (p2.i + off) <= recentLimit && p2.p < p1.p && rsi[p2.i + off] > rsi[p1.i + off] + 1)
      return { tf, dir: "bull", strength: clamp((rsi[p2.i + off] - rsi[p1.i + off]) / 10, 0.2, 1), at: p2.t };
  }
  if (highs.length >= 2) {
    const [p1, p2] = highs.slice(-2);
    if (c.length - 1 - (p2.i + off) <= recentLimit && p2.p > p1.p && rsi[p2.i + off] < rsi[p1.i + off] - 1)
      return { tf, dir: "bear", strength: clamp((rsi[p1.i + off] - rsi[p2.i + off]) / 10, 0.2, 1), at: p2.t };
  }
  return null;
}

/* ── volume profile ──────────────────────────────────────────────── */

export function volumeProfile(c: Candle[], nBins = 50): VolumeProfile | null {
  if (c.length < 20) return null;
  const totalVol = c.reduce((s, x) => s + x.v, 0);
  if (totalVol <= 0) return null;
  const lo = Math.min(...c.map((x) => x.l));
  const hi = Math.max(...c.map((x) => x.h));
  const step = (hi - lo) / nBins || 1;
  const vol = new Array(nBins).fill(0);
  for (const x of c) {
    const a = Math.max(0, Math.floor((x.l - lo) / step));
    const b = Math.min(nBins - 1, Math.floor((x.h - lo) / step));
    const share = x.v / (b - a + 1);
    for (let k = a; k <= b; k++) vol[k] += share;
  }
  let poc = 0;
  for (let k = 1; k < nBins; k++) if (vol[k] > vol[poc]) poc = k;
  let lowI = poc;
  let highI = poc;
  let acc = vol[poc];
  while (acc < totalVol * 0.7 && (lowI > 0 || highI < nBins - 1)) {
    const up = highI < nBins - 1 ? vol[highI + 1] : -1;
    const dn = lowI > 0 ? vol[lowI - 1] : -1;
    if (up >= dn) acc += vol[++highI];
    else acc += vol[--lowI];
  }
  const mean = totalVol / nBins;
  const hvn: number[] = [];
  const lvn: number[] = [];
  for (let k = 1; k < nBins - 1; k++) {
    const p = lo + (k + 0.5) * step;
    if (vol[k] > vol[k - 1] && vol[k] > vol[k + 1] && vol[k] > 1.2 * mean) hvn.push(p);
    if (vol[k] < vol[k - 1] && vol[k] < vol[k + 1] && vol[k] < 0.6 * mean) lvn.push(p);
  }
  return {
    poc: lo + (poc + 0.5) * step,
    vah: lo + (highI + 1) * step,
    val: lo + lowI * step,
    hvn,
    lvn,
    bins: vol.map((v, k) => ({ price: lo + (k + 0.5) * step, vol: v })),
  };
}

/* ── misc ────────────────────────────────────────────────────────── */

export function sessionAt(t: number): Session {
  const h = new Date(t).getUTCHours();
  if (h < 7) return "asia";
  if (h < 13) return "london";
  if (h < 21) return "newyork";
  return "off";
}

export function atrPercentile(c: Candle[]): number {
  const s = atrSeries(c.slice(-400), 14);
  return percentileRank(s.slice(20), s[s.length - 1]);
}

export { atr, TF_MS };
