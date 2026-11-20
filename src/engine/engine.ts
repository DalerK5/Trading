import { marketStructure } from "./analysis";
import { closedUpTo } from "./indicators";
import { analyze, PUBLISH_WCS, type ScoreContext } from "./scorer";
import type {
  Analysis,
  CalendarEvent,
  Candidate,
  Candle,
  CandleSet,
  Cause,
  Dir,
  EngineState,
  FactorKey,
  Report,
  SetupType,
  Signal,
  SignalEvent,
  TF,
  Weights,
} from "./types";
import { CAUSE_LABEL, FACTORS, INITIAL_WEIGHTS, SETUP_LABEL, TF_MS, TERMINAL } from "./types";

export const SCHEMA = 3;
export const ETA = 0.05;
const TTL_MS = 12 * 3_600_000;
const MAX_ACTIVE_MS = 5 * 86_400_000;
const WINDOW: Record<TF, number> = { M15: 300, H1: 500, H4: 300, D1: 200 };

export function initialState(source: EngineState["source"]): EngineState {
  return {
    schema: SCHEMA,
    source,
    lastTs: 0,
    seq: 0,
    weights: { ...INITIAL_WEIGHTS },
    version: "0.1.0",
    versions: [{ version: "0.1.0", weights: { ...INITIAL_WEIGHTS }, activatedAt: 0, status: "live" }],
    signals: [],
    reports: {},
    journal: [],
    pendingRewards: Object.fromEntries(FACTORS.map((f) => [f, []])) as unknown as EngineState["pendingRewards"],
    blocks: [],
    skipped: [],
  };
}

export interface PushEvent {
  event: string;
  signalId?: string;
  title: string;
  body: string;
  priority: "high" | "normal" | "low";
  at: number;
}

export const fmtP = (x: number) => x.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(",", ".");
const dirRu = (d: Dir) => (d === "long" ? "LONG" : "SHORT");
const orderRu = (s: Signal | Candidate) =>
  s.type === "limit_zone" ? (s.dir === "long" ? "Buy limit" : "Sell limit") : s.type === "stop_breakout" ? (s.dir === "long" ? "Buy stop" : "Sell stop") : s.dir === "long" ? "Buy market" : "Sell market";

export function windowAt(set: CandleSet, t: number): CandleSet | null {
  const out = {} as CandleSet;
  for (const tf of Object.keys(WINDOW) as TF[]) {
    const idx = closedUpTo(set[tf], t, TF_MS[tf]);
    if (idx < 30) return null;
    out[tf] = set[tf].slice(Math.max(0, idx - WINDOW[tf] + 1), idx + 1);
  }
  return out;
}

/* ── rationale (deterministic template; LLM may replace it in live mode) ── */

export function templateRationale(c: Candidate, a: Analysis): string {
  const z = c.zone;
  const dirWord = c.dir === "long" ? "покупку" : "продажу";
  const parts: string[] = [];
  const top = c.confluences.slice(0, 3).map((x) => x.label);
  if (c.type === "limit_zone" && z)
    parts.push(
      `Цена ${c.dir === "long" ? "откатывает к зоне спроса" : "подходит к зоне предложения"} ${fmtP(z.low)}–${fmtP(z.high)} (${z.tf}, сила ${z.strength.toFixed(2)}, касаний ${z.touches}).`,
    );
  if (c.type === "stop_breakout") parts.push(`Структура H1 продолжает тренд — сетап на ${dirWord} при пробое экстремума ${fmtP(c.entry)}.`);
  if (c.type === "market_trigger") parts.push(`Ликвидность ${c.dir === "long" ? "под минимумом" : "над максимумом"} снята, M15 закрылась обратно в диапазон — подтверждение реакции.`);
  if (top.length) parts.push(`Ключевые факторы: ${top.join("; ")}.`);
  parts.push(
    `Вход ${c.type === "limit_zone" ? "лимитным ордером" : c.type === "stop_breakout" ? "стоп-ордером" : "по рынку"} ${fmtP(c.entry)}, стоп ${fmtP(c.sl)} за ${c.type === "limit_zone" ? "зоной" : "экстремумом"}; после TP1 — перенос стопа в безубыток.`,
  );
  parts.push(
    `Сценарий отменяется при CHoCH ${c.dir === "long" ? "вниз" : "вверх"} на H1 до активации или по истечении 12 ч. Тренд D1: ${a.structure.D1.trend === "up" ? "вверх" : a.structure.D1.trend === "down" ? "вниз" : "диапазон"}.`,
  );
  return parts.join(" ");
}

