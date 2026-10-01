import { Section, Sub, CodeBlock, Callout, DataTable } from "@/lib/doc";

export function DataSchemas() {
  return (
    <Section
      id="data-schemas"
      num="05"
      title="Схемы данных"
      lead="PostgreSQL 16 + TimescaleDB. Принципы: котировки — append-only hypertable; сигналы и их события — неизменяемый журнал (история никогда не переписывается); веса и модели — версионируются; каждая рефлексия ссылается на конкретную сделку и версию модели."
    >
      <Sub id="ddl" title="DDL основных таблиц">
        <CodeBlock title="schema.sql (ядро)" lang="sql">
{`-- ── Котировки: hypertable ─────────────────────────────
CREATE TABLE ohlcv (
  ts        timestamptz      NOT NULL,
  tf        text             NOT NULL,  -- 'M1','M15','H1','H4','D1'
  open      numeric(10,2)    NOT NULL,
  high      numeric(10,2)    NOT NULL,
  low       numeric(10,2)    NOT NULL,
  close     numeric(10,2)    NOT NULL,
  tick_vol  integer,
  source    text             NOT NULL,  -- провайдер-источник
  PRIMARY KEY (ts, tf)
);
SELECT create_hypertable('ohlcv', 'ts');

-- ── Уровни SnR/SMC ────────────────────────────────────
CREATE TABLE levels (
  level_id     text PRIMARY KEY,
  timeframe    text NOT NULL,
  kind         text NOT NULL,      -- swing|order_block|fvg|liquidity_pool
  direction    text NOT NULL,      -- demand|supply
  zone_low     numeric(10,2) NOT NULL,
  zone_high    numeric(10,2) NOT NULL,
  strength     real NOT NULL,      -- 0..1
  touches      int  NOT NULL DEFAULT 1,
  formed_at    timestamptz NOT NULL,
  last_test_at timestamptz,
  mitigated    boolean NOT NULL DEFAULT false,
  meta         jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX ON levels (timeframe, mitigated);

-- ── Новости и календарь ───────────────────────────────
CREATE TABLE news_events (
  id           bigserial PRIMARY KEY,
  event_at     timestamptz NOT NULL,
  currency     text NOT NULL,
  impact       text NOT NULL,      -- high|medium|low
  title        text NOT NULL,
  actual       numeric, forecast numeric, previous numeric,
  surprise     numeric GENERATED ALWAYS AS
               ((actual - forecast) / nullif(abs(forecast),0)) STORED,
  blackout     tstzrange NOT NULL,
  source       text NOT NULL
);
CREATE INDEX ON news_events USING gist (blackout);

-- ── Сигналы ───────────────────────────────────────────
CREATE TABLE signals (
  signal_id    text PRIMARY KEY,        -- sig_YYYYMMDD_NNN
  published_at timestamptz NOT NULL DEFAULT now(),
  model_version text NOT NULL REFERENCES model_versions(version),
  direction    text NOT NULL,           -- long|short
  order_type   text NOT NULL,           -- limit|stop|market_on_trigger
  entry        numeric(10,2) NOT NULL,
  stop_loss    numeric(10,2) NOT NULL,
  tp1 numeric(10,2) NOT NULL,
  tp2 numeric(10,2) NOT NULL,
  tp3 numeric(10,2) NOT NULL,
  rr_planned   numeric(4,2) NOT NULL CHECK (rr_planned >= 2.0),
  wcs          int NOT NULL CHECK (wcs >= 70),
  wcs_breakdown jsonb NOT NULL,
  confluences  jsonb NOT NULL,          -- список факторов с весами
  rationale    text NOT NULL,           -- LLM-обоснование
  context_snapshot jsonb NOT NULL,      -- слепок для обучения
  status       text NOT NULL DEFAULT 'pending',
  expires_at   timestamptz NOT NULL     -- TTL 12ч
);

-- ── События сигнала (append-only журнал) ──────────────
CREATE TABLE signal_events (
  id         bigserial PRIMARY KEY,
  signal_id  text NOT NULL REFERENCES signals(signal_id),
  event      text NOT NULL,  -- published|approaching|activated|
                             -- tp1|tp2|tp3|sl|expired|cancelled
  price      numeric(10,2),
  at         timestamptz NOT NULL DEFAULT now(),
  note       text
);

-- ── Разборы сделок (база ошибок) ──────────────────────
CREATE TABLE post_trade_reports (
  signal_id    text PRIMARY KEY REFERENCES signals(signal_id),
  outcome      text NOT NULL,
  r_multiple   numeric(5,2) NOT NULL,   -- фактический результат в R
  primary_cause text NOT NULL,          -- таксономия раздела 04
  evidence     jsonb NOT NULL,
  counterfactual text,
  lesson_tags  text[] NOT NULL,
  llm_model    text NOT NULL,           -- какая модель писала разбор
  confidence   real NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── Веса стратегий (версионирование) ──────────────────
CREATE TABLE strategy_weights (
  version      text NOT NULL,
  factor       text NOT NULL,
  weight       real NOT NULL CHECK (weight BETWEEN 0.02 AND 0.40),
  regime       text NOT NULL DEFAULT 'all',  -- all|low_vol|mid_vol|high_vol
  changed_by   text NOT NULL,           -- online_loop|manual|rollback
  reason_signal_ids text[],             -- сделки-основание
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (version, factor, regime)
);

-- ── Версии моделей ────────────────────────────────────
CREATE TABLE model_versions (
  version      text PRIMARY KEY,        -- semver: 0.9.3
  weights_ver  text NOT NULL,
  ml_model_uri text,                    -- lightgbm artifact
  lora_uri     text,                    -- адаптер LLM
  status       text NOT NULL,           -- shadow|live|rolled_back
  metrics      jsonb NOT NULL,          -- win_rate, pf, auc, calibration
  activated_at timestamptz
);

-- ── Push-подписки ─────────────────────────────────────
CREATE TABLE devices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  push_token   text NOT NULL UNIQUE,
  platform     text NOT NULL,           -- android|ios|web
  quiet_hours  int4range NOT NULL DEFAULT int4range(23,7),
  daily_cap    int NOT NULL DEFAULT 8,
  min_priority text NOT NULL DEFAULT 'low',
  created_at   timestamptz NOT NULL DEFAULT now()
);`}
        </CodeBlock>
      </Sub>

      <Sub id="json-signal" title="JSON сигнала (API → клиент)">
        <CodeBlock title="GET /api/v1/signals/active" lang="json">
{`{
  "signal_id": "sig_20261001_003",
  "symbol": "XAUUSD",
  "published_at": "2026-10-01T09:15:00Z",
  "model_version": "0.9.3",
  "direction": "long",
  "order_type": "limit",
  "prices": {
    "entry": 2398.50,
    "stop_loss": 2391.00,
    "take_profits": [
      { "id": "tp1", "price": 2406.00, "rr": 1.0, "action": "close 50%, SL → breakeven" },
      { "id": "tp2", "price": 2413.50, "rr": 2.0, "action": "close 30%" },
      { "id": "tp3", "price": 2421.00, "rr": 3.0, "action": "close 20%" }
    ]
  },
  "risk": {
    "stop_distance_usd": 7.50,
    "rr_to_tp2": 2.0,
    "suggested_risk_pct": 1.0
  },
  "wcs": 78,
  "confluences": [
    { "factor": "H4 order block 2386–2390", "weight": 0.25, "score": 0.82 },
    { "factor": "Liquidity sweep M15 (Asia low)", "weight": 0.20, "score": 0.90 },
    { "factor": "BOS H1 вверх", "weight": 0.15, "score": 1.00 },
    { "factor": "Bullish engulfing в зоне", "weight": 0.10, "score": 0.70 },
    { "factor": "RSI divergence H1", "weight": 0.10, "score": 0.60 },
    { "factor": "Сентимент новостей +0.35", "weight": 0.10, "score": 0.35 }
  ],
  "rationale": "Цена вернулась в H4 order block после захвата ликвидности под лоями Азии; структура H1 сломана вверх. Вход лимитом от верхней границы зоны, стоп за экстремумом sweep. Сценарий отменяется закрытием H1 ниже 2386.",
  "status": "pending",
  "expires_at": "2026-10-01T21:15:00Z",
  "timeline": [
    { "event": "published", "at": "2026-10-01T09:15:00Z" },
    { "event": "approaching", "at": "2026-10-01T11:40:00Z", "price": 2401.8 }
  ]
}`}
        </CodeBlock>
      </Sub>

      <Sub id="json-report" title="JSON разбора сделки (Post-Trade Analysis)">
        <CodeBlock title="GET /api/v1/signals/{id}/report" lang="json">
{`{
  "signal_id": "sig_20260928_002",
  "outcome": "sl",
  "r_multiple": -1.0,
  "primary_cause": "FALSE_BREAKOUT",
  "evidence": [
    "M15 14:15–14:30: прокол 2402.1 на 0.6·ATR с закрытием обратно в диапазон",
    "Свеча активации не имела подтверждения engulfing — вход по limit без подтверждения"
  ],
  "counterfactual": "При требовании закрытия M15 выше зоны вход бы не состоялся; аналогичные сетапы с подтверждением в сентябре: 4 из 5 достигли TP1",
  "lesson_tags": ["false_breakout", "no_confirmation", "london_open"],
  "weight_changes": [
    { "factor": "sweep_m15", "from": 0.20, "to": 0.193 },
    { "factor": "pattern_in_zone", "from": 0.10, "to": 0.104 }
  ],
  "llm_model": "qwen3-32b (groq)",
  "confidence": 0.78,
  "created_at": "2026-09-28T16:02:11Z"
}`}
        </CodeBlock>
      </Sub>

      <Sub id="state-machine" title="Машина состояний сигнала">
        <CodeBlock title="Переходы статусов" lang="fsm">
{`                 WCS≥70, вето нет
                       │
                       ▼
                ┌────────────┐   цена ≤ 0.3% до зоны
                │  PENDING   │ ─────────────────────────┐
                └─────┬──────┘                          ▼
        TTL 12ч       │                          (событие approaching,
        или CHoCH     │ касание entry                   без смены статуса)
              │       ▼
              │  ┌────────────┐
              │  │   ACTIVE   │──────────────► TP1 ──► TP2 ──► TP3 (WIN)
              │  └─────┬──────┘
              │        │
              │        └─────────────────────► SL (LOSS)
              ▼
        ┌──────────────┐      структура сломана до активации
        │   EXPIRED    │  ◄── или ┌────────────┐
        └──────────────┘          │ CANCELLED  │ (с обязательной причиной)
                                  └────────────┘

Терминальные состояния: TP3 | SL | EXPIRED | CANCELLED
→ триггерят Post-Trade Analysis (кроме EXPIRED — только статистика)
→ запись в signal_events неизменяема (append-only)`}
        </CodeBlock>
        <DataTable
          title="Учёт исходов в статистике"
          head={["Исход", "В win rate", "В equity", "Комментарий"]}
          rows={[
            ["TP3 / TP2 (финал)", "win", "+R фактический", "Частичные фиксации учитываются взвешенно"],
            ["SL", "loss", "−1R", "Обязательный разбор"],
            ["EXPIRED", "не считается", "0", "Метрика «доля дошедших до входа» — отдельно"],
            ["CANCELLED", "не считается", "0", "Считается плюсом к дисциплине, показывается в истории"],
          ]}
        />
        <Callout kind="note" title="Консервативное правило спорных свечей">
          Если по M1-данным free-провайдера невозможно установить, что коснулись раньше — TP или SL
          (грубый ряд, пропуски), фиксируется худший исход. Статистика системы должна занижать, а не
          завышать результат — иначе весь Self-Correction Loop обучается на вранье.
        </Callout>
      </Sub>
    </Section>
  );
}
