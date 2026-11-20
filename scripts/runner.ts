/**
 * AURUM·AI server runner — one shared history for every user.
 *
 * Runs on a schedule (GitHub Actions cron). Each run:
 *   1. loads the previous state from $DATA_DIR/state.json
 *   2. fetches XAUUSD candles + spot quote, economic calendar, headlines
 *   3. steps the engine over every newly closed M15 candle (walk-forward on cold start)
 *   4. sends Telegram alerts for fresh events, optionally enriches with an LLM
 *   5. writes $DATA_DIR/state.json (private engine state) and $DATA_DIR/public.json (client snapshot)
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fetchLiveCalendar, generatedCalendar } from "../src/engine/calendar";
import { DemoMarket } from "../src/engine/data";
import { initialState, liveAnalysis, SCHEMA, step, type PushEvent, type StepCtx } from "../src/engine/engine";
import { llmChat, llmJson, type LlmConfig } from "../src/engine/llm";
import { classifyHeadlines, fetchHeadlines, sentimentScore, type Headline } from "../src/engine/news";
import type { Snapshot } from "../src/engine/snapshot";
import type { Analysis, CalendarEvent, CandleSet, EngineState, Signal } from "../src/engine/types";
import { CAUSE_LABEL, TF_MS } from "../src/engine/types";
import { fetchXau, spotQuote } from "./providers";

const DATA_DIR = process.env.DATA_DIR ?? "data-out";
const HISTORY_DAYS = 45;
const RUNNER_VERSION = "2.0.0";
const SITE = process.env.SITE_URL ?? "";
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const TG_CHAT = process.env.TELEGRAM_CHAT_ID ?? "";
const TG_PUBLIC = process.env.TELEGRAM_PUBLIC_URL ?? "";
const TD_KEY = process.env.TWELVEDATA_API_KEY || undefined;
const LLM: LlmConfig | null = process.env.LLM_API_KEY
  ? { baseUrl: process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1", apiKey: process.env.LLM_API_KEY, model: process.env.LLM_MODEL || "qwen/qwen3-32b:free" }
  : null;

interface Persisted {
  engine: EngineState;
  candles: CandleSet;
  provider: string;
  basis: number | null;
  sent: string[];
  feed: PushEvent[];
  headlines: Headline[];
  headlinesAt: number;
  sentimentBy: string;
}

function load(): Persisted | null {
  const p = join(DATA_DIR, "state.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Persisted;
  } catch (e) {
    console.warn("state.json unreadable — cold start", e);
    return null;
  }
}

/* ── Telegram ── */

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

async function telegram(text: string) {
  if (!TG_TOKEN || !TG_CHAT) return;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!r.ok) console.warn("telegram", r.status, await r.text());
  } catch (e) {
    console.warn("telegram failed", e);
  }
}

const fmt = (x: number) => x.toFixed(2);

function signalMessage(s: Signal) {
  const order = s.type === "limit_zone" ? "LIMIT" : s.type === "stop_breakout" ? "STOP" : "MARKET";
  const head = `${s.dir === "long" ? "🟢 BUY" : "🔴 SELL"} ${order} · XAUUSD`;
  const link = SITE ? `\n<a href="${SITE}#/signals/${s.id}">Открыть сигнал</a>` : "";
  return (
    `<b>${head}</b>\n` +
    `Entry: <code>${fmt(s.entry)}</code>\nSL: <code>${fmt(s.sl)}</code>\n` +
    `TP1: <code>${fmt(s.tps[0])}</code>\nTP2: <code>${fmt(s.tps[1])}</code>\nTP3: <code>${fmt(s.tps[2])}</code>\n` +
    `R:R 1:${s.rr.toFixed(1)} · WCS ${s.wcs} · v${s.modelVersion}\n\n` +
    `${esc(s.rationale.slice(0, 700))}${link}`
  );
}

function eventMessage(e: PushEvent, st: EngineState) {
  const s = e.signalId ? st.signals.find((x) => x.id === e.signalId) : undefined;
  if (e.event === "signal.published" && s) return signalMessage(s);
  const icon: Record<string, string> = {
    "signal.approaching": "⏳",
    "signal.activated": "▶️",
    "signal.tp_hit": "✅",
    "signal.sl_hit": "⛔",
    "signal.be": "⚖️",
    "signal.cancelled": "✖️",
    "signal.expired": "⌛",
    "news.blackout": "📰",
    "analysis.published": "🧠",
  };
  const link = SITE && e.signalId ? `\n<a href="${SITE}#/signals/${e.signalId}">${e.signalId}</a>` : "";
  return `${icon[e.event] ?? "•"} <b>${esc(e.title)}</b>\n${esc(e.body)}${link}`;
}

/* ── LLM enrichment ── */

