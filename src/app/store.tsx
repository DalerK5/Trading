/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { generatedCalendar } from "@/engine/calendar";
import { DemoMarket, HISTORY_DAYS } from "@/engine/data";
import { initialState, liveAnalysis, step, type PushEvent, type StepCtx } from "@/engine/engine";
import type { Headline } from "@/engine/news";
import type { Snapshot } from "@/engine/snapshot";
import type { Analysis, CalendarEvent, CandleSet, EngineState, Signal } from "@/engine/types";
import { TERMINAL, TF_MS } from "@/engine/types";
import { loadJSON, loadSettings, saveJSON, type Priority, type Settings } from "./settings";

export const DATA_URL: string = import.meta.env.VITE_DATA_URL || "https://raw.githubusercontent.com/DalerK5/Trading/data/public.json";

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
  mode: "shared" | "demo";
  provider: string;
  candles: CandleSet | null;
  price: number | null;
  livePrice: boolean;
  prevClose: number | null;
  spread: number;
  quoteAt: number;
  updatedAt: number;
  calendar: CalendarEvent[];
  calendarSource: string;
  headlines: Headline[];
  sentiment: number | null;
  sentimentBy: string;
  engine: EngineState;
  analysis: Analysis | null;
  settings: Settings;
  inbox: InboxItem[];
  telegram: string | null;
  now: number;
  setSettings: (s: Partial<Settings>) => void;
  markInboxRead: () => void;
  clearInbox: () => void;
  refresh: () => Promise<void>;
}

const EngineCtx = createContext<Ctx | null>(null);

export function useEngine() {
  const c = useContext(EngineCtx);
  if (!c) throw new Error("EngineProvider missing");
  return c;
}

const PRIO: Record<Priority, number> = { low: 0, normal: 1, high: 2 };
const PRIORITY_OF: Record<string, Priority> = { "signal.published": "high", "signal.approaching": "high" };

function inQuiet(s: Settings, t: number) {
  if (!s.quietEnabled) return false;
  const h = new Date(t).getHours();
  return s.quietFrom > s.quietTo ? h >= s.quietFrom || h < s.quietTo : h >= s.quietFrom && h < s.quietTo;
}

