import { lazy, Suspense, useState } from "react";
import { NavLink, Route, Routes, Link, useLocation } from "react-router";
import { Toaster } from "sonner";
import { EngineProvider, useEngine } from "@/app/store";
import { ago, fmt, fmtTime } from "@/app/ui";
import Dashboard from "@/pages/Dashboard";
import Signals, { SignalDetail } from "@/pages/Signals";
import Stats from "@/pages/Stats";
import SettingsPage from "@/pages/SettingsPage";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const Docs = lazy(() => import("@/pages/Docs"));

const TABS = [
  { to: "/", label: "Dashboard", icon: "M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z" },
  { to: "/signals", label: "Сигналы", icon: "M3 17l6-6 4 4 8-8M15 7h6v6" },
  { to: "/stats", label: "Статистика ИИ", icon: "M4 20V10M10 20V4M16 20v-8M22 20H2" },
  { to: "/settings", label: "Настройки", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" },
];

function Icon({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function Inbox() {
  const { inbox, markInboxRead, clearInbox } = useEngine();
  const unread = inbox.filter((i) => !i.read).length;
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) markInboxRead();
      }}
    >
      <PopoverTrigger asChild>
        <button className="relative flex h-14 w-14 items-center justify-center border-l border-line text-cream hover:bg-raised" aria-label="Уведомления">
          <Icon d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" />
          {unread > 0 && <span className="absolute right-3 top-3 min-w-[16px] bg-gold px-1 font-mono text-[10px] font-bold text-ink">{unread > 99 ? "99+" : unread}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] border-line bg-ink p-0 text-cream">
        <div className="flex items-center justify-between border-b border-line px-4 py-2">
          <span className="micro-label">Уведомления</span>
          <button onClick={clearInbox} className="font-mono text-[11px] text-taupe hover:text-gold">
            очистить
          </button>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {inbox.length ? (
            inbox.map((i) => (
              <Link
                key={i.id}
                to={i.signalId ? `/signals/${i.signalId}` : "/"}
                onClick={() => setOpen(false)}
                className={cn("block border-b border-line/60 px-4 py-2.5 hover:bg-raised", !i.read && "bg-gold/5")}
              >
                <div className="flex items-center gap-2 text-[13px]">
                  {!i.read && <span className="h-1.5 w-1.5 bg-gold" />}
                  <span className="text-cream">{i.title}</span>
                  {i.digest && <span className="ml-auto font-mono text-[9.5px] text-taupe">ДАЙДЖЕСТ</span>}
                </div>
                <div className="text-[12px] text-taupe">{i.body}</div>
                <div className="font-mono text-[10.5px] text-taupe/70">{fmtTime(i.at)}</div>
              </Link>
            ))
          ) : (
            <div className="px-4 py-8 text-center text-[13px] text-taupe">Пока тихо. Уведомления появятся при публикации сетапов и событиях сделок.</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Shell() {
  const e = useEngine();
  const loc = useLocation();
  const change = e.price != null && e.prevClose ? e.price - e.prevClose : 0;

  if (e.phase !== "ready") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-ink px-6 text-cream">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 bg-gold" />
          <span className="font-mono text-lg font-semibold tracking-[0.08em]">AURUM·AI</span>
        </div>
        <div className="w-full max-w-sm space-y-2">
          <Progress value={e.phase === "loading" ? 5 : Math.round(e.progress * 100)} className="h-1 bg-line [&>div]:bg-gold" />
          <div className="text-center font-mono text-[12px] text-taupe">{e.message}</div>
        </div>
        <p className="max-w-md text-center text-[12.5px] text-taupe">
          Движки SnR/SMC, структура, RSI-дивергенции, Volume Profile и новостной фильтр прогоняются walk-forward по истории — так формируется честный трек-рекорд и журнал самообучения.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink text-cream">
      <header className="fixed inset-x-0 top-0 z-40 border-b border-line bg-ink/95 backdrop-blur">
        <div className="flex h-14 items-stretch">
          <Link to="/" className="flex items-center gap-2 border-r border-line px-4 sm:px-5">
            <span className="h-2.5 w-2.5 bg-gold" />
            <span className="font-mono text-sm font-semibold tracking-[0.08em]">AURUM·AI</span>
          </Link>
          <div className="flex items-center gap-3 px-4 font-mono">
            <span className="hidden text-[11px] tracking-[0.14em] text-taupe sm:inline">XAUUSD</span>
            <span className="text-[15px] font-semibold">{fmt(e.price)}</span>
            <span className={cn("hidden text-[12px] sm:inline", change >= 0 ? "text-bull" : "text-bear")}>
              {change >= 0 ? "▲" : "▼"} {fmt(Math.abs(change))}
            </span>
          </div>
          <nav className="ml-4 hidden items-stretch md:flex">
            {TABS.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.to === "/"} className={({ isActive }) => cn("flex items-center border-l border-line px-4 text-[13px]", isActive ? "bg-raised text-gold" : "text-cream/75 hover:text-cream")}>
                {t.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-stretch">
            <span className={cn("hidden items-center gap-1.5 border-l border-line px-4 font-mono text-[10.5px] uppercase tracking-[0.12em] lg:flex", e.mode === "demo" ? "text-gold" : "text-taupe")}>
              <span className={cn("h-1.5 w-1.5 rounded-full", e.mode === "demo" ? "bg-gold" : e.livePrice ? "bg-bull animate-pulse" : "bg-taupe")} />
              {e.mode === "demo" ? "демо-рынок" : `${e.livePrice ? "live" : "цена"} · ${ago(e.now - e.quoteAt)}`}
            </span>
            <Link to="/docs" className="hidden items-center border-l border-line px-4 font-mono text-[11px] uppercase tracking-[0.12em] text-taupe hover:text-gold sm:flex">
              ТЗ
            </Link>
            <Inbox />
          </div>
        </div>
      </header>

      {e.mode === "demo" && loc.pathname === "/" && (
        <div className="mt-14 border-b border-gold/30 bg-gold/10 px-4 py-2 text-center text-[12px] text-gold">
          Демо-режим: общий сервер данных недоступен, показан локальный синтетический рынок XAUUSD.
        </div>
      )}

      <main className={cn("mx-auto max-w-[1440px] px-3 pb-24 sm:px-5 md:pb-10", e.mode === "demo" && loc.pathname === "/" ? "pt-4" : "pt-[72px]")}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/signals" element={<Signals />} />
          <Route path="/signals/:id" element={<SignalDetail />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
        <footer className="mt-10 border-t border-line pt-4 text-[11.5px] leading-relaxed text-taupe">
          AURUM·AI — аналитический инструмент, не брокер и не инвестиционная рекомендация. Торговля золотом сопряжена с высоким риском потери капитала.{" "}
          <Link to="/docs" className="text-gold hover:underline">
            Проектная документация →
          </Link>
        </footer>
      </main>

      {/* mobile tab bar */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-line bg-ink/95 backdrop-blur md:hidden">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.to === "/"} className={({ isActive }) => cn("flex flex-col items-center gap-1 py-2 text-[10.5px]", isActive ? "text-gold" : "text-taupe")}>
            <Icon d={t.icon} />
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export default function App() {
  const loc = useLocation();
  if (loc.pathname.startsWith("/docs"))
    return (
      <Suspense fallback={<div className="min-h-screen bg-ink" />}>
        <Docs />
      </Suspense>
    );
  return (
    <EngineProvider>
      <TooltipProvider delayDuration={150}>
        <Shell />
        <Toaster theme="dark" position="top-right" toastOptions={{ style: { background: "#1b1916", border: "1px solid #2c261d", color: "#fef1e8", borderRadius: 2 } }} />
      </TooltipProvider>
    </EngineProvider>
  );
}
