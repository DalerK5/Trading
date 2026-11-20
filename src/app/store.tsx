/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { fetchLiveCalendar, generatedCalendar } from "@/engine/calendar";
import { DemoMarket, fetchHistory, fetchLatest, fetchSpread, HISTORY_DAYS } from "@/engine/data";
import { initialState, liveAnalysis, SCHEMA, step, type PushEvent, type StepCtx } from "@/engine/engine";
import { llmChat, llmJson } from "@/engine/llm";
import { classifyHeadlines, fetchHeadlines, sentimentScore, type Headline } from "@/engine/news";
import type { Analysis, CalendarEvent, CandleSet, EngineState, Signal } from "@/engine/types";
import { CAUSE_LABEL, FACTORS, INITIAL_WEIGHTS, TERMINAL, TF_MS } from "@/engine/types";
import { loadJSON, loadSettings, saveJSON, type Priority, type Settings } from "./settings";

export interface InboxItem {
  id: string;
  event: string;
  title: string;
  body: string;
  at: number;
  signalId?: string;
  read: boolean;
  digest?: boolean;
}

interface Ctx {
  phase: "loading" | "backtest" | "ready";
  progress: number;
  message: string;
  source: "binance" | "demo";
  candles: CandleSet | null;
  price: number | null;
  prevClose: number | null;
  spread: number;
  quoteAt: number;
  calendar: CalendarEvent[];
  calendarSource: string;
  headlines: Headline[];
  sentiment: number | null;
  sentimentBy: string;
  engine: EngineState;
  analysis: Analysis | null;
  settings: Settings;
  inbox: InboxItem[];
  now: number;
  setSettings: (s: Partial<Settings>) => void;
  markInboxRead: () => void;
  clearInbox: () => void;
  resetModel: () => void;
  liftBlock: (i: number) => void;
  rollback: (version: string) => void;
  refreshNews: () => Promise<void>;
}

const EngineCtx = createContext<Ctx | null>(null);

export function useEngine() {
  const c = useContext(EngineCtx);
  if (!c) throw new Error("EngineProvider missing");
  return c;
}

const STATE_KEY = "aurum.engine";
const PRIO: Record<Priority, number> = { low: 0, normal: 1, high: 2 };

function inQuiet(s: Settings, t: number) {
  if (!s.quietEnabled) return false;
  const h = new Date(t).getHours();
  return s.quietFrom > s.quietTo ? h >= s.quietFrom || h < s.quietTo : h >= s.quietFrom && h < s.quietTo;
}

