export type Priority = "high" | "normal" | "low";

export interface Settings {
  pushEnabled: boolean;
  events: Record<string, boolean>;
  quietFrom: number; // hour, local
  quietTo: number;
  quietEnabled: boolean;
  dailyCap: number;
  minPriority: Priority;
  accountSize: number;
  riskPct: number;
}

export const EVENT_LABELS: Record<string, string> = {
  "signal.published": "Новый сетап опубликован",
  "signal.approaching": "Цена подходит к зоне входа",
  "signal.activated": "Вход активирован",
  "signal.tp_hit": "Достигнут TP",
  "signal.sl_hit": "Стоп-лосс",
  "signal.be": "Закрытие в безубыток",
  "signal.cancelled": "Сетап отменён",
  "signal.expired": "Сетап истёк",
  "news.blackout": "Blackout перед новостями",
  "analysis.published": "Опубликован разбор сделки",
};

export const DEFAULT_SETTINGS: Settings = {
  pushEnabled: false,
  events: Object.fromEntries(Object.keys(EVENT_LABELS).map((k) => [k, k !== "signal.expired"])),
  quietFrom: 23,
  quietTo: 7,
  quietEnabled: true,
  dailyCap: 8,
  minPriority: "low",
  accountSize: 10000,
  riskPct: 1,
};

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* quota or private mode */
  }
}

export function loadSettings(): Settings {
  const s = loadJSON<Partial<Settings>>("aurum.settings", {});
  return { ...DEFAULT_SETTINGS, ...s, events: { ...DEFAULT_SETTINGS.events, ...(s.events ?? {}) } };
}