/* ── post-trade analysis (deterministic taxonomy) ── */

function classify(s: Signal, m15: Candle[], calendar: CalendarEvent[], a: Analysis): Omit<Report, "weightChanges" | "createdAt"> {
  const sgn = s.dir === "long" ? 1 : -1;
  const R = Math.abs(s.entry - s.sl);
  const t0 = s.activatedAt ?? s.publishedAt;
  const t1 = s.closedAt ?? a.at;
  const win = s.maxTp >= 1;
  const fmtT = (t: number) => new Date(t).toISOString().slice(5, 16).replace("T", " ");
  if (s.status === "cancelled")
    return { signalId: s.id, outcome: "cancelled", rMultiple: 0, primaryCause: "NONE", evidence: [s.cancelReason ?? "Отмена до активации"], counterfactual: "Отмена до входа — риск не был взят; это плюс к дисциплине.", lessonTags: ["cancelled", "discipline"], by: "rule-engine", confidence: 0.9 };
  if (win) {
    const ev = [`Вход ${fmtT(t0)} по ${fmtP(s.entry)}; достигнут TP${s.maxTp}`, `Итог ${s.rMultiple! >= 0 ? "+" : ""}${s.rMultiple!.toFixed(2)}R`];
    if (s.maxTp < 3) ev.push("Остаток позиции закрыт в безубыток после переноса стопа");
    return {
      signalId: s.id,
      outcome: s.status,
      rMultiple: s.rMultiple ?? 0,
      primaryCause: "NONE",
      evidence: ev,
      counterfactual: s.maxTp < 3 ? "Цель TP3 не достигнута — возможно, ликвидность была ближе. Фиксация 50% на TP1 сохранила результат." : "Сценарий отработал полностью.",
      lessonTags: ["win", s.type, s.snapshot.session],
      by: "rule-engine",
      confidence: 0.85,
    };
  }
  const after = m15.filter((c) => c.t >= t0 - TF_MS.M15 && c.t <= t1);
  const evidence: string[] = [];
  let cause: Cause = "LEVEL_ERROR";
  let conf = 0.55;
  const news = calendar.find((e) => e.impact !== "low" && e.at >= t0 - 30 * 60_000 && e.at <= t1 + 15 * 60_000);
  const firstThree = after.slice(0, 4);
  const returned = firstThree.some((c) => sgn * (c.c - s.entry) < -0.5 * R);
  const ms = marketStructure(m15.filter((c) => c.t <= t1).slice(-200));
  const against = ms.events.find((e) => e.at > t0 && e.at <= t1 && e.dir === (s.dir === "long" ? "down" : "up"));
  const actCandle = after.find((c) => c.t >= t0 - TF_MS.M15);
  if (news) {
    cause = "NEWS_SPIKE";
    conf = 0.8;
    evidence.push(`${fmtT(news.at)}: ${news.title} (${news.impact}) — внутри окна сделки`);
  } else if ((s.type === "stop_breakout" || s.type === "market_trigger") && returned) {
    cause = "FALSE_BREAKOUT";
    conf = 0.75;
    evidence.push(`В первые 3 свечи M15 после входа цена вернулась за уровень входа более чем на 0.5R`);
  } else if (against) {
    cause = "STRUCTURE_SHIFT";
    conf = 0.7;
    evidence.push(`${fmtT(against.at)}: ${against.type} M15 ${against.dir === "up" ? "вверх" : "вниз"} против позиции до TP1 (${fmtP(against.price)})`);
  } else if (R < 1.0 * a.atr.H1 && a.atrPercentileH1 > 0.8) {
    cause = "WIDE_STOP";
    conf = 0.7;
    evidence.push(`Стоп ${fmtP(R)} < 1.0·ATR(H1)=${fmtP(a.atr.H1)} при ATR-перцентиле ${a.atrPercentileH1.toFixed(2)}`);
  } else if (s.type === "limit_zone" && s.scores.pattern === 0 && actCandle && sgn * (actCandle.c - s.entry) < 0) {
    cause = "EARLY_ENTRY";
    conf = 0.65;
    evidence.push(`Активация ${fmtT(actCandle.t)}: свеча закрылась за уровнем входа (${fmtP(actCandle.c)}), подтверждающего паттерна не было`);
  } else {
    evidence.push(`Зона входа пробита без реакции: SL ${fmtP(s.sl)} достигнут ${fmtT(t1)}`);
  }
  evidence.push(`Сессия входа: ${s.snapshot.session}, WCS ${s.wcs}, ATR-перцентиль ${s.snapshot.atrPercentileH1.toFixed(2)}`);
  const cf: Record<Cause, string> = {
    FALSE_BREAKOUT: "При требовании закрытия M15 за уровнем и удержания 2 свечей вход бы не состоялся.",
    NEWS_SPIKE: "Расширенное blackout-окно вокруг события исключило бы вход или потребовало бы закрыть позицию до релиза.",
    EARLY_ENTRY: "Требование подтверждающего паттерна (engulfing/pin bar) в зоне перед активацией отфильтровало бы вход.",
    WIDE_STOP: "В высокой волатильности стоп нужно было расширить буфером ATR с уменьшением объёма.",
    STRUCTURE_SHIFT: "Выход при CHoCH против позиции до TP1 сократил бы убыток примерно до −0.5R.",
    LEVEL_ERROR: "Зона с устаревшими касаниями должна получать меньший вес — уровень не удержал цену.",
    NONE: "",
  };
  return {
    signalId: s.id,
    outcome: s.status,
    rMultiple: s.rMultiple ?? -1,
    primaryCause: cause,
    evidence,
    counterfactual: cf[cause],
    lessonTags: [cause.toLowerCase(), s.type, s.snapshot.session, ...(s.scores.pattern === 0 ? ["no_confirmation"] : [])],
    by: "rule-engine",
    confidence: conf,
  };
}

