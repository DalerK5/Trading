import { useEffect, useMemo, useState } from "react";
import { NAV } from "@/lib/nav";
import { Overview } from "@/sections/Overview";
import { ProductUx } from "@/sections/ProductUx";
import { AiArch } from "@/sections/AiArch";
import { SelfLearning } from "@/sections/SelfLearning";
import { DataSchemas } from "@/sections/DataSchemas";
import { TechStack } from "@/sections/TechStack";
import { Roadmap } from "@/sections/Roadmap";
import { Risks } from "@/sections/Risks";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/* ── scrollspy ─────────────────────────────────────────────────── */

function useScrollSpy() {
  const [active, setActive] = useState<string>("obzor");
  useEffect(() => {
    const ids = NAV.flatMap((n) => [n.id, ...n.children.map((c) => c.id)]);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id);
        }
      },
      { rootMargin: "-15% 0px -70% 0px" }
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);
  return active;
}

/* ── nav list (shared by sidebar & drawer) ─────────────────────── */

function NavList({
  activeId,
  onNavigate,
}: {
  activeId: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col">
      {NAV.map((item) => {
        const isActive =
          item.id === activeId || item.children.some((c) => c.id === activeId);
        return (
          <a
            key={item.id}
            href={`#${item.id}`}
            onClick={onNavigate}
            className={cn(
              "flex min-h-[44px] items-center gap-3 border-b border-line/60 px-4 py-3 text-[13px] transition-colors",
              isActive
                ? "bg-raised text-gold"
                : "text-cream/70 hover:text-cream hover:bg-raised/60"
            )}
          >
            <span className="font-mono text-[11px] text-taupe">{item.num}</span>
            <span className="leading-snug">{item.label}</span>
          </a>
        );
      })}
    </nav>
  );
}

/* ── hero decoration: SVG chart ────────────────────────────────── */

function HeroChart() {
  const pts =
    "0,84 18,78 36,82 54,66 72,70 90,54 108,60 126,44 144,50 162,38 180,46 198,30 216,36 234,26 252,34 270,20 288,26 306,14";
  return (
    <svg
      viewBox="0 0 320 100"
      className="h-28 w-full"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {[20, 50, 80].map((y) => (
        <line key={y} x1="0" y1={y} x2="320" y2={y} stroke="#2c261d" strokeWidth="1" />
      ))}
      <line x1="0" y1="62" x2="320" y2="62" stroke="#d69900" strokeWidth="1" strokeDasharray="4 4" opacity="0.55" />
      <line x1="0" y1="30" x2="320" y2="30" stroke="#d69900" strokeWidth="1" strokeDasharray="4 4" opacity="0.35" />
      <polyline points={pts} fill="none" stroke="#fef1e8" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="306" cy="14" r="2.5" fill="#d69900" />
    </svg>
  );
}

/* ── ticker ────────────────────────────────────────────────────── */

const TICKER_ITEMS = [
  "XAUUSD · SPOT", "SUPPORT / RESISTANCE", "ORDER BLOCKS", "LIQUIDITY SWEEP",
  "MARKET STRUCTURE", "RSI DIVERGENCE", "VOLUME PROFILE", "CPI · PPI · NFP · FOMC",
  "WEIGHTED CONFLUENCE SCORE", "R:R ≥ 1:2", "SELF-CORRECTION LOOP", "POST-TRADE ANALYSIS",
];

