/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Dir, SignalStatus } from "@/engine/types";

export const fmt = (x: number | null | undefined, d = 2) =>
  x == null || !isFinite(x) ? "—" : x.toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d });

export const fmtTime = (t: number) => new Date(t).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
export const fmtHM = (t: number) => new Date(t).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

export function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} сек назад`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} мин назад`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} ч назад`;
  return `${Math.round(h / 24)} дн назад`;
}

export function countdown(ms: number) {
  if (ms <= 0) return "сейчас";
  const m = Math.floor(ms / 60_000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  if (d) return `${d}д ${String(h).padStart(2, "0")}ч`;
  if (h) return `${h}ч ${String(mm).padStart(2, "0")}м`;
  return `${mm} мин`;
}

export function Panel({ title, right, children, className }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("border border-line bg-raised/40", className)}>
      {(title || right) && (
        <header className="flex min-h-[40px] items-center justify-between gap-3 border-b border-line px-4 py-2">
          <h2 className="micro-label">{title}</h2>
          <div className="flex items-center gap-2 text-[11px] text-taupe font-mono">{right}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function DirBadge({ dir }: { dir: Dir }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wider", dir === "long" ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear")}>
      {dir === "long" ? "▲ LONG" : "▼ SHORT"}
    </span>
  );
}

const STATUS: Record<SignalStatus, { label: string; cls: string }> = {
  pending: { label: "PENDING", cls: "border-gold/50 text-gold" },
  active: { label: "ACTIVE", cls: "border-cream/50 text-cream" },
  tp1: { label: "TP1 ✓", cls: "border-bull/60 text-bull" },
  tp2: { label: "TP2 ✓", cls: "border-bull/60 text-bull" },
  tp3: { label: "TP3 · WIN", cls: "bg-bull/20 border-bull text-bull" },
  sl: { label: "SL · LOSS", cls: "bg-bear/15 border-bear text-bear" },
  be: { label: "BE · WIN", cls: "bg-bull/10 border-bull/60 text-bull" },
  expired: { label: "EXPIRED", cls: "border-line text-taupe" },
  cancelled: { label: "CANCELLED", cls: "border-line text-taupe line-through decoration-taupe/50" },
};

export function StatusBadge({ status }: { status: SignalStatus }) {
  const s = STATUS[status];
  return <span className={cn("inline-flex items-center border px-2 py-0.5 font-mono text-[10.5px] tracking-wider", s.cls)}>{s.label}</span>;
}

export function WcsGauge({ value, size = 92 }: { value: number; size?: number }) {
  const r = size / 2 - 7;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, value / 100));
  const color = value >= 70 ? "#d69900" : value >= 55 ? "#c9b48f" : "#988575";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#2c261d" strokeWidth="6" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth="6" fill="none" strokeDasharray={`${c * frac} ${c}`} />
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#fef1e8" strokeOpacity="0.5" strokeWidth="6" fill="none" strokeDasharray={`1.5 ${c}`} strokeDashoffset={-c * 0.7} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-[10px] text-taupe tracking-widest">WCS</span>
        <span className="font-mono text-2xl font-semibold text-cream leading-none">{value}</span>
      </div>
    </div>
  );
}

export function Bar({ value, max = 1, tone = "gold" }: { value: number; max?: number; tone?: "gold" | "bull" | "bear" | "cream" }) {
  const w = Math.max(0, Math.min(100, (value / max) * 100));
  const bg = { gold: "bg-gold", bull: "bg-bull", bear: "bg-bear", cream: "bg-cream/70" }[tone];
  return (
    <div className="h-1.5 w-full bg-line">
      <div className={cn("h-full", bg)} style={{ width: `${w}%` }} />
    </div>
  );
}

export function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "bull" | "bear" | "gold" }) {
  return (
    <div className="border border-line bg-raised/40 px-4 py-3">
      <div className="micro-label">{label}</div>
      <div className={cn("mt-1 font-mono text-2xl font-semibold", tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : tone === "gold" ? "text-gold" : "text-cream")}>{value}</div>
      {hint && <div className="mt-1 text-[12px] text-taupe">{hint}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="border border-dashed border-line px-4 py-8 text-center text-sm text-taupe">{children}</div>;
}