/* ── weight learning (exponentiated gradient + shadow check) ── */

function normalize(w: Weights): Weights {
  let out = { ...w };
  for (let it = 0; it < 6; it++) {
    for (const f of FACTORS) out[f] = Math.min(0.4, Math.max(0.02, out[f]));
    const s = FACTORS.reduce((a, f) => a + out[f], 0);
    out = Object.fromEntries(FACTORS.map((f) => [f, out[f] / s])) as Weights;
  }
  return out;
}

function wcsWith(w: Weights, s: Signal) {
  let num = 0;
  let den = 0;
  for (const f of FACTORS) {
    if (!s.available[f]) continue;
    num += w[f] * s.scores[f];
    den += w[f];
  }
  return den ? (100 * num) / den : 0;
}

function bumpVersion(v: string) {
  const [a, b, c] = v.split(".").map(Number);
  return c >= 9 ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
}

function learn(st: EngineState, s: Signal, t: number): Report["weightChanges"] {
  const win = s.maxTp >= 1;
  const r = win ? 1 : -1;
  for (const f of FACTORS) {
    st.pendingRewards[f] = (st.pendingRewards[f] ?? []).filter((x) => t - x.at <= 30 * 86_400_000);
    if (s.available[f] && s.scores[f] >= 0.3) st.pendingRewards[f].push({ r, id: s.id, at: t });
  }
  const ready = FACTORS.filter((f) => st.pendingRewards[f].length >= 3);
  if (!ready.length) return [];
  const proposal = { ...st.weights };
  const ids = new Set<string>();
  for (const f of ready) {
    const sum = st.pendingRewards[f].reduce((a, x) => a + x.r, 0);
    proposal[f] = proposal[f] * Math.exp(ETA * sum);
    st.pendingRewards[f].forEach((x) => ids.add(x.id));
    st.pendingRewards[f] = [];
  }
  const next = normalize(proposal);
  const changes = FACTORS.filter((f) => Math.abs(next[f] - st.weights[f]) >= 0.0005).map((f) => ({ factor: f, from: round3(st.weights[f]), to: round3(next[f]) }));
  if (!changes.length) return [];
  // shadow check on the last 20 closed trades (re-scored from frozen snapshots)
  const closed = st.signals.filter((x) => x.maxTp >= 1 || x.status === "sl").slice(-20);
  const wins = (arr: Signal[]) => arr.filter((x) => x.maxTp >= 1).length;
  const wrLive = closed.length ? wins(closed) / closed.length : 0;
  const shadow = closed.filter((x) => wcsWith(next, x) >= PUBLISH_WCS);
  const wrShadow = shadow.length ? wins(shadow) / shadow.length : wrLive;
  const small = closed.length < 8;
  const accept = small || wrShadow >= wrLive - 0.02;
  const changeText = changes.map((c) => `${c.factor} ${c.from.toFixed(3)} → ${c.to.toFixed(3)}`).join(", ");
  if (!accept) {
    st.journal.push({
      id: `j_${t}_${st.journal.length}`,
      at: t,
      kind: "shadow_rejected",
      title: "Shadow-проверка не пройдена — веса не изменены",
      details: `Предложено: ${changeText}. WR shadow ${(wrShadow * 100).toFixed(0)}% < WR live ${(wrLive * 100).toFixed(0)}% − 2 п.п. (выборка ${closed.length}).`,
      signalIds: [...ids],
      changes,
    });
    return [];
  }
  const prev = st.version;
  st.version = bumpVersion(st.version);
  st.weights = next;
  st.versions.forEach((v) => v.status === "live" && (v.status = "retired"));
  st.versions.push({ version: st.version, weights: { ...next }, activatedAt: t, status: "live" });
  const main = [...changes].sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from))[0];
  st.journal.push({
    id: `j_${t}_${st.journal.length}`,
    at: t,
    kind: "version",
    version: st.version,
    title: `v${st.version}: вес ${main.factor} ${main.from.toFixed(3)} → ${main.to.toFixed(3)}`,
    details: `${changeText}. Основание: ${ids.size} сделок с участием факторов. ${small ? "История < 8 сделок — shadow-проверка в ограниченном режиме." : `Shadow: WR ${(wrShadow * 100).toFixed(0)}% vs live ${(wrLive * 100).toFixed(0)}% — принято.`} Предыдущая версия: v${prev}.`,
    signalIds: [...ids],
    changes,
  });
  return changes;
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

