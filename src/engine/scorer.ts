import {
  atr,
  atrPercentile,
  candlePattern,
  detectSweeps,
  fvgs,
  marketStructure,
  orderBlocks,
  rsiDivergence,
  sessionAt,
  swingLevels,
  volumeProfile,
} from "./analysis";
import { activeBlackout, nextHighImpact } from "./calendar";
import { clamp } from "./indicators";
import type {
  Analysis,
  CalendarEvent,
  Candidate,
  CandleSet,
  Confluence,
  Dir,
  FactorKey,
  Level,
  SetupType,
  StructureInfo,
  TF,
  Trend,
  Weights,
} from "./types";
import { FACTORS, FACTOR_LABEL } from "./types";

export const PUBLISH_WCS = 70;
export const CANDIDATE_WCS = 55;

export interface ScoreContext {
  weights: Weights;
  calendar: CalendarEvent[];
  sentiment: number | null;
  spread: number;
  quoteAgeMs: number; // live only; 0 in backtest
  openDirs: Dir[]; // directions of pending/active signals
  blockedTypes: SetupType[];
}

const fmt = (x: number) => x.toFixed(2);

export function analyze(set: CandleSet, t: number, ctx: ScoreContext): Analysis {
  const m15 = set.M15;
  const price = m15[m15.length - 1].c;
  const atrV: Record<TF, number> = {
    M15: atr(m15),
    H1: atr(set.H1),
    H4: atr(set.H4),
    D1: atr(set.D1),
  };

  const ms: Record<TF, ReturnType<typeof marketStructure>> = {
    M15: marketStructure(m15.slice(-200)),
    H1: marketStructure(set.H1.slice(-300)),
    H4: marketStructure(set.H4.slice(-200)),
    D1: marketStructure(set.D1.slice(-150)),
  };
  const structure = Object.fromEntries(
    (Object.keys(ms) as TF[]).map((k) => [k, { trend: ms[k].trend, lastEvent: ms[k].lastEvent, swingHighs: ms[k].swingHighs, swingLows: ms[k].swingLows }]),
  ) as Record<TF, StructureInfo>;

  // ── levels ──
  const levels: Level[] = [
    ...orderBlocks(set.H1.slice(-300), ms.H1.events, "H1", atrV.H1),
    ...orderBlocks(set.H4.slice(-200), ms.H4.events, "H4", atrV.H4),
    ...swingLevels(
      [
        { tf: "M15", c: m15.slice(-200), atr: atrV.M15 },
        { tf: "H1", c: set.H1.slice(-300), atr: atrV.H1 },
        { tf: "H4", c: set.H4.slice(-200), atr: atrV.H4 },
        { tf: "D1", c: set.D1.slice(-150), atr: atrV.D1 },
      ],
      0.25 * atrV.D1,
      t,
      price,
    ),
    ...fvgs(m15.slice(-200), "M15", atrV.M15, 40),
    ...fvgs(set.H1.slice(-200), "H1", atrV.H1, 40),
  ].filter((l) => Math.abs((l.low + l.high) / 2 - price) < 6 * atrV.H4);
  // FVG overlap confluence
  for (const l of levels) {
    if (l.kind === "fvg") continue;
    if (levels.some((f) => f.kind === "fvg" && f.direction === l.direction && f.low < l.high && f.high > l.low)) l.confluences.push("fvg_overlap");
  }

  const sweeps = [...detectSweeps(m15.slice(-150), "M15", atrV.M15, 8), ...detectSweeps(set.H1.slice(-150), "H1", atrV.H1, 3)];
  const pattern = candlePattern(m15);
  const divergences = [rsiDivergence(set.H1.slice(-200), "H1"), rsiDivergence(set.H4.slice(-200), "H4")].filter(Boolean) as Analysis["divergences"];
  const vp = volumeProfile(set.H1.slice(-480));
  const atrPct = atrPercentile(set.H1);
  const blackout = activeBlackout(ctx.calendar, t);
  const nhi = nextHighImpact(ctx.calendar, t);

  // ── factor scores shared by direction ──
  const structScore = (d: Dir) => {
    const e = ms.H1.events[ms.H1.events.length - 1];
    let s = 0;
    if (e && e.dir === (d === "long" ? "up" : "down")) {
      const age = set.H1.slice(-300).length - 1 - e.i;
      s = (e.type === "BOS" ? 1 : 0.8) * (age <= 48 ? 1 : age <= 96 ? 0.6 : 0.3);
    }
    const em = ms.M15.events[ms.M15.events.length - 1];
    if (em && em.dir === (d === "long" ? "up" : "down") && s < 0.5) s = Math.max(s, 0.4);
    return s;
  };
  const sweepScore = (d: Dir) => Math.max(0, ...sweeps.filter((s) => s.dir === (d === "long" ? "bull" : "bear")).map((s) => s.score));
  const divScore = (d: Dir) => Math.max(0, ...divergences.filter((x) => x.dir === (d === "long" ? "bull" : "bear")).map((x) => x.strength));
  const d1Score = (d: Dir) => {
    const tr = ms.D1.trend;
    if (tr === "range") return 0.5;
    return tr === (d === "long" ? "up" : "down") ? 1 : 0;
  };
  const vpScore = (entry: number, d: Dir) => {
    if (!vp) return 0;
    const near = (x: number) => Math.abs(x - entry) <= 0.35 * atrV.H1;
    if (vp.lvn.some(near) || near(d === "long" ? vp.val : vp.vah)) return 0.8;
    if (near(vp.poc)) return 0.4;
    return 0.2;
  };
  const sentScore = (d: Dir) => (ctx.sentiment == null ? 0 : Math.max(0, d === "long" ? ctx.sentiment : -ctx.sentiment));
  const patternScore = (d: Dir, zone: Level | null, entry: number, always: boolean) => {
    if (!pattern) return 0;
    const inZone = always || (zone ? price >= zone.low - 0.3 * atrV.H1 && price <= zone.high + 0.3 * atrV.H1 : Math.abs(price - entry) < 0.3 * atrV.H1);
    if (!inZone) return 0;
    if (pattern.dir === "neutral") return 0.2;
    return pattern.dir === (d === "long" ? "bull" : "bear") ? pattern.quality : 0;
  };

  const available: Record<FactorKey, boolean> = {
    zone: true,
    sweep: true,
    structure: true,
    pattern: true,
    rsi_div: true,
    sentiment: ctx.sentiment != null,
    d1_trend: true,
    vp: vp != null,
  };

  const wcsOf = (scores: Record<FactorKey, number>) => {
    let num = 0;
    let den = 0;
    for (const f of FACTORS) {
      if (!available[f]) continue;
      num += ctx.weights[f] * scores[f];
      den += ctx.weights[f];
    }
    return den ? Math.round((100 * num) / den) : 0;
  };

  const opposingLevels = (d: Dir) =>
    levels.filter(
      (l) =>
        l.kind !== "fvg" &&
        l.strength >= 0.5 &&
        (d === "long" ? l.direction === "supply" && l.low > price : l.direction === "demand" && l.high < price),
    );

  const zoneNear = (d: Dir, p: number) =>
    levels
      .filter((l) => l.kind !== "fvg" && l.direction === (d === "long" ? "demand" : "supply") && p >= l.low - 0.5 * atrV.H1 && p <= l.high + 0.5 * atrV.H1)
      .sort((a, b) => b.strength - a.strength)[0] ?? null;

  const build = (d: Dir, type: SetupType, entry: number, sl: number, zone: Level | null, notes: string[]): Candidate => {
    const sgn = d === "long" ? 1 : -1;
    const R = Math.abs(entry - sl);
    const opp = opposingLevels(d)
      .map((l) => ({ l, edge: d === "long" ? l.low : l.high }))
      .sort((a, b) => sgn * (a.edge - b.edge));
    const tp1 = entry + sgn * R;
    const tp2 = entry + sgn * 2 * R;
    let tp3 = entry + sgn * 3 * R;
    const liq = opp.find((o) => sgn * (o.edge - entry) >= 2.2 * R);
    if (liq) tp3 = entry + sgn * Math.min(Math.abs(liq.edge - entry) - 0.05 * atrV.H1, 4 * R);
    const blocker = opp.find((o) => sgn * (o.edge - entry) > 0.3 * R && sgn * (o.edge - entry) < 2 * R);
    const rrTp2 = blocker ? Math.abs(blocker.edge - entry) / R : 2;
    const rr = Math.abs(tp3 - entry) / R;

    const zoneS = zone ? clamp(zone.strength * (zone.tf === "H4" || zone.tf === "D1" ? 1 : 0.75) + (zone.confluences.includes("fvg_overlap") ? 0.1 : 0), 0, 1) : 0;
    const scores: Record<FactorKey, number> = {
      zone: zoneS,
      sweep: sweepScore(d),
      structure: structScore(d),
      pattern: patternScore(d, zone, entry, type === "market_trigger"),
      rsi_div: divScore(d),
      sentiment: sentScore(d),
      d1_trend: d1Score(d),
      vp: vpScore(entry, d),
    };
    const wcs = wcsOf(scores);
    const vetoes: string[] = [];
    if (blackout) vetoes.push(`news_blackout: ${blackout.title}`);
    if (rrTp2 < 2) vetoes.push(`rr_filter: R:R до TP2 = ${rrTp2.toFixed(2)} < 2.0 (уровень ${blocker ? fmt(blocker.edge) : ""})`);
    const d1 = ms.D1;
    if (d1.trend === (d === "long" ? "down" : "up") && !(d1.lastEvent?.type === "CHoCH" && d1.lastEvent.dir === (d === "long" ? "up" : "down")))
      vetoes.push("conflict_d1: сетап против тренда D1 без CHoCH");
    if (ctx.quoteAgeMs > 120_000) vetoes.push(`stale_data: котировка устарела (${Math.round(ctx.quoteAgeMs / 1000)} c)`);
    if (R > 1.5 * atrV.H1) vetoes.push(`zone_too_wide: стоп ${fmt(R)} > 1.5·ATR(H1)`);
    if (ctx.openDirs.includes(d)) vetoes.push("duplicate: активный сигнал в этом направлении уже есть");
    if (ctx.blockedTypes.includes(type)) vetoes.push("circuit_breaker: тип сетапа заблокирован после 3 SL с одной причиной");

    const confluences: Confluence[] = FACTORS.filter((f) => available[f] && scores[f] > 0.05)
      .map((f) => ({ factor: f, label: factorText(f, d, zone, scores[f]), weight: ctx.weights[f], score: Math.round(scores[f] * 100) / 100 }))
      .sort((a, b) => b.weight * b.score - a.weight * a.score);

    return { dir: d, type, entry, sl, tps: [tp1, tp2, tp3], rr, rrTp2, wcs, scores, available, confluences, zone, vetoes, notes };
  };

  const factorText = (f: FactorKey, d: Dir, zone: Level | null, s: number): string => {
    switch (f) {
      case "zone":
        return zone ? `${zone.tf} ${zone.kind === "order_block" ? "order block" : zone.kind === "liquidity_pool" ? "пул ликвидности" : "swing-зона"} ${fmt(zone.low)}–${fmt(zone.high)}` : FACTOR_LABEL.zone;
      case "sweep": {
        const sw = sweeps.filter((x) => x.dir === (d === "long" ? "bull" : "bear")).sort((a, b) => b.score - a.score)[0];
        return sw ? `Liquidity sweep ${sw.tf} (${d === "long" ? "под" : "над"} ${fmt(sw.level)})` : FACTOR_LABEL.sweep;
      }
      case "structure": {
        const e = ms.H1.lastEvent;
        return e ? `${e.type} H1 ${e.dir === "up" ? "вверх" : "вниз"} (${fmt(e.price)})` : "Структура M15 по направлению";
      }
      case "pattern":
        return pattern ? `${pattern.name === "engulfing" ? "Engulfing" : pattern.name === "pin_bar" ? "Pin bar" : "Doji"} M15 в зоне` : FACTOR_LABEL.pattern;
      case "rsi_div": {
        const dv = divergences.find((x) => x.dir === (d === "long" ? "bull" : "bear"));
        return dv ? `RSI divergence ${dv.tf} (${dv.dir})` : FACTOR_LABEL.rsi_div;
      }
      case "sentiment":
        return `Сантимент новостей ${ctx.sentiment! >= 0 ? "+" : ""}${ctx.sentiment!.toFixed(2)}`;
      case "d1_trend":
        return `Тренд D1: ${ms.D1.trend === "up" ? "вверх" : ms.D1.trend === "down" ? "вниз" : "диапазон"}`;
      case "vp":
        return s >= 0.8 ? "Вход у LVN / края value area" : s >= 0.4 ? "Вход у POC" : "Volume Profile: нейтрально";
    }
    return FACTOR_LABEL[f] + ` ${s}`;
  };

  // ── candidate setups ──
  const candidates: Candidate[] = [];
  for (const d of ["long", "short"] as Dir[]) {
    const sgn = d === "long" ? 1 : -1;
    // 1) limit from zone
    const zones = levels
      .filter((l) => l.kind !== "fvg" && l.direction === (d === "long" ? "demand" : "supply"))
      .filter((l) => (l.kind === "order_block" || l.tf === "H4" || l.tf === "D1" || l.strength >= 0.5))
      .map((l) => {
        const proximal = d === "long" ? l.high : l.low;
        const dist = sgn * (price - proximal);
        return { l, dist };
      })
      .filter((z) => z.dist >= 0.25 * atrV.H1 && z.dist <= 1.5 * atrV.H4)
      .sort((a, b) => b.l.strength / (1 + b.dist / atrV.H1) - a.l.strength / (1 + a.dist / atrV.H1));
    if (zones[0]) {
      const z = zones[0].l;
      const notes: string[] = [];
      let low = z.low;
      let high = z.high;
      if (high - low > 1.0 * atrV.H1) {
        if (d === "long") low = high - 1.0 * atrV.H1;
        else high = low + 1.0 * atrV.H1;
        notes.push("зона уточнена до проксимальной части (1·ATR H1)");
      }
      const entry = d === "long" ? high + 0.1 * atrV.H1 : low - 0.1 * atrV.H1;
      const sl = d === "long" ? low - 0.3 * atrV.H1 : high + 0.3 * atrV.H1;
      candidates.push(build(d, "limit_zone", entry, sl, z, notes));
    }
    // 2) stop on breakout (trend continuation)
    const ev = ms.H1.events[ms.H1.events.length - 1];
    if (ev && ev.dir === (d === "long" ? "up" : "down") && ev.type === "BOS") {
      const ext = d === "long" ? ms.H1.swingHighs : ms.H1.swingLows;
      const target = [...ext].reverse().find((s) => sgn * (s.p - price) > 0 && sgn * (s.p - price) <= 0.8 * atrV.H1);
      const hl = (d === "long" ? ms.M15.swingLows : ms.M15.swingHighs).filter((s) => sgn * (price - s.p) > 0).slice(-1)[0];
      if (target && hl) {
        const entry = target.p + sgn * (0.1 * atrV.H1 + ctx.spread);
        const sl = hl.p - sgn * 0.1 * atrV.H1;
        candidates.push(build(d, "stop_breakout", entry, sl, zoneNear(d, hl.p), []));
      }
    }
    // 3) market-on-trigger after sweep + confirmation
    const last = m15[m15.length - 1];
    const sw = sweeps.filter((s) => s.tf === "M15" && s.dir === (d === "long" ? "bull" : "bear") && last.t - s.at <= 15 * 60_000).sort((a, b) => b.at - a.at)[0];
    const confirmed = d === "long" ? last.c > last.o && last.c > (sw?.level ?? Infinity) : last.c < last.o && last.c < (sw?.level ?? -Infinity);
    if (sw && confirmed) {
      const entry = price;
      const sl = d === "long" ? Math.min(sw.extreme - 0.1 * atrV.H1, entry - 0.4 * atrV.H1) : Math.max(sw.extreme + 0.1 * atrV.H1, entry + 0.4 * atrV.H1);
      candidates.push(build(d, "market_trigger", entry, sl, zoneNear(d, sw.extreme), ["вход по закрытию подтверждающей свечи M15"]));
    }
  }

  // baseline directional WCS (even with no setup)
  const baseline = (d: Dir) =>
    wcsOf({ zone: 0, sweep: sweepScore(d), structure: structScore(d), pattern: patternScore(d, null, price, false), rsi_div: divScore(d), sentiment: sentScore(d), d1_trend: d1Score(d), vp: 0.2 });
  const bestOf = (d: Dir) => Math.max(baseline(d), ...candidates.filter((c) => c.dir === d).map((c) => c.wcs));
  const wcsLong = bestOf("long");
  const wcsShort = bestOf("short");

  const valid = candidates.filter((c) => c.vetoes.length === 0 && c.wcs >= PUBLISH_WCS).sort((a, b) => b.wcs - a.wcs);
  const best = valid[0] ?? null;

  const rejections: string[] = [];
  if (!best) {
    if (!candidates.length) rejections.push("Нет сетапа: цена вдали от валидных зон, нет sweep-триггера и пробойной структуры");
    for (const c of [...candidates].sort((a, b) => b.wcs - a.wcs).slice(0, 3)) {
      const why = c.wcs < PUBLISH_WCS ? `WCS ${c.wcs} < ${PUBLISH_WCS}` : c.vetoes[0];
      rejections.push(`${c.dir.toUpperCase()} · ${c.type === "limit_zone" ? "limit" : c.type === "stop_breakout" ? "stop" : "market"} @ ${fmt(c.entry)}: ${why}`);
    }
  }

  const trendVal = (tr: Trend) => (tr === "up" ? 1 : tr === "down" ? -1 : 0);
  const tScore = trendVal(ms.H1.trend) + 1.5 * trendVal(ms.H4.trend) + 2 * trendVal(ms.D1.trend) + (wcsLong - wcsShort) / 15;
  const bias = tScore > 1 ? "bullish" : tScore < -1 ? "bearish" : "neutral";

  return {
    at: t,
    price,
    atr: atrV,
    atrPercentileH1: atrPct,
    structure,
    levels,
    sweeps,
    pattern,
    divergences,
    vp,
    sentiment: ctx.sentiment,
    session: sessionAt(t),
    bias,
    wcsLong,
    wcsShort,
    best,
    candidates,
    rejections,
    blackout,
    nextHighImpact: nhi,
  };
}
