import { llmJson, type LlmConfig } from "./llm";

export interface Headline {
  title: string;
  url: string;
  source: string;
  at: number;
  label: "bullish" | "bearish" | "neutral";
  confidence: number;
}

const BULL = [
  "surge", "surges", "soar", "soars", "rally", "rallies", "jump", "jumps", "climb", "climbs", "record high", "all-time high",
  "safe haven", "safe-haven", "gains", "rises", "rise", "higher", "rebound", "rebounds", "boost", "bullish", "rate cut", "cuts rates",
  "dovish", "weaker dollar", "dollar falls", "dollar slips", "escalation", "tensions", "uncertainty", "inflation hedge", "buying",
];
const BEAR = [
  "fall", "falls", "drop", "drops", "slump", "slumps", "slide", "slides", "tumble", "tumbles", "plunge", "plunges", "lower",
  "losses", "retreat", "retreats", "decline", "declines", "bearish", "hawkish", "rate hike", "stronger dollar", "dollar gains",
  "dollar rises", "yields rise", "profit-taking", "selloff", "sell-off", "pressure", "ceasefire", "easing tensions",
];

export function lexiconClassify(title: string): { label: Headline["label"]; confidence: number } {
  const t = ` ${title.toLowerCase()} `;
  let b = 0;
  let s = 0;
  for (const w of BULL) if (t.includes(` ${w}`)) b++;
  for (const w of BEAR) if (t.includes(` ${w}`)) s++;
  if (b === s) return { label: "neutral", confidence: 0.4 };
  return { label: b > s ? "bullish" : "bearish", confidence: Math.min(0.9, 0.5 + 0.15 * Math.abs(b - s)) };
}

/** GDELT 2.1 DOC API — headlines about gold in the last 6 hours. */
export async function fetchHeadlines(): Promise<{ title: string; url: string; source: string; at: number }[]> {
  const q = encodeURIComponent('(gold OR XAUUSD OR bullion) sourcelang:english');
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=artlist&maxrecords=40&timespan=6h&format=json&sort=datedesc`;
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`gdelt ${r.status}`);
  const j = (await r.json()) as { articles?: { title: string; url: string; domain: string; seendate: string }[] };
  return (j.articles ?? [])
    .filter((a) => /gold|bullion|xau/i.test(a.title))
    .map((a) => {
      const s = a.seendate; // 20261120T101500Z
      const at = Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(9, 11), +s.slice(11, 13));
      return { title: a.title, url: a.url, source: a.domain, at };
    });
}

export async function classifyHeadlines(
  items: { title: string; url: string; source: string; at: number }[],
  llm: LlmConfig | null,
): Promise<{ headlines: Headline[]; by: string }> {
  if (llm && items.length) {
    try {
      const res = await llmJson<{ items: { i: number; label: Headline["label"]; confidence: number }[] }>(llm, {
        system:
          "Ты классификатор новостей для рынка золота (XAUUSD). Для каждого заголовка оцени влияние на цену золота в ближайшие часы. Верни СТРОГО JSON: {\"items\":[{\"i\":номер,\"label\":\"bullish|bearish|neutral\",\"confidence\":0..1}]}",
        user: items.map((h, i) => `${i}. ${h.title}`).join("\n"),
      });
      const map = new Map(res.items.map((x) => [x.i, x]));
      return {
        by: `LLM (${llm.model})`,
        headlines: items.map((h, i) => {
          const x = map.get(i);
          const lab = x && ["bullish", "bearish", "neutral"].includes(x.label) ? x.label : lexiconClassify(h.title).label;
          return { ...h, label: lab, confidence: x ? Math.max(0, Math.min(1, Number(x.confidence) || 0.5)) : 0.4 };
        }),
      };
    } catch {
      /* fall back to lexicon */
    }
  }
  return { by: "лексический классификатор", headlines: items.map((h) => ({ ...h, ...lexiconClassify(h.title) })) };
}

/** Exponentially weighted (6h) sentiment ∈ [-1, 1]. */
export function sentimentScore(h: Headline[], now: number): number | null {
  if (!h.length) return null;
  let num = 0;
  let den = 0;
  for (const x of h) {
    const age = Math.max(0, now - x.at) / 3_600_000;
    const w = Math.exp(-age / 3) * x.confidence;
    num += w * (x.label === "bullish" ? 1 : x.label === "bearish" ? -1 : 0);
    den += w;
  }
  return den ? Math.max(-1, Math.min(1, num / den)) : 0;
}