function circuitBreaker(st: EngineState, s: Signal, cause: Cause, t: number) {
  if (s.status !== "sl") return;
  const sameType = st.signals.filter((x) => x.type === s.type && (x.status === "sl" || x.maxTp >= 1)).slice(-3);
  if (sameType.length < 3 || sameType.some((x) => x.status !== "sl")) return;
  const causes = sameType.map((x) => st.reports[x.id]?.primaryCause ?? (x.id === s.id ? cause : null));
  if (causes.every((c) => c === cause) && cause !== "NONE") {
    if (st.blocks.some((b) => b.type === s.type && (b.until == null || b.until > t))) return;
    st.blocks.push({ type: s.type, until: t + 48 * 3_600_000, reason: `3 SL подряд: ${CAUSE_LABEL[cause]}`, at: t });
    st.journal.push({
      id: `j_${t}_${st.journal.length}`,
      at: t,
      kind: "circuit_breaker",
      title: `Circuit breaker: «${SETUP_LABEL[s.type]}» заблокирован`,
      details: `Три SL подряд с причиной ${cause}. Входы этого типа приостановлены до ревью (автоматически — через 48 ч).`,
      signalIds: sameType.map((x) => x.id),
    });
  }
}

/* ── outcome tracking on one closed M15 candle ── */

function rFor(s: Signal) {
  const R = Math.abs(s.entry - s.sl);
  const rr3 = Math.abs(s.tps[2] - s.entry) / R;
  const parts = [0.5 * 1, 0.3 * 2, 0.2 * rr3];
  return parts.slice(0, s.maxTp).reduce((a, b) => a + b, 0);
}

