import { toast } from "sonner";
import { useEngine } from "@/app/store";
import { ago, Panel } from "@/app/ui";
import { EVENT_LABELS, type Priority } from "@/app/settings";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

function Row({ label, hint, children }: { label: string; hint?: string; children?: React.ReactNode }) {
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
  const { settings, setSettings, engine, mode, provider, telegram, updatedAt, now } = useEngine();
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
    if (on) new Notification("AURUM·AI", { body: "Уведомления включены — пока вкладка открыта. Для уведомлений 24/7 подпишитесь на Telegram." });
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
      <div className="space-y-4">
        <Panel title="Telegram — сигналы 24/7">
          <p className="text-[13px] leading-relaxed text-cream/85">
            Сервер публикует каждый сетап, вход, TP/SL и разбор сделки в Telegram — уведомления приходят, даже когда сайт закрыт.
          </p>
          {telegram ? (
            <a href={telegram} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 bg-gold px-4 py-2.5 text-[13px] font-semibold text-ink hover:bg-gold/90">
              Подписаться в Telegram →
            </a>
          ) : (
            <p className="mt-3 text-[12px] text-taupe">Канал ещё не подключён администратором (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID в секретах репозитория).</p>
          )}
        </Panel>

        <Panel title="Уведомления в браузере">
          <Row label="Уведомления, пока сайт открыт" hint={perm === "unsupported" ? "браузер не поддерживает" : `разрешение: ${perm}`}>
            <Switch checked={settings.pushEnabled} onCheckedChange={(v) => void togglePush(v)} disabled={perm === "unsupported"} />
          </Row>
          <Row label="Тихие часы" hint="низкий приоритет откладывается в дайджест; новые сетапы проходят">
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
          <Row label="Лимит уведомлений в день">
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
            <Row key={k} label={l}>
              <Switch checked={settings.events[k] !== false} onCheckedChange={(v) => setSettings({ events: { ...settings.events, [k]: v } })} />
            </Row>
          ))}
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel title="Риск-профиль">
          <Row label="Размер счёта, $" hint="для расчёта объёма в карточке сигнала">
            <input type="number" min={100} className={cn(input, "w-32")} value={settings.accountSize} onChange={(e) => setSettings({ accountSize: Math.max(0, +e.target.value || 0) })} />
          </Row>
          <Row label="Риск на сделку, %" hint="рекомендация — не более 1%">
            <input type="number" min={0.1} max={5} step={0.1} className={cn(input, "w-24")} value={settings.riskPct} onChange={(e) => setSettings({ riskPct: Math.max(0.1, +e.target.value || 1) })} />
          </Row>
          <p className="pt-2 text-[12px] text-taupe">Риск-профиль хранится только в вашем браузере и влияет лишь на расчёт объёма (1 lot XAUUSD = 100 oz).</p>
        </Panel>

        <Panel title="Сервер и данные">
          <Row label="Режим" hint={mode === "shared" ? "общая история для всех пользователей" : "локальный демо-рынок"}>
            <span className={cn("font-mono text-[12px]", mode === "shared" ? "text-bull" : "text-gold")}>{mode === "shared" ? "SHARED" : "DEMO"}</span>
          </Row>
          <Row label="Источник котировок" hint={provider} />
          <Row label="Последний пересчёт сервера" hint={mode === "shared" ? ago(now - updatedAt) : "—"} />
          <Row label="Модель в эфире" hint={`v${engine.version} · ${engine.signals.length} сигналов в истории`} />
          <Row label="Экспорт состояния" hint="сигналы, разборы, версии весов, журнал">
            <button onClick={exportAll} className="border border-line px-3 py-2 text-[12px] text-cream hover:border-gold">
              ⤓ JSON
            </button>
          </Row>
        </Panel>
      </div>
    </div>
  );
}
