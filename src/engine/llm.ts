export interface LlmConfig {
  baseUrl: string; // OpenAI-compatible, e.g. https://openrouter.ai/api/v1
  apiKey: string;
  model: string;
}

export async function llmChat(cfg: LlmConfig, system: string, user: string, json = false): Promise<string> {
  const r = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!r.ok) throw new Error(`LLM HTTP ${r.status}`);
  const j = await r.json();
  const text: string = j?.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("LLM empty response");
  return text;
}

export async function llmJson<T>(cfg: LlmConfig, p: { system: string; user: string }): Promise<T> {
  const text = await llmChat(cfg, p.system, p.user, true);
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("LLM: no JSON");
  return JSON.parse(m[0]) as T;
}