function track(s: Signal, c: Candle, closeT: number, a: Analysis, push: PushEvent[]): boolean {
  const sgn = s.dir === "long" ? 1 : -1;
  const add = (e: SignalEvent) => s.timeline.push(e);
  if (s.status === "pending") {
    if (closeT >= s.expiresAt) {
      s.status = "expired";
      s.closedAt = closeT;
      s.rMultiple = 0;
      add({ event: "expired", at: closeT, note: "TTL 12 ч истёк, вход не состоялся" });
      push.push({ event: "signal.expired", signalId: s.id, title: `${s.id} · истёк`, body: "Сетап не активировался за 12 ч", priority: "low", at: closeT });
      return true;
    }
    const h1 = a.structure.H1.lastEvent;
    if (h1 && h1.type === "CHoCH" && h1.at > s.publishedAt && h1.dir === (s.dir === "long" ? "down" : "up")) {
      s.status = "cancelled";
      s.closedAt = closeT;
      s.rMultiple = 0;
      s.cancelReason = `CHoCH на H1 ${h1.dir === "up" ? "вверх" : "вниз"} (${fmtP(h1.price)}) до активации`;
      add({ event: "cancelled", at: closeT, note: s.cancelReason });
      push.push({ event: "signal.cancelled", signalId: s.id, title: "Сетап отменён", body: s.cancelReason, priority: "low", at: closeT });
      return true;
    }
    if (s.type === "stop_breakout" && sgn * (c.c - s.sl) <= 0) {
      s.status = "cancelled";
      s.closedAt = closeT;
      s.rMultiple = 0;
      s.cancelReason = "Цена закрылась за уровнем стопа до активации — структура сломана";
      add({ event: "cancelled", at: closeT, note: s.cancelReason });
      push.push({ event: "signal.cancelled", signalId: s.id, title: "Сетап отменён", body: s.cancelReason, priority: "low", at: closeT });
      return true;
    }
    const near = Math.abs(c.c - s.entry) / s.entry <= 0.003;
    if (near && !s.timeline.some((e) => e.event === "approaching")) {
      add({ event: "approaching", at: closeT, price: c.c });
      push.push({ event: "signal.approaching", signalId: s.id, title: "Цена подходит к зоне входа", body: `XAUUSD ${fmtP(c.c)} · вход ${fmtP(s.entry)}`, priority: "high", at: closeT });
    }
    const hit = s.type === "limit_zone" ? (s.dir === "long" ? c.l <= s.entry : c.h >= s.entry) : s.dir === "long" ? c.h >= s.entry : c.l <= s.entry;
    if (!hit) return false;
    s.status = "active";
    s.activatedAt = closeT - TF_MS.M15;
    add({ event: "activated", at: closeT, price: s.entry });
    push.push({ event: "signal.activated", signalId: s.id, title: "Вход активирован", body: `${orderRu(s)} ${fmtP(s.entry)} исполнен`, priority: "normal", at: closeT });
  }
  if (["active", "tp1", "tp2"].includes(s.status)) {
    const stop = s.maxTp >= 1 ? s.entry : s.sl;
    const stopHit = s.dir === "long" ? c.l <= stop : c.h >= stop;
    // conservative rule: if the candle touches both stop and a target — the worse outcome wins
    if (stopHit) {
      s.closedAt = closeT;
      if (s.maxTp >= 1) {
        s.status = "be";
        s.rMultiple = Math.round(rFor(s) * 100) / 100;
        add({ event: "be", at: closeT, price: stop, note: "Остаток закрыт в безубыток" });
        push.push({ event: "signal.be", signalId: s.id, title: "Безубыток", body: `Остаток закрыт по ${fmtP(stop)} · итог +${s.rMultiple.toFixed(2)}R`, priority: "normal", at: closeT });
      } else {
        s.status = "sl";
        s.rMultiple = -1;
        add({ event: "sl", at: closeT, price: s.sl });
        push.push({ event: "signal.sl_hit", signalId: s.id, title: "Стоп-лосс (−1R)", body: "Разбор будет опубликован", priority: "normal", at: closeT });
      }
      return true;
    }
    for (let k: number = s.maxTp; k < 3; k++) {
      const tp = s.tps[k] as number;
      if (sgn * ((s.dir === "long" ? c.h : c.l) - tp) >= 0) {
        s.maxTp = (k + 1) as 1 | 2 | 3;
        const ev = (["tp1", "tp2", "tp3"] as const)[k] as "tp1" | "tp2" | "tp3";
        s.status = ev;
        add({ event: ev, at: closeT, price: tp });
        push.push({
          event: "signal.tp_hit",
          signalId: s.id,
          title: `TP${k + 1} достигнут`,
          body: k === 0 ? "+1R на 50% позиции. Стоп → безубыток" : `Цель ${fmtP(tp)} достигнута`,
          priority: "normal",
          at: closeT,
        });
      } else break;
    }
    if (s.status === "tp3") {
      s.closedAt = closeT;
      s.rMultiple = Math.round(rFor(s) * 100) / 100;
      return true;
    }
    if (s.activatedAt && closeT - s.activatedAt > MAX_ACTIVE_MS) {
      s.closedAt = closeT;
      const partial = rFor(s);
      const R = Math.abs(s.entry - s.sl);
      const rest = (s.maxTp === 0 ? 1 : s.maxTp === 1 ? 0.5 : 0.2) * ((sgn * (c.c - s.entry)) / R);
      s.rMultiple = Math.round((partial + rest) * 100) / 100;
      s.status = s.maxTp >= 1 ? "be" : s.rMultiple >= 0 ? "be" : "sl";
      add({ event: s.status === "sl" ? "sl" : "be", at: closeT, price: c.c, note: "Закрыт по времени (5 дней)" });
      return true;
    }
  }
  return false;
}