function Ticker() {
  const row = [...TICKER_ITEMS, ...TICKER_ITEMS];
  return (
    <div className="overflow-hidden border-y border-line bg-cream text-ink">
      <div className="ticker-track flex w-max whitespace-nowrap py-2">
        {row.map((t, i) => (
          <span key={i} className="font-mono text-[11px] uppercase tracking-[0.18em] px-6">
            {t} <span className="text-gold">·</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── app ───────────────────────────────────────────────────────── */

export default function App() {
  const activeId = useScrollSpy();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const activeSection = useMemo(
    () =>
      NAV.find(
        (n) => n.id === activeId || n.children.some((c) => c.id === activeId)
      ) ?? NAV[0],
    [activeId]
  );

  return (
    <div className="min-h-screen bg-ink text-cream">
      {/* header */}
      <header className="fixed inset-x-0 top-0 z-40 border-b border-line bg-ink/95 backdrop-blur">
        <div className="flex h-14 items-stretch">
          <div className="flex items-center gap-2 border-r border-line px-4 sm:px-5">
            <span className="h-2.5 w-2.5 bg-gold" />
            <span className="font-mono text-sm font-semibold tracking-[0.08em]">
              AURUM·AI
            </span>
          </div>
          <div className="hidden sm:flex items-center px-5 font-mono text-[11px] uppercase tracking-[0.18em] text-taupe">
            Проектная документация — автономный ИИ-аналитик XAUUSD
          </div>
          <div className="ml-auto flex items-center">
            <div className="hidden md:flex items-center gap-5 border-l border-line px-5 font-mono text-[11px] uppercase tracking-[0.14em] text-taupe">
              <span>v1.0</span>
              <span>01.10.2026</span>
              <span className="text-gold">Концепция + ТЗ</span>
            </div>
            <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
              <SheetTrigger asChild>
                <button
                  className="flex lg:hidden h-14 w-14 items-center justify-center border-l border-line text-cream"
                  aria-label="Открыть оглавление"
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                </button>
              </SheetTrigger>
              <SheetContent
                side="right"
                className="w-[300px] border-line bg-ink p-0 text-cream"
              >
                <SheetTitle className="border-b border-line px-4 py-4 font-mono text-[11px] uppercase tracking-[0.18em] text-taupe">
                  Содержание
                </SheetTitle>
                <div className="max-h-[calc(100vh-60px)] overflow-y-auto safe-bottom">
                  <NavList activeId={activeId} onNavigate={() => setDrawerOpen(false)} />
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <div className="pt-14 lg:grid lg:grid-cols-[248px_minmax(0,1fr)] xl:grid-cols-[248px_minmax(0,1fr)_220px]">
        {/* left sidebar */}
        <aside className="hidden lg:block border-r border-line">
          <div className="sticky top-14 max-h-[calc(100vh-56px)] overflow-y-auto">
            <div className="px-4 py-4 micro-label border-b border-line">Содержание</div>
            <NavList activeId={activeId} />
            <div className="px-4 py-5 text-[11.5px] leading-relaxed text-taupe">
              Документ: концепция, архитектура и техническое задание.
              Не является инвестиционной рекомендацией.
            </div>
          </div>
        </aside>

        {/* main column */}
        <main className="min-w-0">
          {/* hero */}
          <div className="border-b border-line">
            <div className="px-5 py-12 sm:px-8 lg:px-12 lg:py-16 max-w-[860px]">
              <div className="micro-label text-gold mb-4">
                Техническое задание · v1.0
              </div>
              <h1 className="font-sans font-bold leading-[0.98] tracking-tight text-[40px] sm:text-[64px]">
                Автономный ИИ-аналитик
                <br />
                золота <span className="text-gold">XAUUSD</span>
              </h1>
              <p className="mt-6 max-w-[62ch] text-[15px] sm:text-base leading-relaxed text-taupe">
                Концепция, архитектура и техническое задание бесплатного приложения:
                мульти-стратегический анализ в реальном времени, опережающие сигналы
                с R:R ≥ 1:2 и цикл самообучения на исходах сделок.
              </p>
              <div className="mt-8 border border-line">
                <HeroChart />
                <div className="grid grid-cols-2 sm:grid-cols-4 border-t border-line">
                  {[
                    ["Инструмент", "XAUUSD · спот"],
                    ["Таймфреймы", "M15 · H1 · H4 · D1"],
                    ["Сигналы", "опережающие, R:R ≥ 1:2"],
                    ["Стоимость MVP", "≈ $0–10 / мес"],
                  ].map(([k, v]) => (
                    <div key={k} className="border-r border-line last:border-r-0 px-3 py-3 sm:px-4">
                      <div className="micro-label">{k}</div>
                      <div className="mt-1 font-mono text-[12.5px] text-cream">{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <Ticker />
          </div>

          <Overview />
          <ProductUx />
          <AiArch />
          <SelfLearning />
          <DataSchemas />
          <TechStack />
          <Roadmap />
          <Risks />

          {/* footer */}
          <footer className="px-5 py-10 sm:px-8 lg:px-12 max-w-[860px] safe-bottom">
            <div className="border-t border-line pt-6">
              <div className="micro-label mb-3">Дисклеймер</div>
              <p className="text-[12.5px] leading-relaxed text-taupe max-w-[72ch]">
                Настоящий документ описывает концепцию аналитического продукта и не является
                инвестиционной рекомендацией. Торговля золотом и производными инструментами
                сопряжена с высоким риском потери капитала. Упомянутые лимиты бесплатных
                тарифов сторонних сервисов актуальны на момент составления документа и требуют
                проверки перед реализацией.
              </p>
              <div className="mt-6 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-taupe">
                <span className="h-2 w-2 bg-gold" /> AURUM·AI — концепция + ТЗ · 01.10.2026
              </div>
            </div>
          </footer>
        </main>

        {/* right toc */}
        <aside className="hidden xl:block border-l border-line">
          <div className="sticky top-14 px-4 py-4">
            <div className="micro-label mb-3">В этом разделе</div>
            <div className="mb-2 font-mono text-[11px] text-gold">
              {activeSection.num} — {activeSection.label}
            </div>
            <nav className="flex flex-col">
              {activeSection.children.map((c) => (
                <a
                  key={c.id}
                  href={`#${c.id}`}
                  className={cn(
                    "flex min-h-[36px] items-center border-l py-1.5 pl-3 text-[12px] leading-snug transition-colors",
                    c.id === activeId
                      ? "border-gold text-cream"
                      : "border-line text-taupe hover:text-cream"
                  )}
                >
                  {c.label}
                </a>
              ))}
            </nav>
          </div>
        </aside>
      </div>
    </div>
  );
}
