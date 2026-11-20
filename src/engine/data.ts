import type { Candle, CandleSet } from "./types";
import { TF_MS } from "./types";

export const HISTORY_DAYS = 45;

/* ── demo market (deterministic synthetic XAUUSD) ──────────────────── */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class DemoMarket {
  private r: () => number;
  private price = 3890;
  private vol = 0.0011;
  private drift = 0;
  private regimeLeft = 0;
  m15: Candle[] = [];

  constructor(seed = 20261120) {
    this.r = rng(seed);
  }

  private gauss() {
    const u = Math.max(1e-12, this.r());
    const v = this.r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  private nextCandle(t: number): Candle {
    if (this.regimeLeft <= 0) {
      this.regimeLeft = 40 + Math.floor(this.r() * 200);
      const k = this.r();
      this.drift = k < 0.36 ? 0.00012 : k < 0.7 ? -0.0001 : 0;
      this.vol = 0.0007 + this.r() * 0.0011;
    }
    this.regimeLeft--;
    const hour = new Date(t).getUTCHours();
    const sess = hour >= 13 && hour < 17 ? 1.6 : hour >= 7 && hour < 13 ? 1.25 : 0.7;
    const o = this.price;
    let p = o;
    let h = o;
    let l = o;
    for (let i = 0; i < 6; i++) {
      p *= 1 + this.drift / 6 + (this.vol * sess * this.gauss()) / Math.sqrt(6);
      h = Math.max(h, p);
      l = Math.min(l, p);
    }
    const wick = this.vol * sess * o * 0.35;
    h += this.r() * wick;
    l -= this.r() * wick;
    this.price = p;
    return { t, o: r2(o), h: r2(h), l: r2(l), c: r2(p), v: Math.round(800 * sess * (0.6 + this.r())) };
  }

  /** builds history up to `now` (open time of the forming candle excluded) */
  build(now: number, days: number) {
    const step = TF_MS.M15;
    const end = Math.floor(now / step) * step;
    for (let t = end - days * 86_400_000; t < end; t += step) this.m15.push(this.nextCandle(t));
    return this.set(now);
  }

  /** advances to now; returns the forming candle with intra-candle jitter */
  advance(now: number) {
    const step = TF_MS.M15;
    const end = Math.floor(now / step) * step;
    let last = this.m15[this.m15.length - 1].t;
    while (last + step < end) {
      last += step;
      this.m15.push(this.nextCandle(last));
    }
    return this.set(now);
  }

  set(now: number): CandleSet {
    const step = TF_MS.M15;
    const formingT = Math.floor(now / step) * step;
    const frac = (now - formingT) / step;
    const prev = this.m15[this.m15.length - 1];
    // forming candle: deterministic-ish path from prev close
    const seed = rng(formingT / 1000)();
    const r = rng(Math.floor(now / 3000));
    const c = r2(prev.c * (1 + (seed - 0.5) * 0.002 * frac + (r() - 0.5) * 0.0004));
    const forming: Candle = { t: formingT, o: prev.c, h: r2(Math.max(prev.c, c) + 0.2), l: r2(Math.min(prev.c, c) - 0.2), c, v: Math.round(400 * frac) };
    const M15 = [...this.m15, forming];
    return { M15, H1: aggregate(M15, TF_MS.H1), H4: aggregate(M15, TF_MS.H4), D1: aggregate(M15, TF_MS.D1) };
  }
}

export function aggregate(c: Candle[], ms: number): Candle[] {
  const out: Candle[] = [];
  for (const x of c) {
    const t = Math.floor(x.t / ms) * ms;
    const last = out[out.length - 1];
    if (last && last.t === t) {
      last.h = Math.max(last.h, x.h);
      last.l = Math.min(last.l, x.l);
      last.c = x.c;
      last.v += x.v;
    } else out.push({ ...x, t });
  }
  return out;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
