import type { Candle } from "./types";

export function atr(c: Candle[], period = 14): number {
  if (c.length < 2) return c.length ? c[0].h - c[0].l : 0;
  const n = Math.min(period, c.length - 1);
  // Wilder smoothing over the available tail (bounded window for speed)
  const start = Math.max(1, c.length - period * 4);
  let a = 0;
  let first = true;
  for (let i = start; i < c.length; i++) {
    const tr = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
    if (first) {
      a = tr;
      first = false;
    } else a = (a * (n - 1) + tr) / n;
  }
  return a;
}

export function atrSeries(c: Candle[], period = 14): number[] {
  const out: number[] = new Array(c.length).fill(0);
  let a = 0;
  for (let i = 0; i < c.length; i++) {
    const tr =
      i === 0
        ? c[i].h - c[i].l
        : Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
    a = i === 0 ? tr : (a * (period - 1) + tr) / period;
    out[i] = a;
  }
  return out;
}

export function rsiSeries(c: Candle[], period = 14): number[] {
  const out: number[] = new Array(c.length).fill(50);
  let g = 0;
  let l = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i].c - c[i - 1].c;
    const up = Math.max(d, 0);
    const dn = Math.max(-d, 0);
    if (i <= period) {
      g += up / period;
      l += dn / period;
    } else {
      g = (g * (period - 1) + up) / period;
      l = (l * (period - 1) + dn) / period;
    }
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

export function percentileRank(values: number[], v: number): number {
  if (!values.length) return 0.5;
  let below = 0;
  for (const x of values) if (x <= v) below++;
  return below / values.length;
}

/** index of the last candle whose close time <= t */
export function closedUpTo(c: Candle[], t: number, tfMs: number): number {
  let lo = 0;
  let hi = c.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (c[mid].t + tfMs <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export const round2 = (x: number) => Math.round(x * 100) / 100;
export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
