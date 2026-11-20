import type { PushEvent } from "./engine";
import type { Headline } from "./news";
import type { Analysis, CalendarEvent, CandleSet, EngineState } from "./types";

/** Public snapshot written by the server runner and read by every client. */
export interface Snapshot {
  schema: 1;
  updatedAt: number;
  symbol: string; // e.g. "XAUUSD"
  provider: string; // human readable data source
  price: number;
  prevClose: number | null;
  spread: number;
  quoteAt: number;
  candles: CandleSet;
  engine: EngineState;
  analysis: Analysis | null;
  calendar: CalendarEvent[];
  calendarSource: string;
  headlines: Headline[];
  sentiment: number | null;
  sentimentBy: string;
  feed: PushEvent[]; // recent notification events (newest last)
  telegram: string | null; // public channel/bot link
  runner: { intervalMin: number; lastRunMs: number; version: string };
}
