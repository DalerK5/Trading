export interface NavChild {
  id: string;
  label: string;
}

export interface NavItem {
  id: string;
  num: string;
  label: string;
  children: NavChild[];
}

export const NAV: NavItem[] = [
  {
    id: "obzor",
    num: "01",
    label: "Обзор и концепция",
    children: [
      { id: "missiya", label: "Миссия продукта" },
      { id: "printsipy", label: "Проектные принципы" },
      { id: "auditoriya", label: "Целевая аудитория" },
      { id: "kpi", label: "Метрики успеха" },
    ],
  },
  {
    id: "produkt",
    num: "02",
    label: "Продукт и UX/UI",
    children: [
      { id: "ia", label: "Информационная архитектура" },
      { id: "dashboard", label: "Главный экран (Dashboard)" },
      { id: "ekran-signalov", label: "Экран сигналов" },
      { id: "ekran-statistiki", label: "Статистика ИИ" },
      { id: "push", label: "Сценарии уведомлений" },
    ],
  },
  {
    id: "ai-arch",
    num: "03",
    label: "Архитектура ИИ-модуля",
    children: [
      { id: "pipeline", label: "Общий пайплайн" },
      { id: "data-layer", label: "Сбор и хранение данных" },
      { id: "snr", label: "Движок SnR / SMC" },
      { id: "ta-engine", label: "Движок технического анализа" },
      { id: "news-engine", label: "Новостной и фундаментальный движок" },
      { id: "wcs", label: "Weighted Confluence Score" },
      { id: "signal-gen", label: "Генератор сигналов" },
      { id: "llm-role", label: "Роль LLM" },
    ],
  },
  {
    id: "self-learning",
    num: "04",
    label: "Самообучение ИИ",
    children: [
      { id: "lifecycle", label: "Жизненный цикл сигнала" },
      { id: "post-trade", label: "Post-Trade Analysis" },
      { id: "loops", label: "Три контура обучения" },
      { id: "antioverfit", label: "Защита от переобучения" },
    ],
  },
  {
    id: "data-schemas",
    num: "05",
    label: "Схемы данных",
    children: [
      { id: "ddl", label: "DDL базы данных" },
      { id: "json-signal", label: "JSON сигнала" },
      { id: "json-report", label: "JSON разбора сделки" },
      { id: "state-machine", label: "Машина состояний" },
    ],
  },
  {
    id: "tech-stack",
    num: "06",
    label: "Техстек и инфраструктура",
    children: [
      { id: "backend", label: "Backend / Frontend" },
      { id: "quotes", label: "Источники котировок" },
      { id: "news-src", label: "Источники новостей" },
      { id: "llm-choice", label: "Выбор LLM и оптимизация расходов" },
      { id: "infra", label: "Бесплатная инфраструктура" },
      { id: "monetization", label: "Модель бесплатного доступа" },
    ],
  },
  {
    id: "roadmap",
    num: "07",
    label: "Дорожная карта",
    children: [
      { id: "phases", label: "Фазы разработки" },
      { id: "gantt", label: "Сводный план" },
      { id: "dod", label: "Критерии готовности" },
    ],
  },
  {
    id: "risks",
    num: "08",
    label: "Риски и комплаенс",
    children: [
      { id: "model-risk", label: "Реестр рисков" },
      { id: "compliance", label: "Юридические рамки" },
    ],
  },
];
