# AURUM·AI — ИИ-аналитик золота (XAUUSD)

Сайт: **https://dalerk5.github.io/Trading/** · проектная документация — вкладка «ТЗ» (`#/docs`).

## Архитектура

```
GitHub Actions (cron, каждые 5 мин)          GitHub Pages (сайт)
┌──────────────────────────────┐            ┌─────────────────────────┐
│ scripts/runner.ts            │  data/     │ React-приложение         │
│ · котировки XAUUSD           │ public.json│ · читает общий снимок    │
│ · движки SnR/SMC, TA, новости│ ─────────▶ │ · live-цена XAU (15 сек) │
│ · WCS → сигналы → трекинг    │            │ · уведомления во вкладке │
│ · разборы + самообучение     │            └─────────────────────────┘
│ · Telegram-алерты            │ ─────────▶  Telegram (24/7)
└──────────────────────────────┘
```

- **Одна история для всех**: состояние движка хранится в ветке `data` (`state.json` + `public.json`), сайт читает `public.json`.
- **Котировки XAUUSD**: с ключом Twelve Data — настоящие свечи XAU/USD. Без ключа — свечи PAXG, скорректированные на базис к споту XAU/USD Swissquote; выходные удалены, как на спот-рынке. Live-цена на сайте — XAU спот (gold-api.com).
- **Движки** (`src/engine`): фракталы + кластеризация уровней, order blocks, FVG, liquidity sweep, BOS/CHoCH, паттерны, RSI-дивергенции, Volume Profile, ATR, календарь ForexFactory, сантимент GDELT. WCS ≥ 70, R:R ≥ 1:2, вето-правила, конечный автомат сигнала, Post-Trade Analysis, обновление весов (EG + shadow-проверка), circuit breaker.

## Настройка (Settings → Secrets and variables → Actions)

| Имя | Тип | Зачем |
|---|---|---|
| `TWELVEDATA_API_KEY` | Secret | Настоящие свечи XAU/USD (бесплатный ключ на twelvedata.com) |
| `TELEGRAM_BOT_TOKEN` | Secret | Токен бота от @BotFather |
| `TELEGRAM_CHAT_ID` | Secret | ID канала/чата, например `@my_gold_signals` |
| `TELEGRAM_PUBLIC_URL` | Variable | Ссылка на канал для кнопки на сайте, `https://t.me/my_gold_signals` |
| `LLM_API_KEY` | Secret | (опц.) OpenAI-совместимый ключ для текстов обоснований и разборов |
| `LLM_BASE_URL`, `LLM_MODEL` | Variable | (опц.) по умолчанию OpenRouter / `qwen/qwen3-32b:free` |

После изменения секретов: Actions → «AI engine» → **Run workflow**.

## Разработка

```bash
npm install
npm run dev            # сайт на http://localhost:3000
npm run engine:demo    # серверный движок на синтетическом рынке → data-out/
npm run build
```

> Не является инвестиционной рекомендацией. Торговля золотом сопряжена с высоким риском.
