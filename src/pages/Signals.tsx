import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { useEngine, isOpen } from "@/app/store";
import { Bar, countdown, DirBadge, Empty, fmt, fmtTime, Panel, StatusBadge } from "@/app/ui";
import { PriceChart } from "@/app/PriceChart";
import { CAUSE_LABEL, FACTOR_LABEL, SETUP_LABEL, SETUP_STRATEGY, SESSION_LABEL, TF_MS, type Signal } from "@/engine/types";
import { cn } from "@/lib/utils";

const orderLabel = (s: Signal) =>
  s.type === "limit_zone" ? (s.dir === "long" ? "BUY LIMIT" : "SELL LIMIT") : s.type === "stop_breakout" ? (s.dir === "long" ? "BUY STOP" : "SELL STOP") : s.dir === "long" ? "BUY MARKET" : "SELL MARKET";

const EVENT_RU: Record<string, string> = {
  published: "Опубликован",
  approaching: "Цена у зоны входа",
  activated: "Вход активирован",
  tp1: "TP1 достигнут",
  tp2: "TP2 достигнут",
  tp3: "TP3 достигнут",
  sl: "Стоп-лосс",
  be: "Безубыток",
  expired: "Истёк (TTL)",
  cancelled: "Отменён",
};

export function SignalCard({ s, compact }: { s: Signal; compact?: boolean }) {
  const { price, now } = useEngine();
  const R = Math.abs(s.entry - s.sl);
  const dist = price ? Math.abs(price - s.entry) / s.entry : null;
  return (
    <Link to={`/signals/${s.id}`} className="block border border-line bg-ink/60 p-3 transition-colors hover:border-gold/60">
      <div className="flex flex-wrap items-center gap-2">
        <DirBadge dir={s.dir} />
        <span className="font-mono text-[12px] text-cream">{orderLabel(s)}</span>
        <StatusBadge status={s.status} />
        <span className="ml-auto font-mono text-[11px] text-taupe">{s.id}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[13px] sm:grid-cols-5">
        <div>
          <div className="text-[10px] text-taupe">ENTRY</div>
          <div className="text-gold">{fmt(s.entry)}</div>
        </div>
        <div>
          <div className="text-[10px] text-taupe">SL</div>
          <div className="text-bear">{fmt(s.sl)}</div>
        </div>
        {s.tps.map((tp, i) => (
          <div key={i} className={cn(compact && i > 0 && "hidden sm:block")}>
            <div className="text-[10px] text-taupe">TP{i + 1}</div>
            <div className={cn("text-bull", s.maxTp > i && "underline decoration-bull/60")}>{fmt(tp)}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-taupe">
        <span>R:R 1:{s.rr.toFixed(1)}</span>
        <span>WCS {s.wcs}</span>
        <span>стоп ${fmt(R)}</span>
        {isOpen(s) && s.status === "pending" && dist != null && <span>до зоны {(dist * 100).toFixed(2)}%</span>}
        {isOpen(s) && s.status === "pending" && <span>TTL {Math.max(0, Math.round((s.expiresAt - now) / 3_600_000))} ч</span>}
        {s.rMultiple != null && !isOpen(s) && (
          <span className={s.rMultiple > 0 ? "text-bull" : s.rMultiple < 0 ? "text-bear" : ""}>
            итог {s.rMultiple > 0 ? "+" : ""}
            {s.rMultiple.toFixed(2)}R
          </span>
        )}
        <span className="ml-auto">{fmtTime(s.publishedAt)}</span>
      </div>
    </Link>
  );
}

type Outcome = "all" | "win" | "loss" | "neutral";

export default function Signals() {
  const { engine, now } = useEngine();
  const [tab, setTab] = useState<"active" | "history">("active");
  const [period, setPeriod] = useState<number>(0);
  const [outcome, setOutcome] = useState<Outcome>("all");
  const [version, setVersion] = useState("all");
  const [dir, setDir] = useState<"all" | "long" | "short">("all");

  const active = engine.signals.filter(isOpen).reverse();
  const history = useMemo(() => {
    return engine.signals
      .filter((s) => !isOpen(s))
      .filter((s) => !period || now - s.publishedAt <= period * 86_400_000)
      .filter((s) => version === "all" || s.modelVersion === version)
      .filter((s) => dir === "all" || s.dir === dir)
      .filter((s) => {
        if (outcome === "all") return true;
        if (outcome === "win") return s.maxTp >= 1;
        if (outcome === "loss") return s.status === "sl";
        return s.status === "expired" || s.status === "cancelled";
      })
      .reverse();
  }, [engine.signals, period, outcome, version, dir, now]);
  const versions = Array.from(new Set(engine.signals.map((s) => s.modelVersion)));

  const exportData = (kind: "csv" | "json") => {
    const rows = engine.signals;
    let blob: Blob;
    if (kind === "json") blob = new Blob([JSON.stringify({ signals: rows, reports: engine.reports }, null, 2)], { type: "application/json" });
    else {
      const head = ["signal_id", "published_at", "model_version", "direction", "order_type", "entry", "stop_loss", "tp1", "tp2", "tp3", "rr", "wcs", "status", "r_multiple", "primary_cause"];
      const lines = rows.map((s) =>
        [s.id, new Date(s.publishedAt).toISOString(), s.modelVersion, s.dir, s.type, s.entry, s.sl, ...s.tps, s.rr, s.wcs, s.status, s.rMultiple ?? "", engine.reports[s.id]?.primaryCause ?? ""].join(","),
      );
      blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `aurum-signals.${kind}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex border border-line">
          {(["active", "history"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cn("px-4 py-2 text-[13px]", tab === t ? "bg-gold text-ink font-semibold" : "text-cream/80 hover:text-cream")}>
              {t === "active" ? `Активные (${active.length})` : `История (${engine.signals.length - active.length})`}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <button onClick={() => exportData("csv")} className="border border-line px-3 py-2 font-mono text-[11px] text-taupe hover:text-gold">
            ⤓ CSV
          </button>
          <button onClick={() => exportData("json")} className="border border-line px-3 py-2 font-mono text-[11px] text-taupe hover:text-gold">
            ⤓ JSON
          </button>
        </div>
      </div>

      {tab === "active" ? (
        active.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {active.map((s) => (
              <SignalCard key={s.id} s={s} />
            ))}
          </div>
        ) : (
          <Empty>Активных сигналов нет. ИИ публикует сетап только при WCS ≥ 70, R:R ≥ 1:2 и отсутствии вето — следите за Dashboard.</Empty>
        )
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-[12px]">
            <Select value={String(period)} onChange={(v) => setPeriod(Number(v))} options={[["0", "Весь период"], ["7", "7 дней"], ["14", "14 дней"], ["30", "30 дней"]]} />
            <Select value={outcome} onChange={(v) => setOutcome(v as Outcome)} options={[["all", "Любой исход"], ["win", "Win (≥ TP1)"], ["loss", "Loss (SL)"], ["neutral", "Expired / Cancelled"]]} />
            <Select value={dir} onChange={(v) => setDir(v as "all")} options={[["all", "Long + Short"], ["long", "Long"], ["short", "Short"]]} />
            <Select value={version} onChange={setVersion} options={[["all", "Все версии"], ...versions.map((v) => [v, `v${v}`] as [string, string])]} />
          </div>
          {history.length ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {history.map((s) => (
                <SignalCard key={s.id} s={s} />
              ))}
            </div>
          ) : (
            <Empty>Нет сигналов под выбранные фильтры</Empty>
          )}
        </>
      )}
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="border border-line bg-ink px-3 py-2 text-cream outline-none focus:border-gold">
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

export function SignalDetail() {
  const { id } = useParams();
  const { engine, candles, settings, now } = useEngine();
  const s = engine.signals.find((x) => x.id === id);
  const rep = s ? engine.reports[s.id] : undefined;

  const chartCandles = useMemo(() => {
    if (!s || !candles) return [];
    const from = s.publishedAt - 60 * TF_MS.M15;
    const to = (s.closedAt ?? now) + 24 * TF_MS.M15;
    return candles.M15.filter((c) => c.t >= from && c.t <= to);
  }, [s, candles, now]);

  if (!s) return <Empty>Сигнал {id} не найден. <Link to="/signals" className="text-gold">← к списку</Link></Empty>;
  const R = Math.abs(s.entry - s.sl);
  const riskUsd = (settings.accountSize * settings.riskPct) / 100;
  const lots = riskUsd / (R * 100);

  return (
    <div className="space-y-4">
      <Link to="/signals" className="font-mono text-[12px] text-taupe hover:text-gold">
        ← Сигналы
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <DirBadge dir={s.dir} />
        <h1 className="font-mono text-xl font-semibold text-cream">
          {orderLabel(s)} {fmt(s.entry)}
        </h1>
        <StatusBadge status={s.status} />
        <span className="font-mono text-[12px] text-taupe">
          {s.id} · v{s.modelVersion} · {fmtTime(s.publishedAt)}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Panel className="lg:col-span-8" title="График M15 · Entry / SL / TP">
          <div className="-mx-2">
            {chartCandles.length > 5 ? <PriceChart candles={chartCandles} signal={s} height={360} /> : <Empty>Свечи за период сигнала вне загруженной истории</Empty>}
          </div>
        </Panel>

        <div className="space-y-4 lg:col-span-4">
          <Panel title="Параметры">
            <table className="w-full font-mono text-[13px]">
              <tbody>
                {[
                  ["Entry", s.entry, "text-gold", ""],
                  ["Stop Loss", s.sl, "text-bear", `−$${fmt(R)} (${fmt((R / s.entry) * 100)}%)`],
                  ...s.tps.map((tp, i) => [`TP${i + 1}`, tp, "text-bull", `+$${fmt(Math.abs(tp - s.entry))} · R:R 1:${(Math.abs(tp - s.entry) / R).toFixed(1)}`] as const),
                ].map(([k, v, cls, note]) => (
                  <tr key={k as string} className="border-b border-line/60 last:border-0">
                    <td className="py-1.5 text-taupe">{k}</td>
                    <td className={cn("py-1.5", cls as string)}>{fmt(v as number)}</td>
                    <td className="py-1.5 text-right text-[11px] text-taupe">{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 text-[12px] text-taupe">
              {SETUP_LABEL[s.type]} · {SETUP_STRATEGY[s.type]} · TTL до {fmtTime(s.expiresAt)}
            </div>
          </Panel>

          <Panel title="Риск">
            <div className="space-y-1 text-[13px]">
              <div className="flex justify-between">
                <span className="text-taupe">Риск на сделку</span>
                <span className="font-mono text-cream">
                  {settings.riskPct}% = ${fmt(riskUsd, 0)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-taupe">Объём (1 lot = 100 oz)</span>
                <span className="font-mono text-gold">{lots.toFixed(2)} lot</span>
              </div>
              <div className="flex justify-between">
                <span className="text-taupe">Размер стопа</span>
                <span className="font-mono text-cream">${fmt(R)}</span>
              </div>
              <p className="pt-2 text-[11.5px] text-taupe">
                Рекомендация: не более 1% счёта на сделку. На TP1 — закрыть 50% и перенести стоп в безубыток; TP2 — 30%; TP3 — остаток 20%. Счёт и риск — в настройках.
              </p>
            </div>
          </Panel>
        </div>

        <Panel className="lg:col-span-6" title={`Confluence · WCS ${s.wcs}`}>
          <div className="space-y-2.5">
            {s.confluences.map((c) => (
              <div key={c.factor} className="text-[12.5px]">
                <div className="flex justify-between gap-3">
                  <span className="text-cream">{c.label}</span>
                  <span className="shrink-0 font-mono text-taupe">
                    {c.weight.toFixed(2)} × {c.score.toFixed(2)} = <span className="text-gold">{(c.weight * c.score).toFixed(3)}</span>
                  </span>
                </div>
                <div className="mt-1">
                  <Bar value={c.score} />
                </div>
              </div>
            ))}
            {(Object.keys(s.available) as (keyof typeof s.available)[])
              .filter((f) => !s.available[f])
              .map((f) => (
                <div key={f} className="text-[11.5px] text-taupe">
                  {FACTOR_LABEL[f]}: данных нет — вес перенормирован
                </div>
              ))}
          </div>
        </Panel>

        <Panel className="lg:col-span-6" title="Обоснование" right={s.rationaleBy}>
          <p className="whitespace-pre-line text-[14px] leading-relaxed text-cream/90">{s.rationale}</p>
          <div className="mt-4 grid grid-cols-2 gap-2 font-mono text-[11px] text-taupe">
            <div>Тренды: {Object.entries(s.snapshot.trend).map(([k, v]) => `${k} ${v === "up" ? "↑" : v === "down" ? "↓" : "↔"}`).join(" ")}</div>
            <div>Сессия: {SESSION_LABEL[s.snapshot.session]}</div>
            <div>ATR H1: {fmt(s.snapshot.atrH1)} (p{Math.round(s.snapshot.atrPercentileH1 * 100)})</div>
            <div>До high-impact: {s.snapshot.minutesToHighImpact != null ? countdown(s.snapshot.minutesToHighImpact * 60_000) : "—"}</div>
          </div>
        </Panel>

        <Panel className="lg:col-span-5" title="Таймлайн">
          <ol className="relative space-y-3 border-l border-line pl-4">
            {s.timeline.map((ev, i) => (
              <li key={i} className="text-[13px]">
                <span className={cn("absolute -left-[5px] mt-1.5 h-2.5 w-2.5", ev.event === "sl" ? "bg-bear" : ev.event.startsWith("tp") || ev.event === "be" ? "bg-bull" : "bg-gold")} />
                <div className="text-cream">{EVENT_RU[ev.event] ?? ev.event}</div>
                <div className="font-mono text-[11px] text-taupe">
                  {fmtTime(ev.at)}
                  {ev.price != null && ` · ${fmt(ev.price)}`}
                  {ev.note && ` · ${ev.note}`}
                </div>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel className="lg:col-span-7" title="Post-Trade Analysis" right={rep ? rep.by : ""}>
          {rep ? (
            <div className="space-y-3 text-[13px]">
              <div className="flex flex-wrap items-center gap-3">
                <span className={cn("font-mono text-lg font-semibold", rep.rMultiple > 0 ? "text-bull" : rep.rMultiple < 0 ? "text-bear" : "text-cream")}>
                  {rep.rMultiple > 0 ? "+" : ""}
                  {rep.rMultiple.toFixed(2)}R
                </span>
                <span className="border border-line px-2 py-0.5 font-mono text-[11px] text-gold">{rep.primaryCause}</span>
                <span className="text-cream">{CAUSE_LABEL[rep.primaryCause]}</span>
                <span className="ml-auto font-mono text-[11px] text-taupe">confidence {rep.confidence.toFixed(2)}</span>
              </div>
              <div>
                <div className="micro-label mb-1">Улики</div>
                <ul className="space-y-1">
                  {rep.evidence.map((x, i) => (
                    <li key={i} className="flex gap-2 text-cream/90">
                      <span className="text-gold">·</span>
                      {x}
                    </li>
                  ))}
                </ul>
              </div>
              {rep.counterfactual && (
                <div>
                  <div className="micro-label mb-1">Контрфактический сценарий</div>
                  <p className="text-cream/90">{rep.counterfactual}</p>
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                {rep.lessonTags.map((t) => (
                  <span key={t} className="border border-line px-2 py-0.5 font-mono text-[10.5px] text-taupe">
                    #{t}
                  </span>
                ))}
              </div>
              {rep.weightChanges.length > 0 && (
                <div>
                  <div className="micro-label mb-1">Изменение весов после сделки</div>
                  <div className="font-mono text-[12px]">
                    {rep.weightChanges.map((w) => (
                      <div key={w.factor}>
                        {w.factor}: {w.from.toFixed(3)} → <span className={w.to > w.from ? "text-bull" : "text-bear"}>{w.to.toFixed(3)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Empty>{isOpen(s) ? "Разбор будет опубликован после закрытия сделки" : s.status === "expired" ? "EXPIRED — разбор не строится, учитывается только в статистике" : "Разбор недоступен"}</Empty>
          )}
        </Panel>
      </div>
    </div>
  );
}