async function enrichSignal(sig: Signal, a: Analysis | null) {
  if (!LLM) return;
  const facts = {
    direction: sig.dir,
    order_type: sig.type,
    entry: sig.entry,
    stop_loss: sig.sl,
    take_profits: sig.tps,
    wcs: sig.wcs,
    confluences: sig.confluences.map((c) => `${c.label} (w=${c.weight.toFixed(2)}, s=${c.score})`),
    trend: sig.snapshot.trend,
    session: sig.snapshot.session,
    next_high_impact: a?.nextHighImpact?.title,
  };
  try {
    const text = await llmChat(
      LLM,
      "Ты профессиональный аналитик рынка золота. По структурированным фактам напиши обоснование торгового сигнала: 2–4 предложения на русском — контекст, логика входа, что отменяет сценарий. Не меняй и не придумывай цифры.",
      JSON.stringify(facts),
    );
    sig.rationale = text.trim();
    sig.rationaleBy = `LLM (${LLM.model})`;
    const v = await llmJson<{ verdict: string; reason: string }>(LLM, {
      system: 'Проверь факты торгового сигнала на противоречия. Верни СТРОГО JSON {"verdict":"ok|conflict","reason":"..."}',
      user: JSON.stringify(facts),
    });
    if (v.verdict === "conflict") sig.rationale += `\n\n⚠ Sanity-check: ${v.reason}`;
  } catch (e) {
    console.warn("LLM rationale failed", String(e));
  }
}

async function enrichReport(st: EngineState, id: string) {
  const rep = st.reports[id];
  const sig = st.signals.find((x) => x.id === id);
  if (!LLM || !rep || !sig || rep.primaryCause === "NONE") return;
  try {
    const out = await llmJson<{ primary_cause: string; evidence: string[]; counterfactual: string; lesson_tags: string[]; confidence: number }>(LLM, {
      system:
        "Ты — пост-трейд аудитор. Верни СТРОГО JSON: {primary_cause: enum [FALSE_BREAKOUT, NEWS_SPIKE, EARLY_ENTRY, WIDE_STOP, STRUCTURE_SHIFT, LEVEL_ERROR, NONE], evidence: string[], counterfactual: string, lesson_tags: string[], confidence: 0..1}. Пиши по-русски.",
      user: JSON.stringify({ signal: { ...sig, rationale: undefined }, deterministic: rep }),
    });
    if (out.primary_cause in CAUSE_LABEL) rep.primaryCause = out.primary_cause as typeof rep.primaryCause;
    if (Array.isArray(out.evidence) && out.evidence.length) rep.evidence = out.evidence.slice(0, 6);
    if (out.counterfactual) rep.counterfactual = out.counterfactual;
    if (Array.isArray(out.lesson_tags)) rep.lessonTags = out.lesson_tags.slice(0, 6);
    rep.confidence = Math.max(0, Math.min(1, Number(out.confidence) || rep.confidence));
    rep.by = `LLM (${LLM.model}) + rule-engine`;
  } catch (e) {
    console.warn("LLM reflection failed", String(e));
  }
}

/* ── main ── */

