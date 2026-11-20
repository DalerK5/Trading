import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useEngine, isOpen } from "@/app/store";
import { ago, Bar, countdown, DirBadge, Empty, fmt, fmtHM, fmtTime, Panel, WcsGauge } from "@/app/ui";
import { PriceChart } from "@/app/PriceChart";
import { SignalCard } from "./Signals";
import { SESSION_LABEL, type Level, type TF } from "@/engine/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const KIND: Record<Level["kind"], string> = { order_block: "order block", swing: "swing-зона", fvg: "FVG", liquidity_pool: "liquidity pool" };
const TREND = { up: "↑", down: "↓", range: "↔" } as const;

/** XAUUSD spot trades Sunday ~22:00 UTC → Friday ~22:00 UTC */
function xauOpen(t: number) {
  const d = new Date(t);
  const day = d.getUTCDay();
  const h = d.getUTCHours();
  return !(day === 6 || (day === 5 && h >= 22) || (day === 0 && h < 22));
}

export default function Dashboard() {
  const e = useEngine();
  const [tf, setTf] = useState<TF>("M15");
  const a = e.analysis;
  const price = e.price;
  const change = price != null && e.prevClose ? price - e.prevClose : null;
  const age = e.now - e.quoteAt;
  const staleMs = e.livePrice || e.mode === "demo" ? 120_000 : 12 * 60_000;
  const open = e.engine.signals.filter(isOpen);

  const chartLevels = useMemo(() => {
    if (!a) return [];
    return a.levels
      .filter((l) => l.kind !== "fvg" || l.tf === tf || tf === "M15")
      .filter((l) => Math.abs((l.low + l.high) / 2 - a.price) < 2.5 * a.atr.H4)
      .filter((l) => l.high - l.low <= 1.2 * a.atr.H4)
      .sort((x, y) => y.strength - x.strength)
      .slice(0, 6);
  }, [a, tf]);

  const levelMap = useMemo(() => {
    if (!a) return { above: [] as Level[], below: [] as Level[] };
    const ls = a.levels.filter((l) => l.kind !== "fvg" && l.strength >= 0.25);
    const above = ls.filter((l) => l.low > a.price).sort((x, y) => x.low - y.low).slice(0, 3).reverse();
    const below = ls.filter((l) => l.high < a.price).sort((x, y) => y.high - x.high).slice(0, 3);
    return { above, below };
  }, [a]);

  const upcoming = e.calendar.filter((c) => c.at > e.now - 60 * 60_000).slice(0, 6);
  const markers = useMemo(
    () =>
      e.engine.signals.slice(-30).map((s) => ({
        time: s.publishedAt - 15 * 60_000,
        text: s.id.slice(-3),
        color: s.dir === "long" ? "#8aa860" : "#c1563b",
        position: s.dir === "long" ? ("belowBar" as const) : ("aboveBar" as const),
        shape: s.dir === "long" ? ("arrowUp" as const) : ("arrowDown" as const),
      })),
    [e.engine.signals],
  );

  const chartCandles = useMemo(() => e.candles?.[tf].slice(-400) ?? [], [e.candles, tf]);
  const activeSig = open[0] ?? null;
  const wcs = a ? Math.max(a.wcsLong, a.wcsShort) : 0;
  const nhi = a?.nextHighImpact;

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      {/* price */}
      <Panel
        className="lg:col-span-4"
        title="XAUUSD · спот"
        right={
          <span className={cn("flex items-center gap-1.5", !xauOpen(e.now) ? "text-taupe" : age > staleMs ? "text-bear" : "text-bull")}>
            <span className={cn("h-1.5 w-1.5 rounded-full", !xauOpen(e.now) ? "bg-taupe" : age > staleMs ? "bg-bear" : "bg-bull animate-pulse")} />
            {!xauOpen(e.now) ? "рынок закрыт" : age > staleMs ? "данные устарели" : "live"}
          </span>
        }
      >
        <div className="font-mono text-4xl font-semibold tracking-tight text-cream">{fmt(price)}</div>
        <div className={cn("mt-1 font-mono text-sm", (change ?? 0) >= 0 ? "text-bull" : "text-bear")}>
          {change == null ? "—" : `${change >= 0 ? "▲ +" : "▼ "}${fmt(change)} (${change >= 0 ? "+" : ""}${fmt((change / e.prevClose!) * 100)}%)`}
          <span className="ml-2 text-taupe">к закрытию D1</span>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-2 text-[12px]">
          <div>
            <dt className="text-taupe">Спред</dt>
            <dd className="font-mono text-cream">{fmt(e.spread)}</dd>
          </div>
          <div>
            <dt className="text-taupe">Сессия</dt>
            <dd className="text-cream">{a ? SESSION_LABEL[a.session] : "—"}</dd>
          </div>
          <div>
            <dt className="text-taupe">Обновлено</dt>
            <dd className="text-cream">{ago(age)}</dd>
          </div>
        </dl>
        <p className="mt-3 text-[11px] leading-snug text-taupe">
          {e.mode === "shared"
            ? `Цена: XAU/USD спот ${e.livePrice ? "(live, каждые 15 сек)" : ""}. Анализ: ${e.provider}. Сервер пересчитывает анализ каждые 5 мин — история сигналов общая для всех пользователей. Последний пересчёт ${ago(e.now - e.updatedAt)}.`
            : "Демо-рынок: синтетические котировки XAUUSD. Общий сервер данных недоступен."}
        </p>
      </Panel>

      {/* AI analysis */}
      <Panel className="lg:col-span-4" title="Анализ ИИ" right={a ? `обновлено ${fmtHM(a.at)}` : "…"}>
        {a ? (
          <div className="flex gap-4">
            <WcsGauge value={wcs} />
            <div className="min-w-0 flex-1 space-y-1.5 text-[13px]">
              <div>
                Bias:{" "}
                <span className={cn("font-mono font-semibold", a.bias === "bullish" ? "text-bull" : a.bias === "bearish" ? "text-bear" : "text-cream")}>
                  {a.bias.toUpperCase()}
                </span>
              </div>
              <div className="font-mono text-[12px] text-cream/90">
                {(["M15", "H1", "H4", "D1"] as TF[]).map((t) => (
                  <span key={t} className="mr-2">
                    {t} <span className={a.structure[t].trend === "up" ? "text-bull" : a.structure[t].trend === "down" ? "text-bear" : "text-taupe"}>{TREND[a.structure[t].trend]}</span>
                  </span>
                ))}
              </div>
              <div className="text-taupe">
                News:{" "}
                <span className="text-cream">
                  {a.sentiment == null ? "нет данных" : `${a.sentiment > 0.15 ? "bullish" : a.sentiment < -0.15 ? "bearish" : "neutral"} (${a.sentiment >= 0 ? "+" : ""}${a.sentiment.toFixed(2)})`}
                </span>
              </div>
              <div className="text-taupe">
                {nhi ? (
                  <>
                    до {nhi.title}: <span className="font-mono text-gold">{countdown(nhi.at - e.now)}</span>
                  </>
                ) : (
                  "high-impact событий нет"
                )}
              </div>
              <div className="flex gap-3 pt-1 font-mono text-[11px]">
                <span className="text-bull">LONG {a.wcsLong}</span>
                <span className="text-bear">SHORT {a.wcsShort}</span>
                <span className="text-taupe">ATR H1 {fmt(a.atr.H1)}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-taupe">Расчёт…</div>
        )}
        {a?.blackout && (
          <div className="mt-3 border border-bear/40 bg-bear/10 px-3 py-2 text-[12px] text-cream">
            Blackout: {a.blackout.title} — публикация новых сигналов запрещена
          </div>
        )}
      </Panel>

      {/* level map */}
      <Panel className="lg:col-span-4" title="Карта уровней" right="тап — происхождение">
        {a ? (
          <div className="space-y-1 font-mono text-[12.5px]">
            {levelMap.above.map((l, i) => (
              <LevelRow key={l.id} l={l} label={`R${levelMap.above.length - i}`} />
            ))}
            <div className="flex items-center gap-2 border-y border-gold/60 bg-gold/10 px-2 py-1.5 text-gold">
              <span>═══</span>
              <span className="font-semibold">{fmt(a.price)}</span>
              <span className="text-[11px]">— текущая цена</span>
            </div>
            {levelMap.below.map((l, i) => (
              <LevelRow key={l.id} l={l} label={`S${i + 1}`} />
            ))}
            {a.vp && (
              <div className="pt-2 text-[11px] text-taupe">
                VP 20 дн: POC {fmt(a.vp.poc)} · VAH {fmt(a.vp.vah)} · VAL {fmt(a.vp.val)}
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-taupe">…</div>
        )}
      </Panel>

      {/* chart */}
      <Panel
        className="lg:col-span-8"
        title="График (UTC)"
        right={
          <div className="flex">
            {(["M15", "H1", "H4", "D1"] as TF[]).map((t) => (
              <button key={t} onClick={() => setTf(t)} className={cn("px-2 py-1 font-mono text-[11px]", tf === t ? "bg-gold text-ink" : "text-taupe hover:text-cream")}>
                {t}
              </button>
            ))}
          </div>
        }
      >
        <div className="-mx-2">{chartCandles.length > 0 && <PriceChart key={tf} candles={chartCandles} levels={chartLevels} signal={activeSig} markers={tf === "M15" || tf === "H1" ? markers : []} />}</div>
      </Panel>

      {/* active setup */}
      <div className="space-y-4 lg:col-span-4">
        <Panel title="Активный сетап" right={<Link to="/signals" className="hover:text-gold">все сигналы →</Link>}>
          {open.length ? (
            <div className="space-y-3">
              {open.map((s) => (
                <SignalCard key={s.id} s={s} compact />
              ))}
            </div>
          ) : (
            <div>
              <div className="text-[15px] font-semibold text-cream">Сетапов нет: ждём</div>
              <ul className="mt-2 space-y-1 text-[12.5px] text-taupe">
                {(a?.rejections.length ? a.rejections : ["Цена в середине диапазона"]).map((r, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-gold">·</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11.5px] text-taupe">Отсутствие сигнала — тоже результат работы ИИ. Порог публикации: WCS ≥ 70, R:R ≥ 1:2, без вето.</p>
            </div>
          )}
        </Panel>

        {a && a.candidates.length > 0 && (
          <Panel title="Кандидаты (WCS ≥ 55 → наблюдение)">
            <div className="space-y-2">
              {[...a.candidates]
                .sort((x, y) => y.wcs - x.wcs)
                .slice(0, 4)
                .map((c, i) => (
                  <div key={i} className="text-[12px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <DirBadge dir={c.dir} />
                        <span className="font-mono text-cream">{fmt(c.entry)}</span>
                      </span>
                      <span className={cn("font-mono", c.wcs >= 70 ? "text-gold" : "text-taupe")}>WCS {c.wcs}</span>
                    </div>
                    <div className="mt-1">
                      <Bar value={c.wcs} max={100} tone={c.wcs >= 70 ? "gold" : "cream"} />
                    </div>
                    {c.vetoes[0] && <div className="mt-0.5 text-[11px] text-bear/90">вето: {c.vetoes[0]}</div>}
                  </div>
                ))}
            </div>
          </Panel>
        )}
      </div>

      {/* events */}
      <Panel className="lg:col-span-6" title="Ближайшие события USD" right={e.calendarSource}>
        {upcoming.length ? (
          <table className="w-full text-[12.5px]">
            <tbody>
              {upcoming.map((c) => (
                <tr key={c.id} className="border-b border-line/60 last:border-0">
                  <td className="py-1.5 pr-3 font-mono text-taupe whitespace-nowrap">{fmtTime(c.at)}</td>
                  <td className="py-1.5 pr-3 text-cream">{c.title}</td>
                  <td className="py-1.5 pr-3 font-mono text-[11px] text-taupe">{c.forecast ? `прогноз ${c.forecast}` : ""}</td>
                  <td className="py-1.5 text-right">
                    <span className={cn("font-mono text-[11px]", c.impact === "high" ? "text-bear" : "text-gold")}>
                      {c.impact} {c.impact === "high" ? "███" : "█"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>Событий нет</Empty>
        )}
      </Panel>

      {/* news */}
      <Panel className="lg:col-span-6" title="Новостной сантимент (6 ч)" right={<button onClick={() => void e.refresh()} className="hover:text-gold">{e.sentimentBy} ↻</button>}>
        {e.headlines.length ? (
          <ul className="max-h-64 space-y-2 overflow-y-auto pr-1 text-[12.5px]">
            {e.headlines.slice(0, 15).map((h, i) => (
              <li key={i} className="flex gap-2">
                <span className={cn("mt-0.5 shrink-0 font-mono text-[10px] w-14", h.label === "bullish" ? "text-bull" : h.label === "bearish" ? "text-bear" : "text-taupe")}>{h.label}</span>
                <a href={h.url} target="_blank" rel="noreferrer" className="text-cream/90 hover:text-gold">
                  {h.title}
                  <span className="ml-1 text-taupe">· {h.source}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>
            {e.mode === "demo"
              ? "В демо-режиме новостной поток отключён — вес фактора «сантимент» автоматически перераспределяется."
              : "Заголовки недоступны (GDELT). Фактор сантимента исключён из WCS, веса перенормированы."}
          </Empty>
        )}
      </Panel>
    </div>
  );
}

function LevelRow({ l, label }: { l: Level; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-raised">
          <span className={l.direction === "supply" ? "text-bear" : "text-bull"}>───</span>
          <span className="w-20 text-cream">{fmt((l.low + l.high) / 2)}</span>
          <span className="w-7 text-taupe">{label}</span>
          <span className="truncate text-taupe">
            {l.tf} {KIND[l.kind]}
          </span>
          <span className="ml-auto w-12">
            <Bar value={l.strength} tone={l.direction === "supply" ? "bear" : "bull"} />
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" className="border border-line bg-ink text-cream">
        <div className="space-y-0.5 font-mono text-[11px]">
          <div>
            {l.tf} · {KIND[l.kind]} · {l.direction === "demand" ? "спрос" : "предложение"}
          </div>
          <div>
            Зона {fmt(l.low)} – {fmt(l.high)}
          </div>
          <div>
            Сила {l.strength.toFixed(2)} · касаний {l.touches}
          </div>
          <div>Сформирован {fmtTime(l.formedAt)}</div>
          {l.confluences.length > 0 && <div className="text-taupe">{l.confluences.join(", ")}</div>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