async function fetchSnapshot(): Promise<Snapshot> {
  const r = await fetch(`${DATA_URL}?t=${Math.floor(Date.now() / 30_000)}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`snapshot HTTP ${r.status}`);
  const s = (await r.json()) as Snapshot;
  if (s.schema !== 1 || !s.candles?.M15?.length) throw new Error("bad snapshot");
  return s;
}

async function fetchSpot(): Promise<number | null> {
  try {
    const r = await fetch("https://api.gold-api.com/price/XAU", { cache: "no-store" });
    if (!r.ok) return null;
    const j = (await r.json()) as { price: number };
    return typeof j.price === "number" && j.price > 0 ? j.price : null;
  } catch {
    return null;
  }
}

export function EngineProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const [phase, setPhase] = useState<Ctx["phase"]>("loading");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("Подключение к серверу AURUM·AI…");
  const [mode, setMode] = useState<Ctx["mode"]>("shared");
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [engine, setEngine] = useState<EngineState>(() => initialState("demo"));
  const [candles, setCandles] = useState<CandleSet | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [calendar, setCalendar] = useState<CalendarEvent[]>([]);
  const [spot, setSpot] = useState<{ p: number; at: number } | null>(null);
  const [inbox, setInbox] = useState<InboxItem[]>(() => loadJSON<InboxItem[]>("aurum.inbox", []));
  const [now, setNow] = useState(Date.now());
  const sent = useRef<Set<string>>(new Set(loadJSON<string[]>("aurum.sent", [])));
  const firstLoad = useRef(true);

  /* ── in-tab notifications (from the shared event feed) ── */
  const notify = useCallback((events: PushEvent[], silent: boolean) => {
    const s = settingsRef.current;
    const items: InboxItem[] = [];
    const today = new Date().toDateString();
    for (const e of events) {
      const key = `${e.signalId ?? e.at}:${e.event}`;
      if (sent.current.has(key)) continue;
      sent.current.add(key);
      const digest = inQuiet(s, Date.now()) && e.priority !== "high";
      items.push({ id: key, event: e.event, title: e.title, body: e.body, at: e.at, signalId: e.signalId, read: silent, digest });
      if (silent || Date.now() - e.at > 30 * 60_000) continue;
      const allowed = s.events[e.event] !== false && PRIO[e.priority ?? PRIORITY_OF[e.event] ?? "normal"] >= PRIO[s.minPriority];
      const countKey = `aurum.pushcount.${today}`;
      const count = loadJSON<number>(countKey, 0);
      if (!allowed || digest || count >= s.dailyCap) continue;
      toast(e.title, { description: e.body });
      if (s.pushEnabled && "Notification" in window && Notification.permission === "granted") {
        try {
          const n = new Notification(e.title, { body: e.body, tag: key });
          n.onclick = () => {
            window.focus();
            if (e.signalId) window.location.hash = `#/signals/${e.signalId}`;
          };
          saveJSON(countKey, count + 1);
        } catch {
          /* mobile browsers may require a service worker */
        }
      }
    }
    if (items.length) {
      setInbox((prev) => {
        const next = [...items.reverse(), ...prev].slice(0, 200);
        saveJSON("aurum.inbox", next);
        return next;
      });
      saveJSON("aurum.sent", [...sent.current].slice(-3000));
    }
  }, []);

  const applySnapshot = useCallback(
    (s: Snapshot) => {
      setSnap(s);
      setEngine(s.engine);
      setCandles(s.candles);
      setAnalysis(s.analysis);
      setCalendar(s.calendar);
      notify(s.feed, firstLoad.current && sent.current.size === 0);
      firstLoad.current = false;
    },
    [notify],
  );

  const refresh = useCallback(async () => {
    try {
      applySnapshot(await fetchSnapshot());
    } catch (e) {
      console.warn("snapshot refresh failed", e);
    }
  }, [applySnapshot]);

  /* ── demo fallback: local engine on a synthetic market ── */
  const runDemo = useCallback(async (signal: { cancelled: boolean }) => {
    setMode("demo");
    setMessage("Сервер недоступен — запуск локального демо-рынка…");
    const dm = new DemoMarket();
    const t0 = Date.now();
    let set = dm.build(t0, HISTORY_DAYS + 230);
    const cal = generatedCalendar(set.M15[0].t, t0);
    setCalendar(cal);
    const st = initialState("demo");
    st.lastTs = set.M15[set.M15.length - HISTORY_DAYS * 96 - 1].t;
    const ctx: StepCtx = { calendar: cal, sentiment: null, spread: 0.3, quoteAgeMs: 0 };
    const run = async (live: boolean) => {
      const closes = set.M15.map((c) => c.t + TF_MS.M15).filter((ct) => ct > st.lastTs && ct <= Date.now());
      const pushes: PushEvent[] = [];
      setPhase(live ? "ready" : "backtest");
      for (let i = 0; i < closes.length; i++) {
        step(st, set, closes[i], ctx, pushes);
        if (!live && i % 80 === 0) {
          setProgress(i / closes.length);
          setMessage(`Бэктест движков: ${i}/${closes.length} свечей M15`);
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      if (live) notify(pushes, false);
      setEngine({ ...st, signals: [...st.signals], journal: [...st.journal], reports: { ...st.reports } });
      setCandles(set);
      setAnalysis(liveAnalysis(st, set, Date.now(), ctx));
    };
    await run(false);
    if (signal.cancelled) return;
    setPhase("ready");
    const iv = setInterval(() => {
      set = dm.advance(Date.now());
      void run(true);
    }, 3000);
    return () => clearInterval(iv);
  }, [notify]);

  /* ── boot ── */
  useEffect(() => {
    const sig = { cancelled: false };
    let stopDemo: (() => void) | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    (async () => {
      try {
        setMessage("Загрузка общей истории сигналов…");
        const s = await fetchSnapshot();
        if (sig.cancelled) return;
        applySnapshot(s);
        setMode("shared");
        setPhase("ready");
        poll = setInterval(() => void refresh(), 60_000);
      } catch (e) {
        console.warn("shared snapshot unavailable", e);
        stopDemo = await runDemo(sig);
        toast("Демо-режим", { description: "Общий сервер данных пока недоступен. Показан локальный демо-рынок." });
      }
    })();
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      sig.cancelled = true;
      clearInterval(clock);
      if (poll) clearInterval(poll);
      stopDemo?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── live spot ticker (XAU/USD, every 15 s) ── */
  useEffect(() => {
    if (mode !== "shared") return;
    let alive = true;
    const tick = async () => {
      const p = await fetchSpot();
      if (alive && p) setSpot({ p, at: Date.now() });
    };
    void tick();
    const iv = setInterval(tick, 15_000);
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void tick();
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [mode, refresh]);

  const setSettings = useCallback((p: Partial<Settings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...p };
      saveJSON("aurum.settings", next);
      return next;
    });
  }, []);

  const lastClose = candles ? candles.M15[candles.M15.length - 1].c : null;
  const liveFresh = !!spot && now - spot.at < 60_000;
  const price = mode === "shared" ? (liveFresh ? spot!.p : (snap?.price ?? lastClose)) : lastClose;
  const prevClose = mode === "shared" ? (snap?.prevClose ?? null) : candles && candles.D1.length > 1 ? candles.D1[candles.D1.length - 2].c : null;

  const value: Ctx = {
    phase,
    progress,
    message,
    mode,
    provider: mode === "shared" ? (snap?.provider ?? "") : "демо-рынок (синтетические котировки)",
    candles,
    price,
    livePrice: liveFresh,
    prevClose,
    spread: snap?.spread ?? 0.3,
    quoteAt: liveFresh ? spot!.at : (snap?.quoteAt ?? now),
    updatedAt: snap?.updatedAt ?? now,
    calendar,
    calendarSource: snap?.calendarSource ?? "расчётное расписание",
    headlines: snap?.headlines ?? [],
    sentiment: snap?.sentiment ?? null,
    sentimentBy: snap?.sentimentBy ?? "нет данных",
    engine,
    analysis,
    settings,
    inbox,
    telegram: snap?.telegram ?? null,
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
    refresh,
  };
  return <EngineCtx.Provider value={value}>{children}</EngineCtx.Provider>;
}

export const isOpen = (s: Signal) => !TERMINAL.includes(s.status);