async function main() {
  const t0 = Date.now();
  mkdirSync(DATA_DIR, { recursive: true });
  const prev = load();
  const quote = await spotQuote();
  const { set, provider, basis } = process.env.RUNNER_DEMO
    ? { set: new DemoMarket().build(Date.now(), HISTORY_DAYS + 230), provider: "demo", basis: 0 }
    : await fetchXau(prev?.candles ?? null, prev?.provider ?? null, prev?.basis ?? null, quote, TD_KEY);
  console.log(`provider=${provider} basis=${basis.toFixed(2)} M15=${set.M15.length} H1=${set.H1.length} H4=${set.H4.length} D1=${set.D1.length} spot=${quote?.mid}`);

  // calendar
  const now = Date.now();
  let calendar: CalendarEvent[] = generatedCalendar(set.M15[0].t, now);
  let calendarSource = "расчётное расписание";
  try {
    const live = await fetchLiveCalendar();
    if (live.length) {
      const a = live[0].at - 3 * 86_400_000;
      const b = live[live.length - 1].at + 3 * 86_400_000;
      calendar = [...calendar.filter((e) => e.at < a || e.at > b), ...live].sort((x, y) => x.at - y.at);
      calendarSource = "ForexFactory + расчётное";
    }
  } catch (e) {
    console.warn("calendar failed", String(e));
  }

  // headlines (every 15 min)
  let headlines = prev?.headlines ?? [];
  let sentimentBy = prev?.sentimentBy ?? "нет данных";
  if (!prev || now - prev.headlinesAt > 14 * 60_000) {
    try {
      let items: Awaited<ReturnType<typeof fetchHeadlines>> = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          items = await fetchHeadlines();
          break;
        } catch (err) {
          if (attempt === 2) throw err;
          await new Promise((r) => setTimeout(r, 4000));
        }
      }
      const res = await classifyHeadlines(items, LLM);
      headlines = res.headlines;
      sentimentBy = res.by;
    } catch (e) {
      console.warn("headlines failed", String(e));
    }
  }
  const sentiment = sentimentScore(headlines, now);

  // engine state
  const startT = set.M15[Math.max(0, set.M15.length - HISTORY_DAYS * 96 - 1)].t;
  let st: EngineState;
  if (prev && prev.engine.schema === SCHEMA && prev.provider === provider && prev.engine.lastTs >= set.M15[0].t) {
    st = prev.engine;
  } else {
    console.log("cold start: walk-forward over", HISTORY_DAYS, "days");
    st = initialState(provider);
    st.lastTs = startT;
    st.versions[0].activatedAt = startT;
    st.journal.push({
      id: "j_init",
      at: startT,
      kind: "info",
      version: "0.1.0",
      title: "v0.1.0: начальные веса факторов",
      details: "Веса из спецификации: зона 0.25, sweep 0.20, структура 0.15, паттерн 0.10, RSI-div 0.10, сантимент 0.10, тренд D1 0.05, VP 0.05. Walk-forward прогон по истории XAUUSD.",
      signalIds: [],
    });
  }

  const ctx: StepCtx = { calendar, sentiment: null, spread: quote ? quote.ask - quote.bid : 0.3, quoteAgeMs: 0 };
  const closes = set.M15.map((c) => c.t + TF_MS.M15).filter((ct) => ct > st.lastTs && ct <= now);
  const pushes: PushEvent[] = [];
  let lastA: Analysis | null = null;
  for (const ct of closes) {
    const recent = now - ct < 30 * 60_000;
    const a = step(st, set, ct, { ...ctx, sentiment: recent ? sentiment : null, quoteAgeMs: recent && quote ? Math.max(0, now - quote.at) : 0 }, pushes);
    if (a) lastA = a;
  }
  console.log(`processed ${closes.length} candles, signals total=${st.signals.length}, version=${st.version}`);

  // fresh events → LLM + Telegram (dedup by key)
  const sent = new Set(prev?.sent ?? []);
  const fresh = pushes.filter((p) => now - p.at < 30 * 60_000);
  for (const p of fresh) {
    if (p.event === "signal.published" && p.signalId) {
      const sig = st.signals.find((x) => x.id === p.signalId);
      if (sig) await enrichSignal(sig, lastA);
    }
    if (p.event === "analysis.published" && p.signalId) await enrichReport(st, p.signalId);
  }
  for (const p of fresh) {
    const key = `${p.signalId ?? p.at}:${p.event}`;
    if (sent.has(key)) continue;
    sent.add(key);
    await telegram(eventMessage(p, st));
  }
  const feed = [...(prev?.feed ?? []), ...pushes].slice(-300);

  const analysis = liveAnalysis(st, set, now, { ...ctx, sentiment });
  const lastClose = set.M15[set.M15.length - 1].c;
  const price = quote?.mid ?? lastClose;
  const d1 = set.D1;
  const prevClose = d1.length > 1 ? d1[d1.length - 2].c : null;

  const persisted: Persisted = { engine: st, candles: set, provider, basis, sent: [...sent].slice(-3000), feed, headlines, headlinesAt: headlines === prev?.headlines ? prev!.headlinesAt : now, sentimentBy };
  writeFileSync(join(DATA_DIR, "state.json"), JSON.stringify(persisted));

  const snap: Snapshot = {
    schema: 1,
    updatedAt: now,
    symbol: "XAUUSD",
    provider: provider === "twelvedata" ? "Twelve Data XAU/USD" : provider === "demo" ? "демо-рынок" : `XAU/USD spot ${quote?.source ?? ""} · свечи PAXG, скорректированные на базис ${basis >= 0 ? "+" : ""}${basis.toFixed(2)}`,
    price,
    prevClose,
    spread: ctx.spread,
    quoteAt: quote?.at ?? now,
    candles: { M15: set.M15.slice(-700), H1: set.H1.slice(-600), H4: set.H4.slice(-400), D1: set.D1.slice(-300) },
    engine: { ...st, pendingRewards: st.pendingRewards },
    analysis,
    calendar: calendar.filter((e) => e.at > now - 2 * 86_400_000 && e.at < now + 21 * 86_400_000),
    calendarSource,
    headlines: headlines.slice(0, 30),
    sentiment,
    sentimentBy,
    feed: feed.slice(-100),
    telegram: TG_PUBLIC || null,
    runner: { intervalMin: 5, lastRunMs: Date.now() - t0, version: RUNNER_VERSION },
  };
  writeFileSync(join(DATA_DIR, "public.json"), JSON.stringify(snap));
  console.log(`done in ${Date.now() - t0} ms; public.json ${(JSON.stringify(snap).length / 1024).toFixed(0)} KB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
