import type { CalendarEvent } from "./types";

/* US Eastern time → UTC (DST: 2nd Sunday of March .. 1st Sunday of November) */
function nthWeekday(year: number, month: number, weekday: number, n: number) {
  const first = new Date(Date.UTC(year, month, 1));
  const shift = (weekday - first.getUTCDay() + 7) % 7;
  return 1 + shift + (n - 1) * 7;
}
function isUsDst(year: number, month: number, day: number) {
  const start = Date.UTC(year, 2, nthWeekday(year, 2, 0, 2));
  const end = Date.UTC(year, 10, nthWeekday(year, 10, 0, 1));
  const t = Date.UTC(year, month, day);
  return t >= start && t < end;
}
function et(year: number, month: number, day: number, hh: number, mm: number) {
  const off = isUsDst(year, month, day) ? 4 : 5;
  return Date.UTC(year, month, day, hh + off, mm);
}

const FOMC: string[] = [
  "2025-01-29", "2025-03-19", "2025-05-07", "2025-06-18", "2025-07-30", "2025-09-17", "2025-10-29", "2025-12-10",
  "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17", "2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09",
  "2027-01-27", "2027-03-17", "2027-04-28", "2027-06-16", "2027-07-28", "2027-09-22", "2027-11-03", "2027-12-15",
];

/** Approximate recurring USD macro schedule — used when the live calendar feed is unavailable. */
export function generatedCalendar(from: number, to: number): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  const d0 = new Date(from - 40 * 86_400_000);
  const d1 = new Date(to + 40 * 86_400_000);
  for (let y = d0.getUTCFullYear(); y <= d1.getUTCFullYear(); y++) {
    for (let m = 0; m < 12; m++) {
      const add = (day: number, hh: number, mm: number, title: string, impact: CalendarEvent["impact"]) =>
        out.push({ id: `gen_${y}_${m}_${day}_${title}`, at: et(y, m, day, hh, mm), title, currency: "USD", impact });
      add(nthWeekday(y, m, 5, 1), 8, 30, "Non-Farm Payrolls", "high");
      add(nthWeekday(y, m, 5, 1), 8, 30, "Unemployment Rate", "high");
      const cpi = nthWeekday(y, m, 3, 2);
      add(cpi, 8, 30, "CPI m/m", "high");
      add(cpi + 1, 8, 30, "PPI m/m", "medium");
      add(nthWeekday(y, m, 2, 3), 8, 30, "Retail Sales m/m", "medium");
      let ism = 1;
      while ([0, 6].includes(new Date(Date.UTC(y, m, ism)).getUTCDay())) ism++;
      add(ism, 10, 0, "ISM Manufacturing PMI", "medium");
      const lastFri = nthWeekday(y, m, 5, 4) + 7 <= new Date(Date.UTC(y, m + 1, 0)).getUTCDate() ? nthWeekday(y, m, 5, 5) : nthWeekday(y, m, 5, 4);
      add(lastFri, 8, 30, "Core PCE Price Index m/m", "medium");
      for (let w = 1; w <= 5; w++) {
        const day = nthWeekday(y, m, 4, w);
        if (day <= new Date(Date.UTC(y, m + 1, 0)).getUTCDate()) add(day, 8, 30, "Unemployment Claims", "medium");
      }
    }
  }
  for (const s of FOMC) {
    const [y, m, d] = s.split("-").map(Number);
    out.push({ id: `fomc_${s}`, at: et(y, m - 1, d, 14, 0), title: "FOMC Statement / Rate Decision", currency: "USD", impact: "high" });
  }
  return out.filter((e) => e.at >= from - 86_400_000 && e.at <= to + 30 * 86_400_000).sort((a, b) => a.at - b.at);
}

export function blackoutMs(e: CalendarEvent) {
  return e.impact === "high" ? 30 * 60_000 : e.impact === "medium" ? 15 * 60_000 : 0;
}

export function activeBlackout(events: CalendarEvent[], t: number): CalendarEvent | null {
  for (const e of events) {
    const w = blackoutMs(e);
    if (w && t >= e.at - w && t <= e.at + w) return e;
  }
  return null;
}

export function nextHighImpact(events: CalendarEvent[], t: number): CalendarEvent | null {
  return events.find((e) => e.impact === "high" && e.at > t) ?? null;
}

/** Live ForexFactory weekly feed (USD, high/medium). Throws if unreachable (CORS / network). */
export async function fetchLiveCalendar(): Promise<CalendarEvent[]> {
  const r = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", { cache: "no-store" });
  if (!r.ok) throw new Error(`calendar ${r.status}`);
  const j = (await r.json()) as { title: string; country: string; date: string; impact: string; forecast?: string; previous?: string; actual?: string }[];
  return j
    .filter((e) => e.country === "USD" && (e.impact === "High" || e.impact === "Medium"))
    .map((e) => ({
      id: `ff_${e.date}_${e.title}`,
      at: new Date(e.date).getTime(),
      title: e.title,
      currency: "USD",
      impact: e.impact === "High" ? "high" : "medium",
      forecast: e.forecast || undefined,
      previous: e.previous || undefined,
      actual: e.actual || undefined,
    }))
    .sort((a, b) => a.at - b.at) as CalendarEvent[];
}
