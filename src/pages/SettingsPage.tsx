import { useState } from "react";
import { toast } from "sonner";
import { useEngine } from "@/app/store";
import { Panel } from "@/app/ui";
import { EVENT_LABELS, type Priority } from "@/app/settings";
import { llmChat } from "@/engine/llm";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/60 py-3 last:border-0">
      <div className="min-w-0">
        <div className="text-[14px] text-cream">{label}</div>
        {hint && <div className="text-[12px] text-taupe">{hint}</div>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

const input = "border border-line bg-ink px-3 py-2 font-mono text-[13px] text-cream outline-none focus:border-gold";

export default function SettingsPage() {
  const { settings, setSettings, resetModel, engine, source } = useEngine();
  const [testing, setTesting] = useState(false);
  const perm = typeof Notification !== "undefined" ? Notification.permission : "unsupported";

  const togglePush = async (on: boolean) => {
    if (on && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      const p = await Notification.requestPermission();
      if (p !== "granted") {
        toast("Уведомления запрещены браузером", { description: "Разрешите уведомления для сайта в настройках браузера." });
        return;
      }
    }
    setSettings({ pushEnabled: on });
    if (on) new Notification("AURUM·AI", { body: "Push-уведомления включены. Сигналы будут приходить до точки входа." });
  };

  const testLlm = async () => {
    setTesting(true);
    try {
      const r = await llmChat(settings.llm, "Ответь одним словом.", "Скажи: работает");
      toast("LLM отвечает", { description: r.slice(0, 120) });
    } catch (e) {
      toast("Ошибка LLM", { description: String(e) });
    } finally {
      setTesting(false);
    }
  };

  const exportAll = () => {
    const blob = new Blob([JSON.stringify(engine, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "aurum-engine-state.json";
    a.click();
  };

  return (
    <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-2">
      <Panel title="Push-уведомления" className="lg:col-span-1">
        <Row label="Уведомления браузера" hint={perm === "unsupported" ? "браузер не поддерживает" : `разрешение: ${perm}`}>
          <Switch checked={settings.pushEnabled} onCheckedChange={(v) => void togglePush(v)} disabled={perm === "unsupported"} />
        </Row>
        <Row label="Тихие часы" hint="TP/SL складываются в утренний дайджест; high-priority проходят">
          <Switch checked={settings.quietEnabled} onCheckedChange={(v) => setSettings({ quietEnabled: v })} />
        </Row>
        {settings.quietEnabled && (
          <Row label="Интервал тихих часов" hint="локальное время">
            <select className={input} value={settings.quietFrom} onChange={(e) => setSettings({ quietFrom: +e.target.value })}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
            <span className="text-taupe">—</span>
            <select className={input} value={settings.quietTo} onChange={(e) => setSettings({ quietTo: +e.target.value })}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </Row>
        )}
        <Row label="Лимит push в день" hint="rate-limiting, по умолчанию 8">
          <input type="number" min={1} max={50} className={cn(input, "w-20")} value={settings.dailyCap} onChange={(e) => setSettings({ dailyCap: Math.max(1, +e.target.value || 1) })} />
        </Row>
        <Row label="Минимальный приоритет">
          <div className="flex border border-line">
            {(["low", "normal", "high"] as Priority[]).map((p) => (
              <button key={p} onClick={() => setSettings({ minPriority: p })} className={cn("px-3 py-1.5 font-mono text-[11px]", settings.minPriority === p ? "bg-gold text-ink" : "text-taupe")}>
                {p}
              </button>
            ))}
          </div>
        </Row>
        <div className="mt-2 micro-label">События</div>
        {Object.entries(EVENT_LABELS).map(([k, l]) => (
          <Row key={k} label={l} hint={k}>
            <Switch checked={settings.events[k] !== false} onCheckedChange={(v) => setSettings({ events: { ...settings.events, [k]: v } })} />
          </Row>
        ))}
      </Panel>

      <div className="space-y-4">
        <Panel title="Риск-профиль отображения">
          <Row label="Размер счёта, $" hint="для расчёта объёма в карточке сигнала">
            <input type="number" min={100} className={cn(input, "w-32")} value={settings.accountSize} onChange={(e) => setSettings({ accountSize: Math.max(0, +e.target.value || 0) })} />
          </Row>
          <Row label="Риск на сделку, %" hint="рекомендация — не более 1%">
            <input type="number" min={0.1} max={5} step={0.1} className={cn(input, "w-24")} value={settings.riskPct} onChange={(e) => setSettings({ riskPct: Math.max(0.1, +e.target.value || 1) })} />
          </Row>
        </Panel>

        <Panel title="Источник данных">
          <Row label="Котировки" hint={`сейчас: ${source === "binance" ? "Binance PAXG/USDT (live)" : "демо-рынок"}`}>
            <div className="flex border border-line">
              {(["auto", "demo"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => {
                    setSettings({ dataSource: d });
                    setTimeout(() => window.location.reload(), 100);
                  }}
                  className={cn("px-3 py-1.5 font-mono text-[11px]", settings.dataSource === d ? "bg-gold text-ink" : "text-taupe")}
                >
                  {d === "auto" ? "live" : "демо"}
                </button>
              ))}
            </div>
          </Row>
          <p className="pt-2 text-[12px] text-taupe">
            Live: Binance (api.binance.com → data-api.binance.vision), календарь ForexFactory, заголовки GDELT. Если источник недоступен, приложение честно переключается в демо и
            показывает это.
          </p>
        </Panel>

        <Panel title="LLM (опционально)">
          <p className="mb-2 text-[12px] text-taupe">
            Узкие роли по ТЗ: текст обоснования, sanity-check кандидата, классификация заголовков, post-trade рефлексия. Параметры сигнала LLM не меняет. Любой OpenAI-совместимый API
            (OpenRouter, Groq и др.). Ключ хранится только в вашем браузере.
          </p>
          <Row label="Включить LLM">
            <Switch checked={settings.llm.enabled} onCheckedChange={(v) => setSettings({ llm: { ...settings.llm, enabled: v } })} />
          </Row>
          <div className="space-y-2 py-2">
            <input className={cn(input, "w-full")} placeholder="Base URL" value={settings.llm.baseUrl} onChange={(e) => setSettings({ llm: { ...settings.llm, baseUrl: e.target.value } })} />
            <input className={cn(input, "w-full")} placeholder="Model" value={settings.llm.model} onChange={(e) => setSettings({ llm: { ...settings.llm, model: e.target.value } })} />
            <input className={cn(input, "w-full")} type="password" placeholder="API key" value={settings.llm.apiKey} onChange={(e) => setSettings({ llm: { ...settings.llm, apiKey: e.target.value } })} />
            <button onClick={() => void testLlm()} disabled={!settings.llm.apiKey || testing} className="border border-line px-3 py-2 text-[12px] text-cream hover:border-gold disabled:opacity-40">
              {testing ? "Проверка…" : "Проверить подключение"}
            </button>
          </div>
        </Panel>

        <Panel title="Данные модели">
          <Row label="Экспорт состояния" hint="сигналы, разборы, версии весов, журнал">
            <button onClick={exportAll} className="border border-line px-3 py-2 text-[12px] text-cream hover:border-gold">
              ⤓ JSON
            </button>
          </Row>
          <Row label="Сбросить модель" hint="веса → v0.1.0, история пересчитывается walk-forward">
            <button
              onClick={() => {
                if (confirm("Сбросить веса и историю сигналов? Бэктест будет пересчитан.")) resetModel();
              }}
              className="border border-bear/60 px-3 py-2 text-[12px] text-bear hover:bg-bear/10"
            >
              Сбросить
            </button>
          </Row>
        </Panel>
      </div>
    </div>
  );
}