/* ── one engine step at the close of an M15 candle ── */

export interface StepCtx {
  calendar: CalendarEvent[];
  sentiment: number | null;
  spread: number;
  quoteAgeMs: number;
}

export function step(st: EngineState, full: CandleSet, closeT: number, ctx: StepCtx, push: PushEvent[]): Analysis | null {
  const win = windowAt(full, closeT);
  if (!win) return null;
  const candle = win.M15[win.M15.length - 1];
  const open = st.signals.filter((s) => !TERMINAL.includes(s.status));
  st.blocks = st.blocks.filter((b) => b.until == null || b.until > closeT);
  const sctx: ScoreContext = {
    weights: st.weights,
    calendar: ctx.calendar,
    sentiment: ctx.sentiment,
    spread: ctx.spread,
    quoteAgeMs: ctx.quoteAgeMs,
    openDirs: open.map((s) => s.dir),
    blockedTypes: st.blocks.map((b) => b.type),
  };
  const a = analyze(win, closeT, sctx);

  // 1) track open signals on the closed candle
  for (const s of open) {
    if (s.publishedAt >= closeT) continue;
    const done = track(s, candle, closeT, a, push);
    if (done) {
      const base = classify(s, win.M15, ctx.calendar, a);
      let changes: Report["weightChanges"] = [];
      if (s.status === "sl" || s.maxTp >= 1) changes = learn(st, s, closeT);
      const rep: Report = { ...base, weightChanges: changes, createdAt: closeT };
      if (s.status !== "expired") {
        st.reports[s.id] = rep;
        circuitBreaker(st, s, rep.primaryCause, closeT);
        if (s.status !== "cancelled")
          push.push({ event: "analysis.published", signalId: s.id, title: `Разбор сделки ${s.id}`, body: `${CAUSE_LABEL[rep.primaryCause]} · ${rep.rMultiple >= 0 ? "+" : ""}${rep.rMultiple.toFixed(2)}R`, priority: "low", at: closeT });
      }
    }
  }

  // 2) skipped-setup journal (high WCS but vetoed by R:R)
  for (const c of a.candidates) {
    if (c.wcs >= PUBLISH_WCS && c.vetoes.length && c.vetoes[0].startsWith("rr_filter")) {
      const last = st.skipped[st.skipped.length - 1];
      if (!last || last.at < closeT - 3_600_000 || last.dir !== c.dir) st.skipped.push({ at: closeT, dir: c.dir, type: c.type, wcs: c.wcs, reason: c.vetoes[0] });
    }
  }
  if (st.skipped.length > 300) st.skipped = st.skipped.slice(-300);

  // 3) publish best candidate (re-evaluate duplicates with up-to-date open list)
  const stillOpen = st.signals.filter((s) => !TERMINAL.includes(s.status)).map((s) => s.dir);
  const best = a.best && !stillOpen.includes(a.best.dir) ? a.best : null;
  if (best) {
    const d = new Date(closeT);
    const day = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
    const n = st.signals.filter((s) => s.id.startsWith(`sig_${day}`)).length + 1;
    const nhi = a.nextHighImpact;
    const sig: Signal = {
      id: `sig_${day}_${String(n).padStart(3, "0")}`,
      publishedAt: closeT,
      modelVersion: st.version,
      dir: best.dir,
      type: best.type,
      entry: round2(best.entry),
      sl: round2(best.sl),
      tps: best.tps.map(round2) as [number, number, number],
      rr: Math.round(best.rr * 100) / 100,
      wcs: best.wcs,
      scores: best.scores,
      available: best.available,
      confluences: best.confluences,
      rationale: templateRationale(best, a),
      rationaleBy: "шаблонный синтез",
      snapshot: {
        wcs: best.wcs,
        trend: { M15: a.structure.M15.trend, H1: a.structure.H1.trend, H4: a.structure.H4.trend, D1: a.structure.D1.trend },
        atrH1: a.atr.H1,
        atrPercentileH1: a.atrPercentileH1,
        session: a.session,
        sentiment: a.sentiment,
        minutesToHighImpact: nhi ? Math.round((nhi.at - closeT) / 60_000) : null,
        spread: ctx.spread,
        zoneAgeHours: best.zone ? Math.round((closeT - best.zone.formedAt) / 3_600_000) : null,
      },
      status: best.type === "market_trigger" ? "active" : "pending",
      expiresAt: closeT + TTL_MS,
      timeline: [{ event: "published", at: closeT, price: a.price }],
      maxTp: 0,
    };
    if (best.type === "market_trigger") {
      sig.activatedAt = closeT;
      sig.timeline.push({ event: "activated", at: closeT, price: sig.entry });
    }
    st.signals.push(sig);
    push.push({
      event: "signal.published",
      signalId: sig.id,
      title: `XAUUSD · ${dirRu(sig.dir)} · сетап опубликован`,
      body: `${orderRu(sig)} ${fmtP(sig.entry)} · SL ${fmtP(sig.sl)} · TP1 ${fmtP(sig.tps[0])} · R:R 1:${sig.rr.toFixed(1)}`,
      priority: "high",
      at: closeT,
    });
  }
  if (a.blackout && closeT - a.blackout.at >= -30 * 60_000 && closeT - a.blackout.at < -15 * 60_000 + TF_MS.M15) {
    push.push({ event: "news.blackout", title: `${a.blackout.title} скоро`, body: "Новые сигналы приостановлены (blackout-окно)", priority: "normal", at: closeT });
  }
  st.lastTs = closeT;
  return a;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Analysis on the live (forming) candle — for the dashboard only, does not publish. */
export function liveAnalysis(st: EngineState, full: CandleSet, now: number, ctx: StepCtx): Analysis | null {
  const win = windowAt(full, now + TF_MS.M15 * 2);
  if (!win) return null;
  const open = st.signals.filter((s) => !TERMINAL.includes(s.status));
  return analyze(win, now, {
    weights: st.weights,
    calendar: ctx.calendar,
    sentiment: ctx.sentiment,
    spread: ctx.spread,
    quoteAgeMs: ctx.quoteAgeMs,
    openDirs: open.map((s) => s.dir),
    blockedTypes: st.blocks.filter((b) => b.until == null || b.until > now).map((b) => b.type),
  });
}

export type { FactorKey, SetupType };
