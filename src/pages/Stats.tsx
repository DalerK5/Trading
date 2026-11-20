import { useMemo } from "react";
import { Link } from "react-router";
import { Area, AreaChart, Bar as RBar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis} from "recharts";
import { useEngine } from "@/app/store";
import { Bar, Empty, fmtTime, Kpi, Panel } from "@/app/ui";
import { FACTORS, FACTOR_LABEL, INITIAL_WEIGHTS, SETUP_LABEL, SETUP_STRATEGY, SESSION_LABEL, type SetupType, type Session, type Signal } from "@/engine/types";
import { cn } from "@/lib/utils";

const isTrade = (s: Signal) => s.status === "sl" || (s.maxTp >= 1 && ["tp3", "be", "sl"].includes(s.status));
const tip = { contentStyle: { background: "#151515", border: "1px solid #2c261d", fontSize: 12, fontFamily: "IBM Plex Mono" }, labelStyle: { color: "#988575" } };

export default function Stats() {
  const { engine, liftBlock, rollback, now } = useEngine();
  const trades = useMemo(() => engine.signals.filter(isTrade).sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0)), [engine.signals]);

  const k = useMemo(() => {
    const wins = trades.filter((s) => s.maxTp >= 1);
    const rs = trades.map((s) => s.rMultiple ?? 0);
    const gp = rs.filter((r) => r > 0).reduce((a, b) => a + b, 0);
    const gl = -rs.filter((r) => r < 0).reduce((a, b) => a + b, 0);
    let eq = 0;
    let peak = 0;
    let dd = 0;
    for (const r of rs) {
      eq += r;
      peak = Math.max(peak, eq);
      dd = Math.max(dd, peak - eq);
    }
    const lead = engine.signals
      .filter((s) => s.activatedAt && s.type !== "market_trigger")
      .map((s) => (s.activatedAt! - s.publishedAt) / 60_000)
      .sort((a, b) => a - b);
    const nonMarket = engine.signals.filter((s) => s.type !== "market_trigger" && !["pending"].includes(s.status));
    return {
      wr: trades.length ? wins.length / trades.length : null,
      avgR: trades.length ? rs.reduce((a, b) => a + b, 0) / trades.length : null,
      pf: gl > 0 ? gp / gl : gp > 0 ? Infinity : null,
      dd,
      total: rs.reduce((a, b) => a + b, 0),
      lead: lead.length ? lead[Math.floor(lead.length / 2)] : null,
      fillRate: nonMarket.length ? nonMarket.filter((s) => s.activatedAt).length / nonMarket.length : null,
      cancelled: engine.signals.filter((s) => s.status === "cancelled").length,
      expired: engine.signals.filter((s) => s.status === "expired").length,
    };
  }, [trades, engine.signals]);

  const equity = useMemo(() => {
    let eq = 0;
    const pts = [{ i: 0, t: trades[0]?.publishedAt ?? 0, eq: 0, id: "start", v: "" }];
    trades.forEach((s, i) => {
      eq += s.rMultiple ?? 0;
      pts.push({ i: i + 1, t: s.closedAt ?? 0, eq: Math.round(eq * 100) / 100, id: s.id, v: s.modelVersion });
    });
    return pts;
  }, [trades]);
  const versionMarks = useMemo(() => {
    const out: { i: number; v: string }[] = [];
    for (let i = 1; i < equity.length; i++) if (equity[i].v !== equity[i - 1].v && equity[i - 1].v) out.push({ i: equity[i].i, v: equity[i].v });
    return out;
  }, [equity]);

  const byType = useMemo(() => {
    const types: SetupType[] = ["limit_zone", "stop_breakout", "market_trigger"];
    return types.map((t) => {
      const tr = trades.filter((s) => s.type === t);
      const w = tr.filter((s) => s.maxTp >= 1).length;
      const sum = tr.reduce((a, s) => a + (s.rMultiple ?? 0), 0);
      return { t, n: tr.length, wr: tr.length ? w / tr.length : null, avg: tr.length ? sum / tr.length : null, sum };
    });
  }, [trades]);

  const heat = useMemo(() => {
    const days = ["Пн", "Вт", "Ср", "Чт", "Пт"];
    const sessions: Session[] = ["asia", "london", "newyork", "off"];
    const grid = days.map((_, d) =>
      sessions.map((ss) => {
        const tr = trades.filter((s) => (new Date(s.publishedAt).getUTCDay() + 6) % 7 === d && s.snapshot.session === ss);
        return { n: tr.length, r: tr.reduce((a, s) => a + (s.rMultiple ?? 0), 0) };
      }),
    );
    return { days, sessions, grid };
  }, [trades]);

  const calib = useMemo(() => {
    const buckets = [
      [70, 75],
      [75, 80],
      [80, 85],
      [85, 101],
    ];
    return buckets.map(([a, b]) => {
      const tr = trades.filter((s) => s.wcs >= a && s.wcs < b);
      return { name: b > 100 ? `${a}+` : `${a}–${b}`, wr: tr.length ? Math.round((tr.filter((s) => s.maxTp >= 1).length / tr.length) * 100) : 0, n: tr.length, expected: Math.round((a + Math.min(b, 95)) / 2) };
    });
  }, [trades]);

  const journal = [...engine.journal].reverse();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold text-cream">Статистика ИИ — прозрачный трек-рекорд</h1>
        <span className="font-mono text-[12px] text-taupe">
          в эфире: <span className="text-gold">v{engine.version}</span> · {engine.source === "demo" ? "демо-рынок" : "Binance PAXG"} · walk-forward
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Win rate" value={k.wr == null ? "—" : `${Math.round(k.wr * 100)}%`} hint="≥ TP1, цель ≥ 55%" tone={k.wr != null ? (k.wr >= 0.55 ? "bull" : "bear") : undefined} />
        <Kpi label="Avg R" value={k.avgR == null ? "—" : k.avgR.toFixed(2)} hint="реализованный" tone={k.avgR != null ? (k.avgR > 0 ? "bull" : "bear") : undefined} />
        <Kpi label="Profit factor" value={k.pf == null ? "—" : k.pf === Infinity ? "∞" : k.pf.toFixed(2)} hint="цель ≥ 1.5" />
        <Kpi label="Итог" value={`${k.total >= 0 ? "+" : ""}${k.total.toFixed(1)}R`} tone={k.total >= 0 ? "bull" : "bear"} hint={`${trades.length} сделок`} />
        <Kpi label="Max DD" value={`${k.dd.toFixed(1)}R`} hint="цель ≤ 6R" tone={k.dd > 6 ? "bear" : undefined} />
        <Kpi label="Lead time" value={k.lead == null ? "—" : `${Math.round(k.lead)} мин`} hint="медиана до входа" />
        <Kpi label="Дошли до входа" value={k.fillRate == null ? "—" : `${Math.round(k.fillRate * 100)}%`} hint="limit/stop" />
        <Kpi label="Отмен / истекло" value={`${k.cancelled} / ${k.expired}`} hint="не в win rate" />
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Panel className="lg:col-span-8" title="Equity curve сигналов (R)" right="вертикали — версии модели">
          {trades.length ? (
            <div className="h-64">
              <ResponsiveContainer>
                <AreaChart data={equity} margin={{ left: -18, right: 8, top: 8 }}>
                  <defs>
                    <linearGradient id="eqg" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#d69900" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#d69900" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#2c261d" vertical={false} />
                  <XAxis dataKey="i" tick={{ fill: "#988575", fontSize: 11 }} stroke="#2c261d" />
                  <YAxis tick={{ fill: "#988575", fontSize: 11 }} stroke="#2c261d" />
                  <ReferenceLine y={0} stroke="#988575" strokeDasharray="3 3" />
                  {versionMarks.map((m) => (
                    <ReferenceLine key={m.i} x={m.i} stroke="#d69900" strokeOpacity={0.5} label={{ value: `v${m.v}`, fill: "#d69900", fontSize: 10, position: "insideTopLeft" }} />
                  ))}
                  <Tooltip {...tip} formatter={(v: number) => [`${v}R`, "equity"]} labelFormatter={(i: number) => equity[i]?.id ?? ""} />
                  <Area type="stepAfter" dataKey="eq" stroke="#d69900" fill="url(#eqg)" strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty>Закрытых сделок пока нет</Empty>
          )}
        </Panel>

        <Panel className="lg:col-span-4" title="Калибровка: WCS vs факт. win rate">
          {trades.length ? (
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={calib} margin={{ left: -18, right: 8, top: 8 }}>
                  <CartesianGrid stroke="#2c261d" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: "#988575", fontSize: 11 }} stroke="#2c261d" />
                  <YAxis domain={[0, 100]} tick={{ fill: "#988575", fontSize: 11 }} stroke="#2c261d" />
                  <Tooltip {...tip} formatter={(v: number, n: string) => [`${v}%`, n === "wr" ? "факт" : "заявлено"]} />
                  <RBar dataKey="expected" fill="#2c261d" />
                  <RBar dataKey="wr" fill="#d69900" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty>Нет данных</Empty>
          )}
          <p className="mt-2 text-[11.5px] text-taupe">Серые — заявленный уровень уверенности (середина корзины WCS), золотые — фактический win rate. Совпадение = модели можно доверять.</p>
        </Panel>

        <Panel className="lg:col-span-6" title="Распад по стратегиям">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] text-taupe">
                <th className="py-1 font-normal">Сетап</th>
                <th className="py-1 font-normal">Сделок</th>
                <th className="py-1 font-normal">Win rate</th>
                <th className="py-1 font-normal">Avg R</th>
                <th className="py-1 text-right font-normal">Σ R</th>
              </tr>
            </thead>
            <tbody>
              {byType.map((r) => (
                <tr key={r.t} className="border-t border-line/60">
                  <td className="py-2">
                    <div className="text-cream">{SETUP_LABEL[r.t]}</div>
                    <div className="text-[11px] text-taupe">{SETUP_STRATEGY[r.t]}</div>
                  </td>
                  <td className="font-mono">{r.n}</td>
                  <td className="font-mono">{r.wr == null ? "—" : `${Math.round(r.wr * 100)}%`}</td>
                  <td className="font-mono">{r.avg == null ? "—" : r.avg.toFixed(2)}</td>
                  <td className={cn("text-right font-mono", r.sum > 0 ? "text-bull" : r.sum < 0 ? "text-bear" : "")}>{r.sum.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel className="lg:col-span-6" title="Heatmap: день × сессия (Σ R)">
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-1 text-center font-mono text-[11px]">
              <thead>
                <tr>
                  <th />
                  {heat.sessions.map((s) => (
                    <th key={s} className="font-normal text-taupe">
                      {SESSION_LABEL[s]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heat.grid.map((row, d) => (
                  <tr key={d}>
                    <td className="pr-2 text-left text-taupe">{heat.days[d]}</td>
                    {row.map((c, j) => {
                      const a = Math.min(1, Math.abs(c.r) / 3);
                      return (
                        <td key={j} className="h-10 min-w-[64px]" style={{ background: c.n ? (c.r >= 0 ? `rgba(138,168,96,${0.12 + a * 0.6})` : `rgba(193,86,59,${0.12 + a * 0.6})`) : "#1b1916" }} title={`${c.n} сделок`}>
                          {c.n ? `${c.r > 0 ? "+" : ""}${c.r.toFixed(1)}` : "·"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel className="lg:col-span-5" title={`Веса факторов · v${engine.version}`} right="Σ = 1 · клиппинг 0.02–0.40">
          <div className="space-y-2.5">
            {FACTORS.map((f) => {
              const w = engine.weights[f];
              const d = w - INITIAL_WEIGHTS[f];
              return (
                <div key={f} className="text-[12.5px]">
                  <div className="flex justify-between">
                    <span className="text-cream">{FACTOR_LABEL[f]}</span>
                    <span className="font-mono">
                      {w.toFixed(3)}
                      <span className={cn("ml-2 text-[11px]", d > 0.0005 ? "text-bull" : d < -0.0005 ? "text-bear" : "text-taupe")}>
                        {d > 0 ? "+" : ""}
                        {d.toFixed(3)}
                      </span>
                    </span>
                  </div>
                  <div className="mt-1">
                    <Bar value={w} max={0.4} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4">
            <div className="micro-label mb-2">Версии модели</div>
            <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
              {[...engine.versions].reverse().map((v) => (
                <div key={v.version} className="flex items-center gap-2 font-mono text-[12px]">
                  <span className={v.status === "live" ? "text-gold" : "text-cream/80"}>v{v.version}</span>
                  <span className="text-[10.5px] text-taupe">{v.status}</span>
                  <span className="text-[10.5px] text-taupe">{v.activatedAt ? fmtTime(v.activatedAt) : ""}</span>
                  {v.status !== "live" && (
                    <button onClick={() => rollback(v.version)} className="ml-auto border border-line px-2 text-[10.5px] text-taupe hover:border-gold hover:text-gold">
                      откатить
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel className="lg:col-span-7" title="Журнал самообучения" right={`${engine.journal.length} записей`}>
          {engine.blocks.filter((b) => b.until == null || b.until > now).length > 0 && (
            <div className="mb-3 space-y-2">
              {engine.blocks.map((b, i) =>
                b.until == null || b.until > now ? (
                  <div key={i} className="flex flex-wrap items-center gap-2 border border-bear/50 bg-bear/10 px-3 py-2 text-[12.5px]">
                    <span className="text-cream">
                      Circuit breaker: «{SETUP_LABEL[b.type]}» — {b.reason}
                    </span>
                    <button onClick={() => liftBlock(i)} className="ml-auto border border-line px-2 py-0.5 text-[11px] text-cream hover:border-gold hover:text-gold">
                      ревью пройдено — снять
                    </button>
                  </div>
                ) : null,
              )}
            </div>
          )}
          <ol className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
            {journal.map((j) => (
              <li key={j.id} className="border-l-2 pl-3 text-[13px]" style={{ borderColor: j.kind === "version" ? "#d69900" : j.kind === "circuit_breaker" ? "#c1563b" : j.kind === "shadow_rejected" ? "#988575" : "#2c261d" }}>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium text-cream">{j.title}</span>
                  <span className="font-mono text-[10.5px] text-taupe">{fmtTime(j.at)}</span>
                </div>
                <p className="mt-0.5 text-[12.5px] text-cream/75">{j.details}</p>
                {j.signalIds.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {j.signalIds.map((id) => (
                      <Link key={id} to={`/signals/${id}`} className="border border-line px-1.5 font-mono text-[10.5px] text-taupe hover:text-gold">
                        {id}
                      </Link>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </Panel>

        <Panel className="lg:col-span-12" title="Журнал пропусков (WCS ≥ 70, но отклонено фильтром R:R)" right={`${engine.skipped.length}`}>
          {engine.skipped.length ? (
            <div className="max-h-56 overflow-y-auto">
              <table className="w-full font-mono text-[12px]">
                <tbody>
                  {[...engine.skipped].reverse().slice(0, 100).map((s, i) => (
                    <tr key={i} className="border-b border-line/50">
                      <td className="py-1 pr-3 text-taupe whitespace-nowrap">{fmtTime(s.at)}</td>
                      <td className={cn("pr-3", s.dir === "long" ? "text-bull" : "text-bear")}>{s.dir.toUpperCase()}</td>
                      <td className="pr-3 text-cream/80">{SETUP_LABEL[s.type]}</td>
                      <td className="pr-3 text-gold">WCS {s.wcs}</td>
                      <td className="text-taupe">{s.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>Пропусков нет</Empty>
          )}
        </Panel>
      </div>
    </div>
  );
}
