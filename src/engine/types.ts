export type TF = "M15" | "H1" | "H4" | "D1";
export const TFS: TF[] = ["M15", "H1", "H4", "D1"];
export const TF_MS: Record<TF, number> = {
  M15: 15 * 60_000,
  H1: 60 * 60_000,
  H4: 4 * 60 * 60_000,
  D1: 24 * 60 * 60_000,
};
export const TF_WEIGHT: Record<TF, number> = { M15: 1, H1: 2, H4: 3, D1: 4 };

export interface Candle {
  t: number; // open time, ms UTC
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type CandleSet = Record<TF, Candle[]>;

export type Dir = "long" | "short";
export type Trend = "up" | "down" | "range";

export type LevelKind = "swing" | "order_block" | "fvg" | "liquidity_pool";

export interface Level {
  id: string;
  tf: TF;
  kind: LevelKind;
  direction: "demand" | "supply";
  low: number;
  high: number;
  strength: number; // 0..1
  touches: number;
  formedAt: number;
  lastTestAt: number | null;
  mitigated: boolean;
  confluences: string[];
}

export interface StructureInfo {
  trend: Trend;
  lastEvent: { type: "BOS" | "CHoCH"; dir: "up" | "down"; at: number; price: number } | null;
  swingHighs: { t: number; p: number; i: number }[];
  swingLows: { t: number; p: number; i: number }[];
}

export interface Sweep {
  tf: TF;
  dir: "bull" | "bear"; // bull = swept lows, expecting up
  at: number;
  level: number;
  extreme: number;
  score: number;
}

export interface PatternInfo {
  name: "engulfing" | "pin_bar" | "doji";
  dir: "bull" | "bear" | "neutral";
  quality: number;
  at: number;
}

export interface Divergence {
  tf: TF;
  dir: "bull" | "bear";
  strength: number;
  at: number;
}

export interface VolumeProfile {
  poc: number;
  vah: number;
  val: number;
  hvn: number[];
  lvn: number[];
  bins: { price: number; vol: number }[];
}

export interface CalendarEvent {
  id: string;
  at: number;
  title: string;
  currency: string;
  impact: "high" | "medium" | "low";
  forecast?: string;
  previous?: string;
  actual?: string;
}

export type FactorKey =
  | "zone"
  | "sweep"
  | "structure"
  | "pattern"
  | "rsi_div"
  | "sentiment"
  | "d1_trend"
  | "vp";

export const FACTOR_LABEL: Record<FactorKey, string> = {
  zone: "H4/D1 order block или swing-зона",
  sweep: "Liquidity sweep M15/H1",
  structure: "Market Structure (BOS)",
  pattern: "Свечной паттерн в зоне",
  rsi_div: "RSI divergence",
  sentiment: "Новостной сантимент",
  d1_trend: "Совпадение тренда D1",
  vp: "Volume Profile",
};

export const FACTORS: FactorKey[] = [
  "zone",
  "sweep",
  "structure",
  "pattern",
  "rsi_div",
  "sentiment",
  "d1_trend",
  "vp",
];

export type Weights = Record<FactorKey, number>;

export const INITIAL_WEIGHTS: Weights = {
  zone: 0.25,
  sweep: 0.2,
  structure: 0.15,
  pattern: 0.1,
  rsi_div: 0.1,
  sentiment: 0.1,
  d1_trend: 0.05,
  vp: 0.05,
};

export type SetupType = "limit_zone" | "stop_breakout" | "market_trigger";
export const SETUP_LABEL: Record<SetupType, string> = {
  limit_zone: "Limit от зоны",
  stop_breakout: "Stop на пробой",
  market_trigger: "Market-on-trigger",
};
export const SETUP_STRATEGY: Record<SetupType, string> = {
  limit_zone: "SnR / Order Block",
  stop_breakout: "Структура / пробой",
  market_trigger: "Liquidity sweep",
};

export interface Confluence {
  factor: FactorKey;
  label: string;
  weight: number;
  score: number;
}

export interface Analysis {
  at: number;
  price: number;
  atr: Record<TF, number>;
  atrPercentileH1: number;
  structure: Record<TF, StructureInfo>;
  levels: Level[];
  sweeps: Sweep[];
  pattern: PatternInfo | null;
  divergences: Divergence[];
  vp: VolumeProfile | null;
  sentiment: number | null;
  session: Session;
  bias: "bullish" | "bearish" | "neutral";
  wcsLong: number;
  wcsShort: number;
  best: Candidate | null;
  candidates: Candidate[];
  rejections: string[];
  blackout: CalendarEvent | null;
  nextHighImpact: CalendarEvent | null;
}

export type Session = "asia" | "london" | "newyork" | "off";
export const SESSION_LABEL: Record<Session, string> = {
  asia: "Азия",
  london: "Лондон",
  newyork: "Нью-Йорк",
  off: "Межсессия",
};

export interface Candidate {
  dir: Dir;
  type: SetupType;
  entry: number;
  sl: number;
  tps: [number, number, number];
  rr: number; // to TP3
  rrTp2: number;
  wcs: number;
  scores: Record<FactorKey, number>;
  available: Record<FactorKey, boolean>;
  confluences: Confluence[];
  zone: Level | null;
  vetoes: string[];
  notes: string[];
}

export type SignalStatus =
  | "pending"
  | "active"
  | "tp1"
  | "tp2"
  | "tp3"
  | "sl"
  | "be"
  | "expired"
  | "cancelled";

export const TERMINAL: SignalStatus[] = ["tp3", "sl", "be", "expired", "cancelled"];

export interface SignalEvent {
  event:
    | "published"
    | "approaching"
    | "activated"
    | "tp1"
    | "tp2"
    | "tp3"
    | "sl"
    | "be"
    | "expired"
    | "cancelled";
  at: number;
  price?: number;
  note?: string;
}

export interface Signal {
  id: string;
  publishedAt: number;
  modelVersion: string;
  dir: Dir;
  type: SetupType;
  entry: number;
  sl: number;
  tps: [number, number, number];
  rr: number;
  wcs: number;
  scores: Record<FactorKey, number>;
  available: Record<FactorKey, boolean>;
  confluences: Confluence[];
  rationale: string;
  rationaleBy: string;
  snapshot: Snapshot;
  status: SignalStatus;
  expiresAt: number;
  timeline: SignalEvent[];
  activatedAt?: number;
  closedAt?: number;
  rMultiple?: number;
  maxTp: 0 | 1 | 2 | 3;
  cancelReason?: string;
}

export interface Snapshot {
  wcs: number;
  trend: Record<TF, Trend>;
  atrH1: number;
  atrPercentileH1: number;
  session: Session;
  sentiment: number | null;
  minutesToHighImpact: number | null;
  spread: number;
  zoneAgeHours: number | null;
}

export type Cause =
  | "FALSE_BREAKOUT"
  | "NEWS_SPIKE"
  | "EARLY_ENTRY"
  | "WIDE_STOP"
  | "STRUCTURE_SHIFT"
  | "LEVEL_ERROR"
  | "NONE";

export const CAUSE_LABEL: Record<Cause, string> = {
  FALSE_BREAKOUT: "Ложный пробой уровня",
  NEWS_SPIKE: "Новостной импульс",
  EARLY_ENTRY: "Вход до подтверждения",
  WIDE_STOP: "Стоп вынесен волатильностью",
  STRUCTURE_SHIFT: "Смена структуры после входа",
  LEVEL_ERROR: "Уровень невалиден",
  NONE: "Ошибки нет",
};

export interface Report {
  signalId: string;
  outcome: SignalStatus;
  rMultiple: number;
  primaryCause: Cause;
  evidence: string[];
  counterfactual: string;
  lessonTags: string[];
  weightChanges: { factor: FactorKey; from: number; to: number }[];
  by: string;
  confidence: number;
  createdAt: number;
}

export interface JournalEntry {
  id: string;
  at: number;
  kind: "version" | "shadow_rejected" | "pending" | "circuit_breaker" | "info";
  version?: string;
  title: string;
  details: string;
  signalIds: string[];
  changes?: { factor: FactorKey; from: number; to: number }[];
}

export interface ModelVersion {
  version: string;
  weights: Weights;
  activatedAt: number;
  status: "live" | "retired" | "rolled_back";
}

export interface EngineState {
  schema: number;
  source: "binance" | "demo";
  lastTs: number; // last processed M15 close
  seq: number;
  weights: Weights;
  version: string;
  versions: ModelVersion[];
  signals: Signal[];
  reports: Record<string, Report>;
  journal: JournalEntry[];
  pendingRewards: Record<FactorKey, { r: number; id: string; at: number }[]>;
  blocks: { type: SetupType; until: number | null; reason: string; at: number }[];
  skipped: { at: number; dir: Dir; type: SetupType; wcs: number; reason: string }[];
}