export function EngineProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const [phase, setPhase] = useState<Ctx["phase"]>("loading");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("Подключение к источнику котировок…");
  const [source, setSource] = useState<Ctx["source"]>("binance");
  const [candles, setCandles] = useState<CandleSet | null>(null);
  const [spread, setSpread] = useState(0.3);
  const [quoteAt, setQuoteAt] = useState(Date.now());
  const [calendar, setCalendar] = useState<CalendarEvent[]>([]);
  const [calendarSource, setCalendarSource] = useState("расчётное расписание");
  const [headlines, setHeadlines] = useState<Headline[]>([]);
  const [sentimentBy, setSentimentBy] = useState("нет данных");
  const [engine, setEngine] = useState<EngineState>(() => initialState("binance"));
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [inbox, setInbox] = useState<InboxItem[]>(() => loadJSON<InboxItem[]>("aurum.inbox", []));
  const [now, setNow] = useState(Date.now());

  const stRef = useRef<EngineState>(engine);
  const setRef = useRef<CandleSet | null>(null);
  const demoRef = useRef<DemoMarket | null>(null);
  const calRef = useRef<CalendarEvent[]>([]);
  const sentRef = useRef<number | null>(null);
  const spreadRef = useRef(0.3);
  const quoteRef = useRef(Date.now());
  const busy = useRef(false);
  const sent = useRef<Set<string>>(new Set(loadJSON<string[]>("aurum.sent", [])));

  const publish = useCallback(() => {
    const st = stRef.current;
    setEngine({ ...st, signals: [...st.signals], journal: [...st.journal], reports: { ...st.reports } });
    saveJSON(STATE_KEY, st);
  }, []);

  /* ── notifications ── */
  const notify = useCallback((events: PushEvent[]) => {
    const s = settingsRef.current;
    const today = new Date().toDateString();
    const items: InboxItem[] = [];
    for (const e of events) {
      const key = `${e.signalId ?? e.at}:${e.event}`;
      if (sent.current.has(key)) continue;
      sent.current.add(key);
      const digest = inQuiet(s, Date.now()) && e.priority !== "high";
      items.push({ id: key, event: e.event, title: e.title, body: e.body, at: e.at, signalId: e.signalId, read: false, digest });
      const allowed = s.events[e.event] !== false && PRIO[e.priority] >= PRIO[s.minPriority];
      if (!allowed) continue;
      const countKey = `aurum.pushcount.${today}`;
      const count = loadJSON<number>(countKey, 0);
      if (digest || count >= s.dailyCap) continue;
      toast(e.title, { description: e.body });
      if (s.pushEnabled && "Notification" in window && Notification.permission === "granted") {
        try {
          const n = new Notification(e.title, { body: e.body, tag: key, icon: undefined });
          n.onclick = () => {
            window.focus();
            if (e.signalId) window.location.hash = `#/signals/${e.signalId}`;
          };
          saveJSON(countKey, count + 1);
        } catch {
          /* some mobile browsers require a service worker */
        }
      }
    }
    if (items.length) {
      setInbox((prev) => {
        const next = [...items.reverse(), ...prev].slice(0, 200);
        saveJSON("aurum.inbox", next);
        return next;
      });
      saveJSON("aurum.sent", [...sent.current].slice(-2000));
    }
  }, []);

  /* ── LLM enrichment (optional) ── */
  const enrich = useCallback(async (sig: Signal, a: Analysis) => {
    const s = settingsRef.current;
    if (!s.llm.enabled || !s.llm.apiKey) return;
    try {
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
        next_high_impact: a.nextHighImpact?.title,
      };
      const text = await llmChat(
        s.llm,
        "Ты профессиональный аналитик рынка золота. По структурированным фактам напиши обоснование торгового сигнала: 2–4 предложения на русском — контекст, логика входа, что отменяет сценарий. Не меняй и не придумывай цифры, используй только данные из фактов.",
        JSON.stringify(facts),
      );
      const target = stRef.current.signals.find((x) => x.id === sig.id);
      if (target) {
        target.rationale = text.trim();
        target.rationaleBy = `LLM (${s.llm.model})`;
        // sanity-check
        try {
          const v = await llmJson<{ verdict: string; reason: string }>(s.llm, {
            system: 'Проверь факты торгового сигнала на противоречия. Верни СТРОГО JSON {"verdict":"ok|conflict","reason":"..."}',
            user: JSON.stringify(facts),
          });
          if (v.verdict === "conflict") target.rationale += `\n\n⚠ Sanity-check LLM: ${v.reason}`;
        } catch {
          /* optional */
        }
        publish();
      }
    } catch (e) {
      console.warn("LLM rationale failed", e);
    }
  }, [publish]);

  const enrichReport = useCallback(async (id: string) => {
    const s = settingsRef.current;
    const st = stRef.current;
    const rep = st.reports[id];
    const sig = st.signals.find((x) => x.id === id);
    if (!s.llm.enabled || !s.llm.apiKey || !rep || !sig || rep.primaryCause === "NONE") return;
    try {
      const out = await llmJson<{ primary_cause: string; evidence: string[]; counterfactual: string; lesson_tags: string[]; confidence: number }>(s.llm, {
        system:
          "Ты — пост-трейд аудитор. На входе: параметры сигнала, замороженный контекст и детерминированные улики. Верни СТРОГО JSON: {primary_cause: enum [FALSE_BREAKOUT, NEWS_SPIKE, EARLY_ENTRY, WIDE_STOP, STRUCTURE_SHIFT, LEVEL_ERROR, NONE], evidence: string[], counterfactual: string, lesson_tags: string[], confidence: 0..1}. Пиши по-русски.",
        user: JSON.stringify({ signal: { ...sig, rationale: undefined, timeline: sig.timeline }, deterministic: rep }),
      });
      if (out.primary_cause in CAUSE_LABEL) rep.primaryCause = out.primary_cause as typeof rep.primaryCause;
      if (Array.isArray(out.evidence) && out.evidence.length) rep.evidence = out.evidence.slice(0, 6);
      if (out.counterfactual) rep.counterfactual = out.counterfactual;
      if (Array.isArray(out.lesson_tags)) rep.lessonTags = out.lesson_tags.slice(0, 6);
      rep.confidence = Math.max(0, Math.min(1, Number(out.confidence) || rep.confidence));
      rep.by = `LLM (${s.llm.model}) + rule-engine`;
      publish();
    } catch (e) {
      console.warn("LLM reflection failed", e);
    }
  }, [publish]);

  /* ── processing newly closed M15 candles ── */
  const process = useCallback(
    async (live: boolean) => {
      const set = setRef.current;
      if (!set) return;
      const st = stRef.current;
      const t = Date.now();
      const closes = set.M15.map((c) => c.t + TF_MS.M15).filter((ct) => ct > st.lastTs && ct <= t);
      const ctx: StepCtx = { calendar: calRef.current, sentiment: null, spread: spreadRef.current, quoteAgeMs: 0 };
      const total = closes.length;
      let lastA: Analysis | null = null;
      const pushes: PushEvent[] = [];
      for (let i = 0; i < total; i++) {
        const recent = t - closes[i] < 30 * 60_000;
        const a = step(st, set, closes[i], { ...ctx, sentiment: recent ? sentRef.current : null, quoteAgeMs: recent && live ? t - quoteRef.current : 0 }, pushes);
        if (a) lastA = a;
        if (!live && i % 60 === 0) {
          setProgress(i / total);
          setMessage(`Бэктест движков: ${i}/${total} свечей M15`);
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      if (live && total) {
        const fresh = pushes.filter((p) => t - p.at < 30 * 60_000);
        notify(fresh);
        for (const p of fresh) {
          if (p.event === "signal.published" && p.signalId && lastA) {
            const sig = st.signals.find((x) => x.id === p.signalId);
            if (sig) void enrich(sig, lastA);
          }
          if (p.event === "analysis.published" && p.signalId) void enrichReport(p.signalId);
        }
      }
      setAnalysis(liveAnalysis(st, set, t, { ...ctx, sentiment: sentRef.current, quoteAgeMs: live ? t - quoteRef.current : 0 }));
      publish();
    },
    [enrich, enrichReport, notify, publish],
  );

  const refreshNews = useCallback(async () => {
    if (stRef.current.source === "demo") return;
    try {
      const items = await fetchHeadlines();
      const s = settingsRef.current;
      const res = await classifyHeadlines(items, s.llm.enabled && s.llm.apiKey ? s.llm : null);
      setHeadlines(res.headlines);
      setSentimentBy(res.by);
      sentRef.current = sentimentScore(res.headlines, Date.now());
    } catch {
      setSentimentBy("источник новостей недоступен");
      sentRef.current = null;
    }
  }, []);

  /* ── boot ── */
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    (async () => {
      const now0 = Date.now();
      let set: CandleSet;
      let src: "binance" | "demo" = "binance";
      try {
        if (settingsRef.current.dataSource === "demo") throw new Error("demo selected");
        setMessage("Загрузка истории котировок XAU (Binance PAXG/USDT)…");
        set = await fetchHistory();
        const sp = await fetchSpread();
        if (sp != null) spreadRef.current = sp;
      } catch {
        src = "demo";
        setMessage("Живые котировки недоступны — запуск демо-рынка…");
        const dm = new DemoMarket();
        set = dm.build(now0, HISTORY_DAYS + 230);
        demoRef.current = dm;
        spreadRef.current = 0.3;
        if (settingsRef.current.dataSource !== "demo") toast("Демо-режим", { description: "Источник котировок недоступен из вашей сети. Включён синтетический рынок." });
      }
      if (cancelled) return;
      setSource(src);
      setSpread(spreadRef.current);
      setRef.current = set;
      setCandles(set);
      quoteRef.current = Date.now();

      // calendar
      let cal = generatedCalendar(set.M15[0].t, now0);
      try {
        const live = await fetchLiveCalendar();
        if (live.length) {
          const wStart = live[0].at - 86_400_000 * 3;
          cal = [...cal.filter((e) => e.at < wStart || e.at > live[live.length - 1].at + 86_400_000 * 3), ...live].sort((a, b) => a.at - b.at);
          setCalendarSource("ForexFactory (live) + расчётное");
        }
      } catch {
        /* keep generated */
      }
      calRef.current = cal;
      setCalendar(cal);

      // restore or rebuild engine state
      const saved = loadJSON<EngineState | null>(STATE_KEY, null);
      const warm = set.M15.length - HISTORY_DAYS * 96 - 1;
      const startT = set.M15[Math.max(0, warm)].t;
      if (saved && saved.schema === SCHEMA && saved.source === src && saved.lastTs >= startT && saved.lastTs <= now0) {
        stRef.current = saved;
      } else {
        const st = initialState(src);
        st.lastTs = startT;
        st.versions[0].activatedAt = startT;
        st.journal.push({
          id: "j_init",
          at: startT,
          kind: "info",
          version: "0.1.0",
          title: "v0.1.0: начальные веса факторов",
          details: "Веса из спецификации: зона 0.25, sweep 0.20, структура 0.15, паттерн 0.10, RSI-div 0.10, сантимент 0.10, тренд D1 0.05, VP 0.05. Walk-forward прогон по истории.",
          signalIds: [],
        });
        stRef.current = st;
      }
      if (src === "binance") await refreshNews();
      setPhase("backtest");
      await process(false);
      if (cancelled) return;
      setPhase("ready");
      setProgress(1);

      const tick = async () => {
        if (busy.current) return;
        busy.current = true;
        try {
          if (demoRef.current) {
            setRef.current = demoRef.current.advance(Date.now());
            quoteRef.current = Date.now();
          } else {
            setRef.current = await fetchLatest(setRef.current!);
            quoteRef.current = Date.now();
            const sp = await fetchSpread();
            if (sp != null) {
              spreadRef.current = sp;
              setSpread(sp);
            }
          }
          setCandles(setRef.current);
          setQuoteAt(quoteRef.current);
          await process(true);
        } catch {
          /* keep last data; age indicator will show staleness */
        } finally {
          busy.current = false;
        }
      };
      timer = setInterval(tick, src === "demo" ? 3000 : 30_000);
    })();
    const newsTimer = setInterval(() => void refreshNews(), 15 * 60_000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      clearInterval(newsTimer);
      clearInterval(clock);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setSettings = useCallback((p: Partial<Settings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...p };
      saveJSON("aurum.settings", next);
      return next;
    });
  }, []);

  const resetModel = useCallback(() => {
    localStorage.removeItem(STATE_KEY);
    window.location.reload();
  }, []);

  const liftBlock = useCallback(
    (i: number) => {
      const st = stRef.current;
      const b = st.blocks[i];
      if (!b) return;
      st.blocks.splice(i, 1);
      st.journal.push({ id: `j_${Date.now()}`, at: Date.now(), kind: "info", title: "Ручное ревью: блокировка снята", details: `Тип сетапа ${b.type} снова допущен к публикации.`, signalIds: [] });
      publish();
    },
    [publish],
  );

  const rollback = useCallback(
    (version: string) => {
      const st = stRef.current;
      const v = st.versions.find((x) => x.version === version);
      if (!v) return;
      const prev = st.version;
      st.versions.forEach((x) => x.status === "live" && (x.status = "rolled_back"));
      const [a, b, c] = st.versions[st.versions.length - 1].version.split(".").map(Number);
      const nv = c >= 9 ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
      st.version = nv;
      st.weights = { ...v.weights };
      st.versions.push({ version: nv, weights: { ...v.weights }, activatedAt: Date.now(), status: "live" });
      st.journal.push({
        id: `j_${Date.now()}`,
        at: Date.now(),
        kind: "version",
        version: nv,
        title: `v${nv}: откат к весам v${version}`,
        details: `Ручной откат с v${prev}. Веса: ${FACTORS.map((f) => `${f} ${v.weights[f].toFixed(3)}`).join(", ")}.`,
        signalIds: [],
      });
      publish();
    },
    [publish],
  );

  const set = candles;
  const price = set ? set.M15[set.M15.length - 1].c : null;
  const prevClose = set && set.D1.length > 1 ? set.D1[set.D1.length - 2].c : null;

  const value: Ctx = {
    phase,
    progress,
    message,
    source,
    candles,
    price,
    prevClose,
    spread,
    quoteAt,
    calendar,
    calendarSource,
    headlines,
    sentiment: sentRef.current,
    sentimentBy,
    engine,
    analysis,
    settings,
    inbox,
    now,
    setSettings,
    markInboxRead: () =>
      setInbox((p) => {
        const n = p.map((x) => ({ ...x, read: true }));
        saveJSON("aurum.inbox", n);
        return n;
      }),
    clearInbox: () => {
      setInbox([]);
      saveJSON("aurum.inbox", []);
    },
    resetModel,
    liftBlock,
    rollback,
    refreshNews,
  };
  return <EngineCtx.Provider value={value}>{children}</EngineCtx.Provider>;
}

export const isOpen = (s: Signal) => !TERMINAL.includes(s.status);
export const isClosedTrade = (s: Signal) => s.status === "sl" || s.maxTp >= 1 ? TERMINAL.includes(s.status) : false;
export { INITIAL_WEIGHTS };
