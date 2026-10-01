import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ─── Section shell ─────────────────────────────────────────────── */

export function Section({
  id,
  num,
  title,
  lead,
  children,
}: {
  id: string;
  num: string;
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="border-b border-line scroll-mt-20">
      <div className="px-5 py-10 sm:px-8 lg:px-12 lg:py-14 max-w-[860px]">
        <div className="micro-label text-gold mb-3">РАЗДЕЛ {num}</div>
        <h2 className="font-sans text-[26px] sm:text-[34px] font-bold leading-[1.1] tracking-tight text-cream">
          {title}
        </h2>
        {lead && (
          <p className="mt-4 text-[15px] sm:text-base leading-relaxed text-taupe max-w-[68ch]">
            {lead}
          </p>
        )}
        <div className="mt-8 space-y-10">{children}</div>
      </div>
    </section>
  );
}

export function Sub({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div id={id} className="scroll-mt-24">
      <h3 className="flex items-baseline gap-3 text-[17px] sm:text-lg font-semibold text-cream mb-4">
        <span className="inline-block h-[9px] w-[9px] shrink-0 translate-y-[-1px] bg-gold" />
        {title}
      </h3>
      <div className="space-y-4 text-[14.5px] sm:text-[15px] leading-[1.75] text-cream/85">
        {children}
      </div>
    </div>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="max-w-[72ch]">{children}</p>;
}

export function Strong({ children }: { children: ReactNode }) {
  return <strong className="text-cream font-semibold">{children}</strong>;
}

export function InlineCode({ children }: { children: ReactNode }) {
  return (
    <code className="font-mono text-[0.86em] text-gold bg-raised border border-line px-1.5 py-0.5">
      {children}
    </code>
  );
}

/* ─── Lists ─────────────────────────────────────────────────────── */

export function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-2.5 max-w-[72ch]">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-[9px] h-px w-4 shrink-0 bg-gold" />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

/* ─── Code / diagram block ──────────────────────────────────────── */

export function CodeBlock({
  title,
  lang,
  children,
}: {
  title?: string;
  lang?: string;
  children: string;
}) {
  return (
    <figure className="border border-line bg-raised overflow-hidden">
      {(title || lang) && (
        <figcaption className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="micro-label">{title}</span>
          {lang && <span className="micro-label text-gold">{lang}</span>}
        </figcaption>
      )}
      <div className="overflow-x-auto">
        <pre className="p-4 font-mono text-[12px] sm:text-[12.5px] leading-[1.7] text-cream/90 whitespace-pre">
          {children}
        </pre>
      </div>
    </figure>
  );
}

/* ─── Data table ────────────────────────────────────────────────── */

export function DataTable({
  title,
  head,
  rows,
  firstColMono = true,
}: {
  title?: string;
  head: string[];
  rows: ReactNode[][];
  firstColMono?: boolean;
}) {
  return (
    <figure className="border border-line">
      {title && (
        <figcaption className="border-b border-line px-4 py-2.5 micro-label">
          {title}
        </figcaption>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-left text-[13px] sm:text-[13.5px]">
          <thead>
            <tr>
              {head.map((h, i) => (
                <th
                  key={i}
                  className="border-b border-line px-4 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-taupe font-medium whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="group">
                {r.map((c, j) => (
                  <td
                    key={j}
                    className={cn(
                      "border-b border-line/60 px-4 py-3 align-top leading-relaxed text-cream/85 group-last:border-b-0",
                      j === 0 && firstColMono && "font-mono text-[12.5px] text-cream whitespace-nowrap"
                    )}
                  >
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

/* ─── Callout ───────────────────────────────────────────────────── */

export function Callout({
  kind = "note",
  title,
  children,
}: {
  kind?: "note" | "warn" | "gold";
  title: string;
  children: ReactNode;
}) {
  const bar =
    kind === "warn" ? "bg-bear" : kind === "gold" ? "bg-gold" : "bg-taupe";
  return (
    <aside className="border border-line bg-raised flex">
      <span className={cn("w-[3px] shrink-0", bar)} />
      <div className="px-4 py-3.5">
        <div className="micro-label mb-1.5 text-cream">{title}</div>
        <div className="text-[13.5px] leading-relaxed text-cream/80 max-w-[68ch]">
          {children}
        </div>
      </div>
    </aside>
  );
}

/* ─── Formula ───────────────────────────────────────────────────── */

export function Formula({ children }: { children: string }) {
  return (
    <div className="border border-line bg-raised px-4 py-5 overflow-x-auto">
      <code className="font-mono text-[13px] sm:text-sm text-gold whitespace-pre">
        {children}
      </code>
    </div>
  );
}

/* ─── Chip / tag ────────────────────────────────────────────────── */

export function Chip({ children, tone = "taupe" }: { children: ReactNode; tone?: "taupe" | "gold" | "bull" | "bear" }) {
  const map = {
    taupe: "border-line text-taupe",
    gold: "border-gold/50 text-gold",
    bull: "border-bull/50 text-bull",
    bear: "border-bear/50 text-bear",
  };
  return (
    <span className={cn("inline-block border px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.12em]", map[tone])}>
      {children}
    </span>
  );
}
