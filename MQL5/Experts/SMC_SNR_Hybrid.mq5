//+------------------------------------------------------------------+
//|                                              SMC_SNR_Hybrid.mq5  |
//|        Гибрид: Smart Money Concepts + Malaysian SNR (A/V/GAP)    |
//+------------------------------------------------------------------+
//| Логика входа (BUY, для SELL — зеркально):                         |
//|  1. HTF (H4/D1): цена у Fresh V-уровня (поддержка)                |
//|  2. MTF (M15): снятие ликвидности (IDM / PDL / Asia Low / свинг)  |
//|  3. MTF (M15): касание необработанного бычьего OB с FVG           |
//|  4. LTF (M5/M1): бычий Quasimodo (L-H-LL-HH) + CHOCH              |
//|  -> Buy Limit на правое плечо QM (или верх LTF OB)                |
//| Выход: SL за экстремум QM, TP1 (50%) RR>=1:3, TP2 — HTF ликвидн.  |
//|        BE после IDM + BOS на LTF.                                 |
//+------------------------------------------------------------------+
#property copyright   "SMC + Malaysian SNR Hybrid EA"
#property version     "1.00"
#property description "Гибридный советник Smart Money Concepts + Malaysian SNR."
#property description "Вход только при совпадении HTF-уровня, снятия ликвидности,"
#property description "POI (OB+FVG) и паттерна Quasimodo с CHOCH на младшем ТФ."

#include <Trade\Trade.mqh>

//--- константы
#define LV_A     0
#define LV_V     1
#define LV_GAP   2

#define EV_BOS   0
#define EV_CHOCH 1
#define EV_IDM   2

#define PFX "SMCSNR_"

enum ENUM_ENTRY_MODE
  {
   ENTRY_QM_LEVEL = 0, // Правое плечо QM
   ENTRY_LTF_OB   = 1  // Граница LTF Order Block
  };

enum ENUM_SINGLE_TP
  {
   SINGLE_TP1 = 0, // Весь объём закрыть на TP1
   SINGLE_TP2 = 1  // Весь объём держать до TP2
  };

//+------------------------------------------------------------------+
//| Входные параметры                                                |
//+------------------------------------------------------------------+
input group "=== Таймфреймы ==="
input ENUM_TIMEFRAMES InpHTF1        = PERIOD_H4;   // HTF #1 (Storyline)
input ENUM_TIMEFRAMES InpHTF2        = PERIOD_D1;   // HTF #2 (Storyline)
input ENUM_TIMEFRAMES InpMTF         = PERIOD_M15;  // MTF (ликвидность, POI)
input ENUM_TIMEFRAMES InpLTF         = PERIOD_M5;   // LTF (QM + CHOCH, вход)

input group "=== Риск-менеджмент ==="
input double InpRiskPercent          = 1.0;   // Риск на сделку, % от баланса
input bool   InpAllowMinLot          = true;  // Разрешить мин. лот, если расчётный меньше
input double InpMaxRiskAtMinLot      = 5.0;   // Макс. риск при мин. лоте, %
input double InpMaxLot               = 0.0;   // Макс. лот (0 = без ограничения)
input double InpMaxDailyLossPct      = 3.0;   // Дневной лимит убытка, % (0 = выкл)
input int    InpMaxTradesPerDay      = 3;     // Макс. сделок в день (0 = без ограничения)
input double InpMinEquity            = 0.0;   // Стоп торговли, если эквити ниже (0 = выкл)

input group "=== Вход и сопровождение ==="
input ENUM_ENTRY_MODE InpEntryMode   = ENTRY_QM_LEVEL; // Точка входа
input double InpMinRR                = 3.0;   // Мин. RR для TP1
input bool   InpTP1Fallback          = true;  // Нет цели с RR>=Min -> TP1 = MinRR
input double InpTP2FallbackRR        = 5.0;   // Резервный TP2, RR
input double InpPartialPercent       = 50.0;  // Фиксация на TP1, % объёма
input ENUM_SINGLE_TP InpSingleLotTP  = SINGLE_TP1; // Если объём нельзя разделить
input int    InpSLBufferPoints       = 20;    // Буфер SL, пункты (+ спред)
input double InpMaxSLATR             = 3.0;   // Макс. SL в ATR(LTF) (0 = выкл)
input bool   InpBEOnLTFBOS           = true;  // BE после IDM + BOS на LTF
input bool   InpBEAfterTP1           = true;  // BE после фиксации TP1
input int    InpBEOffsetPoints       = 10;    // Отступ BE от цены входа, пункты
input int    InpPendingExpiryBars    = 12;    // Срок жизни лимитки, баров LTF
input int    InpQMMaxAgeBars         = 6;     // Макс. возраст CHOCH паттерна QM, баров LTF

input group "=== Фильтры стратегии (вкл/выкл) ==="
input bool   InpUseHTFContext        = true;  // 1. HTF: Fresh A/V уровень
input bool   InpUseSweep             = true;  // 2. MTF: снятие ликвидности
input bool   InpUsePOI               = true;  // 3. MTF: POI (OB + FVG)

input group "=== Параметры анализа ==="
input int    InpHTFBars              = 300;   // Баров HTF для анализа
input int    InpMTFBars              = 400;   // Баров MTF для анализа
input int    InpLTFBars              = 300;   // Баров LTF для анализа
input int    InpHTFTouchBars         = 3;     // Окно касания HTF-уровня, баров HTF
input double InpHTFZoneATR           = 0.25;  // Ширина зоны HTF-уровня, доля ATR
input bool   InpUseFlipped           = true;  // Учитывать уровни, сменившие роль (пробой телом)
input double InpGapMinATR            = 0.05;  // Мин. GAP-уровень, доля ATR
input int    InpMTFSwing             = 3;     // Сила свинга MTF (баров слева/справа)
input int    InpLTFSwing             = 2;     // Сила свинга LTF
input int    InpSweepLookback        = 16;    // Окно поиска снятия ликвидности, баров MTF
input int    InpPOITouchBars         = 12;    // Окно касания POI, баров MTF
input double InpOBMaxATR             = 2.5;   // Макс. высота OB, ATR
input double InpIFCBodyATR           = 1.8;   // IFC: тело свечи >= ATR * k

input group "=== Торговые сессии (время GMT) ==="
input bool   InpUseSessionFilter     = true;  // Торговать только в сессии
input bool   InpAutoGMT              = true;  // Авто-определение GMT-смещения (не в тестере)
input int    InpGMTOffset            = 2;     // Смещение сервера от GMT, ч (тестер / ручное)
input int    InpAsiaStartH           = 0;     // Азия: начало, ч GMT
input int    InpAsiaEndH             = 6;     // Азия: конец, ч GMT
input int    InpLondonStartH         = 7;     // London Sweep: начало, ч GMT
input int    InpLondonEndH           = 10;    // London Sweep: конец, ч GMT
input int    InpNYStartH             = 12;    // New York Open: начало, ч GMT
input int    InpNYEndH               = 16;    // New York Open: конец, ч GMT

input group "=== Защита: спред / новости / проскальзывание ==="
input int    InpMaxSpreadPoints      = 30;    // Макс. спред, пункты (0 = выкл)
input double InpSpreadSpikeMult      = 2.5;   // Спред > средний * k = блок (0 = выкл)
input int    InpMaxSlippagePoints    = 10;    // Макс. проскальзывание, пункты
input bool   InpUseNewsFilter        = true;  // Фильтр новостей (экон. календарь MT5)
input bool   InpNewsMediumToo        = false; // Учитывать и средние новости
input int    InpNewsBeforeMin        = 30;    // Пауза до новости, мин
input int    InpNewsAfterMin         = 30;    // Пауза после новости, мин
input double InpSpikeATRMult         = 3.0;   // Свеча LTF > ATR * k = новостной импульс (0 = выкл)
input int    InpSpikePauseMin        = 30;    // Пауза после импульса, мин
input bool   InpCancelPendingOnRisk  = true;  // Удалять лимитки при новостях/спреде

input group "=== Визуализация ==="
input bool   InpDraw                 = true;  // Рисовать разметку
input bool   InpShowPanel            = true;  // Информационная панель
input int    InpDrawMaxLevels        = 20;    // Макс. уровней A/V на HTF
input int    InpDrawMaxZones         = 12;    // Макс. зон OB/FVG
input int    InpDrawMaxEvents        = 20;    // Макс. меток BOS/CHOCH/IDM на ТФ
input color  InpClrSupport           = clrLimeGreen;   // Fresh поддержка (V)
input color  InpClrResist            = clrTomato;      // Fresh сопротивление (A)
input color  InpClrUnfresh           = clrDimGray;     // Unfresh уровень
input color  InpClrBullOB            = C'0,90,70';     // Бычий OB
input color  InpClrBearOB            = C'110,35,35';   // Медвежий OB
input color  InpClrFVG               = C'85,75,20';    // FVG
input color  InpClrEvents            = clrSilver;      // Метки BOS/CHOCH/IDM
input color  InpClrLiquidity         = clrDodgerBlue;  // PDH/PDL/Asia

input group "=== Прочее ==="
input long   InpMagic                = 250515; // Magic number

//+------------------------------------------------------------------+
//| Структуры                                                        |
//+------------------------------------------------------------------+
struct SNRLevel
  {
   double            price;
   datetime          time;
   int               kind;      // LV_A / LV_V / LV_GAP
   int               side0;     // начальная роль: +1 поддержка, -1 сопротивление
   int               sideCut;   // роль на момент cutoff (0 = уровень сформирован внутри окна)
   bool              freshCut;  // свежесть на момент cutoff
   int               side;      // роль сейчас
   bool              fresh;     // свежесть сейчас
  };

struct OBZone
  {
   int               dir;       // +1 бычий, -1 медвежий
   int               idx;       // индекс свечи OB
   datetime          time;
   double            top;
   double            bottom;
   double            fvgTop;
   double            fvgBottom;
   datetime          fvgTime;
   int               mitigIdx;  // первая митигация (-1 нет)
   int               invalidIdx;// закрытие за зоной (-1 нет)
  };

struct SwingPt
  {
   int               type;      // +1 high, -1 low
   double            price;
   datetime          time;
   int               idx;
   int               confirmIdx;
  };

struct StructEvent
  {
   int               type;      // EV_BOS / EV_CHOCH / EV_IDM
   int               dir;       // BOS/CHOCH: направление пробоя; IDM: сторона снятой ликвидности
   double            price;
   datetime          levelTime;
   datetime          breakTime;
  };

struct QMSetup
  {
   int               dir;
   double            shoulder;  // левое плечо = уровень QML (вход на правом плече)
   datetime          shoulderT;
   double            mid;       // H1 (для бычьего) — пробит CHOCH
   datetime          midT;
   double            ext;       // LL (для бычьего) — экстремум (за ним SL)
   datetime          extT;
   int               chochIdx;
   bool              hasOB;
   double            obHi;
   double            obLo;
  };

//+------------------------------------------------------------------+
//| Глобальные переменные                                            |
//+------------------------------------------------------------------+
CTrade      trade;

MqlRates    gH1[], gH2[], gM[], gL[];
SNRLevel    gLvH1[], gLvH2[], gLvM[];
OBZone      gObM[];
SwingPt     gSwM[], gSwL[];
StructEvent gEvM[], gEvL[];
int         gTrendM = 0, gTrendL = 0;

double      gPDH = 0, gPDL = 0, gPWH = 0, gPWL = 0;
double      gAsiaHigh = 0, gAsiaLow = 0;
datetime    gAsiaStartSrv = 0, gAsiaEndSrv = 0;

datetime    gBarH1 = 0, gBarH2 = 0, gBarM = 0, gBarL = 0;
datetime    gLastSetupT = 0;
int         gLastSetupDir = 0;

double      gAvgSpread = 0;
long        gSpreadTicks = 0;
datetime    gSpikeUntil = 0;
datetime    gNewsCheckT = 0;
bool        gNewsBlocked = false;
string      gNewsInfo = "";

string      gPanel[2];

//+------------------------------------------------------------------+
//| Утилиты                                                          |
//+------------------------------------------------------------------+
string TFName(ENUM_TIMEFRAMES tf)
  {
   return StringSubstr(EnumToString(tf), 7);
  }

double NP(double p)
  {
   double ts = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(ts <= 0)
      return NormalizeDouble(p, _Digits);
   return NormalizeDouble(MathRound(p / ts) * ts, _Digits);
  }

double VolStep()  { double s = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP); return s > 0 ? s : 0.01; }
double VolMin()   { return SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN); }
double VolMax()   { return SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX); }

double NormVolDown(double v)
  {
   double step = VolStep();
   int    vd   = (int)MathMax(0, MathCeil(-MathLog10(step) - 1e-9));
   return NormalizeDouble(MathFloor(v / step + 1e-9) * step, vd);
  }

double SpreadPoints()
  {
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   return (ask - bid) / _Point;
  }

double StopsDistance()
  {
   double s = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double f = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_FREEZE_LEVEL);
   return MathMax(s, f) * _Point;
  }

double CalcATR(const MqlRates &r[], int endIdx, int period)
  {
   double s = 0;
   int    c = 0;
   for(int i = endIdx; i > endIdx - period && i > 0; i--)
     {
      double tr = MathMax(r[i].high, r[i - 1].close) - MathMin(r[i].low, r[i - 1].close);
      s += tr;
      c++;
     }
   return c > 0 ? s / c : 0;
  }

int GMTOffsetHours()
  {
   if(InpAutoGMT && !MQLInfoInteger(MQL_TESTER))
     {
      long d = (long)(TimeTradeServer() - TimeGMT());
      return (int)MathRound(d / 3600.0);
     }
   return InpGMTOffset;
  }

string GVN(ulong ticket, string key)
  {
   return PFX + IntegerToString(InpMagic) + "_" + IntegerToString((long)ticket) + "_" + key;
  }

double GVGet(ulong ticket, string key, double def)
  {
   string n = GVN(ticket, key);
   if(!GlobalVariableCheck(n))
      return def;
   return GlobalVariableGet(n);
  }

void GVSet(ulong ticket, string key, double v)
  {
   GlobalVariableSet(GVN(ticket, key), v);
  }

bool LoadRates(ENUM_TIMEFRAMES tf, int count, MqlRates &r[])
  {
   ArraySetAsSeries(r, false);
   int got = CopyRates(_Symbol, tf, 0, count, r);
   return got >= 60;
  }

//+------------------------------------------------------------------+
//| MALAYSIAN SNR: A / V / GAP уровни и свежесть                      |
//+------------------------------------------------------------------+
void EvalLevel(SNRLevel &lv, const MqlRates &r[], int from, int cutoff, int lastClosed)
  {
   int  side  = lv.side0;
   bool fresh = true;
   lv.sideCut  = 0;
   lv.freshCut = false;
   for(int k = from; k <= lastClosed; k++)
     {
      if(k == cutoff + 1)
        {
         lv.sideCut  = side;
         lv.freshCut = fresh;
        }
      double bHi = MathMax(r[k].open, r[k].close);
      double bLo = MathMin(r[k].open, r[k].close);
      if(side < 0) // цена под уровнем (сопротивление)
        {
         if(bHi > lv.price)        { side = 1; fresh = true; }  // пробой телом -> снова Fresh, роль меняется
         else if(r[k].high >= lv.price) fresh = false;           // ретест тенью -> Unfresh
        }
      else         // цена над уровнем (поддержка)
        {
         if(bLo < lv.price)        { side = -1; fresh = true; }
         else if(r[k].low <= lv.price) fresh = false;
        }
     }
   if(from <= cutoff + 1 && cutoff >= lastClosed)
     {
      lv.sideCut  = side;
      lv.freshCut = fresh;
     }
   lv.side  = side;
   lv.fresh = fresh;
  }

void BuildSNR(const MqlRates &r[], int lastClosed, int cutoff, double gapMin, SNRLevel &out[])
  {
   ArrayResize(out, 0);
   for(int i = 0; i < lastClosed; i++)
     {
      int  j  = i + 1;
      bool bi = r[i].close > r[i].open, si = r[i].close < r[i].open;
      bool bj = r[j].close > r[j].open, sj = r[j].close < r[j].open;
      int    kind = -1, side = 0;
      double price = r[i].close;
      if(bi && sj)
        { kind = LV_A; side = -1; }                         // бычья + медвежья -> A-Shape
      else if(si && bj)
        { kind = LV_V; side = 1; }                          // медвежья + бычья -> V-Shape
      else if(gapMin > 0 && bi && bj && r[j].open - r[i].close >= gapMin)
        { kind = LV_GAP; side = 1; }                        // гэп вверх -> поддержка
      else if(gapMin > 0 && si && sj && r[i].close - r[j].open >= gapMin)
        { kind = LV_GAP; side = -1; }                       // гэп вниз -> сопротивление
      if(kind < 0)
         continue;

      SNRLevel lv;
      lv.price = price;
      lv.time  = r[i].time;
      lv.kind  = kind;
      lv.side0 = side;
      lv.side  = side;
      lv.fresh = true;
      EvalLevel(lv, r, j + 1, cutoff, lastClosed);
      int n = ArraySize(out);
      ArrayResize(out, n + 1, 256);
      out[n] = lv;
     }
  }

//+------------------------------------------------------------------+
//| SMC: свинги (без Inside Bars), структура BOS / CHOCH / IDM       |
//+------------------------------------------------------------------+
void AddSwing(SwingPt &sw[], int type, double price, datetime t, int idx, int conf)
  {
   int n = ArraySize(sw);
   if(n > 0 && sw[n - 1].type == type)
     {
      // подряд два одинаковых экстремума -> оставляем более экстремальный
      if((type == 1 && price > sw[n - 1].price) || (type == -1 && price < sw[n - 1].price))
        {
         sw[n - 1].price = price;
         sw[n - 1].time = t;
         sw[n - 1].idx = idx;
         sw[n - 1].confirmIdx = conf;
        }
      return;
     }
   ArrayResize(sw, n + 1, 128);
   sw[n].type = type;
   sw[n].price = price;
   sw[n].time = t;
   sw[n].idx = idx;
   sw[n].confirmIdx = conf;
  }

void BuildSwings(const MqlRates &r[], int lastClosed, int strength, SwingPt &sw[])
  {
   ArrayResize(sw, 0);
   int f[];
   ArrayResize(f, lastClosed + 1);
   int nf = 0, mother = -1;
   for(int i = 0; i <= lastClosed; i++)
     {
      // Inside Bar (внутри материнской свечи) — не учитывается в структуре
      if(mother >= 0 && r[i].high <= r[mother].high && r[i].low >= r[mother].low)
         continue;
      f[nf++] = i;
      mother = i;
     }
   for(int a = strength; a < nf - strength; a++)
     {
      int  i   = f[a];
      bool isH = true, isL = true;
      for(int b = 1; b <= strength; b++)
        {
         if(r[f[a - b]].high >= r[i].high) isH = false;
         if(r[f[a + b]].high >  r[i].high) isH = false;
         if(r[f[a - b]].low  <= r[i].low)  isL = false;
         if(r[f[a + b]].low  <  r[i].low)  isL = false;
        }
      int conf = f[a + strength];
      if(isH && isL)
        {
         if(r[i].close < r[i].open)
           { AddSwing(sw, 1, r[i].high, r[i].time, i, conf); AddSwing(sw, -1, r[i].low, r[i].time, i, conf); }
         else
           { AddSwing(sw, -1, r[i].low, r[i].time, i, conf); AddSwing(sw, 1, r[i].high, r[i].time, i, conf); }
        }
      else if(isH)
         AddSwing(sw, 1, r[i].high, r[i].time, i, conf);
      else if(isL)
         AddSwing(sw, -1, r[i].low, r[i].time, i, conf);
     }
  }

void AddEvent(StructEvent &ev[], int type, int dir, double price, datetime lt, datetime bt)
  {
   int n = ArraySize(ev);
   ArrayResize(ev, n + 1, 64);
   ev[n].type = type;
   ev[n].dir = dir;
   ev[n].price = price;
   ev[n].levelTime = lt;
   ev[n].breakTime = bt;
  }

// Последний подтверждённый откат (IDM) внутри текущей ноги
bool FindIDM(const SwingPt &sw[], int type, datetime fromT, datetime toT, int barIdx, double &p, datetime &t)
  {
   for(int k = ArraySize(sw) - 1; k >= 0; k--)
     {
      if(sw[k].confirmIdx > barIdx)
         continue;
      if(sw[k].time < fromT)
         break;
      if(sw[k].type != type || sw[k].time >= toT)
         continue;
      p = sw[k].price;
      t = sw[k].time;
      return true;
     }
   return false;
  }

// Машина состояний: BOS засчитывается только после снятия IDM
void RunStructure(const MqlRates &r[], int lastClosed, const SwingPt &sw[], StructEvent &ev[], int &trendOut)
  {
   ArrayResize(ev, 0);
   trendOut = 0;
   int start = 20;
   if(lastClosed < start + 5)
      return;

   double   sHigh = r[0].high, sLow = r[0].low;
   datetime sHighT = r[0].time, sLowT = r[0].time;
   for(int i = 1; i < start; i++)
     {
      if(r[i].high > sHigh) { sHigh = r[i].high; sHighT = r[i].time; }
      if(r[i].low  < sLow)  { sLow  = r[i].low;  sLowT  = r[i].time; }
     }

   int      trend = 0;
   double   cand = 0, pull = 0;
   datetime candT = 0, pullT = 0, legT = 0;
   bool     conf = false;

   for(int i = start; i <= lastClosed; i++)
     {
      double   h = r[i].high, l = r[i].low, c = r[i].close;
      datetime t = r[i].time;
      double   ip = 0;
      datetime it = 0;

      if(trend == 0)
        {
         if(c > sHigh)
           { trend = 1;  cand = h; candT = t; pull = DBL_MAX;  pullT = t; conf = false; legT = t; }
         else if(c < sLow)
           { trend = -1; cand = l; candT = t; pull = -DBL_MAX; pullT = t; conf = false; legT = t; }
         continue;
        }

      if(trend == 1)
        {
         if(c < sLow) // CHOCH вниз: закрытие под защищённым минимумом
           {
            AddEvent(ev, EV_CHOCH, -1, sLow, sLowT, t);
            sHigh  = conf ? sHigh  : cand;
            sHighT = conf ? sHighT : candT;
            trend = -1; cand = l; candT = t; pull = -DBL_MAX; pullT = t; conf = false; legT = t;
            continue;
           }
         if(!conf)
           {
            if(h > cand) { cand = h; candT = t; pull = DBL_MAX; pullT = t; }
            else if(l < pull) { pull = l; pullT = t; }
            if(FindIDM(sw, -1, legT, candT, i, ip, it) && l < ip)
              {
               AddEvent(ev, EV_IDM, -1, ip, it, t); // снята sell-side ликвидность (IDM)
               conf = true;
               sHigh = cand;
               sHighT = candT;
               if(l < pull) { pull = l; pullT = t; }
              }
           }
         else
           {
            if(l < pull) { pull = l; pullT = t; }
            if(c > sHigh) // BOS вверх (IDM уже снят)
              {
               AddEvent(ev, EV_BOS, 1, sHigh, sHighT, t);
               sLow = pull; sLowT = pullT;
               cand = h; candT = t; pull = DBL_MAX; pullT = t; conf = false; legT = t;
              }
           }
        }
      else // trend == -1
        {
         if(c > sHigh) // CHOCH вверх
           {
            AddEvent(ev, EV_CHOCH, 1, sHigh, sHighT, t);
            sLow  = conf ? sLow  : cand;
            sLowT = conf ? sLowT : candT;
            trend = 1; cand = h; candT = t; pull = DBL_MAX; pullT = t; conf = false; legT = t;
            continue;
           }
         if(!conf)
           {
            if(l < cand) { cand = l; candT = t; pull = -DBL_MAX; pullT = t; }
            else if(h > pull) { pull = h; pullT = t; }
            if(FindIDM(sw, 1, legT, candT, i, ip, it) && h > ip)
              {
               AddEvent(ev, EV_IDM, 1, ip, it, t); // снята buy-side ликвидность (IDM)
               conf = true;
               sLow = cand;
               sLowT = candT;
               if(h > pull) { pull = h; pullT = t; }
              }
           }
         else
           {
            if(h > pull) { pull = h; pullT = t; }
            if(c < sLow) // BOS вниз
              {
               AddEvent(ev, EV_BOS, -1, sLow, sLowT, t);
               sHigh = pull; sHighT = pullT;
               cand = l; candT = t; pull = -DBL_MAX; pullT = t; conf = false; legT = t;
              }
           }
        }
     }
   trendOut = trend;
  }

//+------------------------------------------------------------------+
//| SMC: Order Blocks с FVG                                          |
//+------------------------------------------------------------------+
void BuildOB(const MqlRates &r[], int lastClosed, double atr, OBZone &out[])
  {
   ArrayResize(out, 0);
   for(int i = 1; i <= lastClosed - 2; i++)
     {
      for(int d = 0; d < 2; d++)
        {
         int  dir = (d == 0) ? 1 : -1;
         bool opposite = (dir == 1) ? (r[i].close < r[i].open) : (r[i].close > r[i].open);
         if(!opposite)
            continue;

         int    fvgIdx = -1;
         double ft = 0, fb = 0;
         bool   imp1 = (dir == 1) ? (r[i + 1].close > r[i + 1].open) : (r[i + 1].close < r[i + 1].open);
         if(!imp1)
            continue;
         if(dir == 1)
           {
            if(r[i + 2].low > r[i].high)
              { fvgIdx = i + 1; fb = r[i].high; ft = r[i + 2].low; }
            else if(i + 3 <= lastClosed && r[i + 2].close > r[i + 2].open && r[i + 3].low > r[i + 1].high)
              { fvgIdx = i + 2; fb = r[i + 1].high; ft = r[i + 3].low; }
            if(fvgIdx < 0 || r[fvgIdx].close <= r[i].high)
               continue;
           }
         else
           {
            if(r[i + 2].high < r[i].low)
              { fvgIdx = i + 1; ft = r[i].low; fb = r[i + 2].high; }
            else if(i + 3 <= lastClosed && r[i + 2].close < r[i + 2].open && r[i + 3].high < r[i + 1].low)
              { fvgIdx = i + 2; ft = r[i + 1].low; fb = r[i + 3].high; }
            if(fvgIdx < 0 || r[fvgIdx].close >= r[i].low)
               continue;
           }

         double top = r[i].high, bottom = r[i].low;
         if(atr > 0 && (top - bottom) > InpOBMaxATR * atr)
            continue;

         OBZone z;
         z.dir = dir;
         z.idx = i;
         z.time = r[i].time;
         z.top = top;
         z.bottom = bottom;
         z.fvgTop = ft;
         z.fvgBottom = fb;
         z.fvgTime = r[fvgIdx].time;
         z.mitigIdx = -1;
         z.invalidIdx = -1;
         for(int k = fvgIdx + 2; k <= lastClosed; k++)
           {
            if(z.mitigIdx < 0)
              {
               if(dir == 1 && r[k].low <= z.top)     z.mitigIdx = k;
               if(dir == -1 && r[k].high >= z.bottom) z.mitigIdx = k;
              }
            if((dir == 1 && r[k].close < z.bottom) || (dir == -1 && r[k].close > z.top))
              { z.invalidIdx = k; break; }
           }
         int n = ArraySize(out);
         ArrayResize(out, n + 1, 64);
         out[n] = z;
        }
     }
  }

//+------------------------------------------------------------------+
//| Сессионная ликвидность: PDH/PDL, PWH/PWL, Asia High/Low          |
//+------------------------------------------------------------------+
void UpdateSessionLiquidity()
  {
   gPDH = iHigh(_Symbol, PERIOD_D1, 1);
   gPDL = iLow(_Symbol, PERIOD_D1, 1);
   gPWH = iHigh(_Symbol, PERIOD_W1, 1);
   gPWL = iLow(_Symbol, PERIOD_W1, 1);

   int      off  = GMTOffsetHours();
   long     ng   = (long)TimeCurrent() - off * 3600;
   datetime nowG = (datetime)ng;
   datetime dayG = (datetime)(ng - (ng % 86400));
   if(nowG < dayG + InpAsiaEndH * 3600)
      dayG -= 86400;

   gAsiaHigh = 0;
   gAsiaLow = 0;
   int sz = ArraySize(gM);
   for(int attempt = 0; attempt < 4; attempt++)
     {
      datetime sG = dayG + InpAsiaStartH * 3600;
      datetime eG = dayG + InpAsiaEndH * 3600;
      double hi = -DBL_MAX, lo = DBL_MAX;
      int cnt = 0;
      for(int i = sz - 1; i >= 0; i--)
        {
         datetime tg = gM[i].time - off * 3600;
         if(tg < sG)
            break;
         if(tg >= eG)
            continue;
         hi = MathMax(hi, gM[i].high);
         lo = MathMin(lo, gM[i].low);
         cnt++;
        }
      if(cnt >= 4)
        {
         gAsiaHigh = hi;
         gAsiaLow = lo;
         gAsiaStartSrv = sG + off * 3600;
         gAsiaEndSrv = eG + off * 3600;
         return;
        }
      dayG -= 86400; // выходные / нет данных — берём предыдущий день
     }
  }

//+------------------------------------------------------------------+
//| Обновление всех данных                                           |
//+------------------------------------------------------------------+
bool RefreshAll()
  {
   if(!LoadRates(InpHTF1, InpHTFBars, gH1)) return false;
   if(!LoadRates(InpHTF2, InpHTFBars, gH2)) return false;
   if(!LoadRates(InpMTF,  InpMTFBars, gM))  return false;
   if(!LoadRates(InpLTF,  InpLTFBars, gL))  return false;

   int n1 = ArraySize(gH1), n2 = ArraySize(gH2), nm = ArraySize(gM), nl = ArraySize(gL);

   if(gH1[n1 - 1].time != gBarH1)
     {
      double atr = CalcATR(gH1, n1 - 2, 14);
      BuildSNR(gH1, n1 - 2, n1 - 2 - InpHTFTouchBars, atr * InpGapMinATR, gLvH1);
      gBarH1 = gH1[n1 - 1].time;
     }
   if(gH2[n2 - 1].time != gBarH2)
     {
      double atr = CalcATR(gH2, n2 - 2, 14);
      BuildSNR(gH2, n2 - 2, n2 - 2 - InpHTFTouchBars, atr * InpGapMinATR, gLvH2);
      gBarH2 = gH2[n2 - 1].time;
     }
   if(gM[nm - 1].time != gBarM)
     {
      double atr = CalcATR(gM, nm - 2, 14);
      BuildSNR(gM, nm - 2, nm - 2, atr * InpGapMinATR, gLvM);
      BuildSwings(gM, nm - 2, InpMTFSwing, gSwM);
      RunStructure(gM, nm - 2, gSwM, gEvM, gTrendM);
      BuildOB(gM, nm - 2, atr, gObM);
      UpdateSessionLiquidity();
      gBarM = gM[nm - 1].time;
     }
   BuildSwings(gL, nl - 2, InpLTFSwing, gSwL);
   RunStructure(gL, nl - 2, gSwL, gEvL, gTrendL);
   return true;
  }

//+------------------------------------------------------------------+
//| Условие 1: HTF контекст (Fresh A/V уровень)                      |
//+------------------------------------------------------------------+
bool CheckHTFLevels(const MqlRates &r[], const SNRLevel &lv[], int dir, ENUM_TIMEFRAMES tf, string &info)
  {
   int sz = ArraySize(r);
   if(sz < 30)
      return false;
   int    last   = sz - 1;
   int    cutoff = sz - 2 - InpHTFTouchBars;
   double tol    = CalcATR(r, sz - 2, 14) * InpHTFZoneATR;
   double bid    = SymbolInfoDouble(_Symbol, SYMBOL_BID);

   for(int k = ArraySize(lv) - 1; k >= 0; k--)
     {
      if(!lv[k].freshCut || lv[k].sideCut != dir)
         continue;
      // для BUY нужна V-форма (или GAP-поддержка), для SELL — A-форма
      bool native = (dir == 1) ? (lv[k].kind == LV_V || (lv[k].kind == LV_GAP && lv[k].side0 == 1))
                               : (lv[k].kind == LV_A || (lv[k].kind == LV_GAP && lv[k].side0 == -1));
      if(!native && !InpUseFlipped)
         continue;

      double p = lv[k].price;
      bool touched = false, broken = false;
      for(int i = MathMax(cutoff + 1, 0); i <= last; i++)
        {
         if(dir == 1)
           {
            if(r[i].low <= p + tol) touched = true;
            if(i < last && r[i].close < p - tol) broken = true;
           }
         else
           {
            if(r[i].high >= p - tol) touched = true;
            if(i < last && r[i].close > p + tol) broken = true;
           }
        }
      if(!touched || broken)
         continue;
      if(dir == 1 && bid < p - tol)  continue;
      if(dir == -1 && bid > p + tol) continue;

      string kn = lv[k].kind == LV_A ? "A" : (lv[k].kind == LV_V ? "V" : "GAP");
      info = TFName(tf) + " " + kn + " " + DoubleToString(p, _Digits);
      return true;
     }
   return false;
  }

bool HTFContext(int dir, string &info)
  {
   if(CheckHTFLevels(gH1, gLvH1, dir, InpHTF1, info))
      return true;
   return CheckHTFLevels(gH2, gLvH2, dir, InpHTF2, info);
  }

//+------------------------------------------------------------------+
//| Условие 2: снятие ликвидности на MTF                              |
//+------------------------------------------------------------------+
bool CheckSweep(int dir, string &what)
  {
   int sz = ArraySize(gM);
   if(sz < 50)
      return false;
   int      last  = sz - 2;
   datetime today = iTime(_Symbol, PERIOD_D1, 0);

   for(int i = last; i > last - InpSweepLookback && i > 1; i--)
     {
      double l = gM[i].low, h = gM[i].high, c = gM[i].close;
      bool   isToday = gM[i].time >= today;
      if(dir == 1)
        {
         if(isToday && gPDL > 0 && l < gPDL && c > gPDL) { what = "PDL"; return true; }
         if(gAsiaLow > 0 && gM[i].time >= gAsiaEndSrv && l < gAsiaLow && c > gAsiaLow) { what = "Asia Low"; return true; }
        }
      else
        {
         if(isToday && gPDH > 0 && h > gPDH && c < gPDH) { what = "PDH"; return true; }
         if(gAsiaHigh > 0 && gM[i].time >= gAsiaEndSrv && h > gAsiaHigh && c < gAsiaHigh) { what = "Asia High"; return true; }
        }
      // IDM: dir события = сторона снятой ликвидности
      for(int e = ArraySize(gEvM) - 1; e >= 0; e--)
        {
         if(gEvM[e].breakTime < gM[i].time)
            break;
         if(gEvM[e].type == EV_IDM && gEvM[e].dir == -dir && gEvM[e].breakTime == gM[i].time)
           { what = "IDM"; return true; }
        }
      // свинги / обычные S/R уровни как ловушки ликвидности (SMT traps)
      for(int k = ArraySize(gSwM) - 1; k >= 0; k--)
        {
         if(gSwM[k].idx >= i || gSwM[k].confirmIdx > i)
            continue;
         if(gSwM[k].idx < i - 150)
            break;
         double p = gSwM[k].price;
         if(dir == 1 && gSwM[k].type == -1 && l < p && c > p)
           {
            bool taken = false;
            for(int m = gSwM[k].idx + 1; m < i; m++)
               if(gM[m].low < p) { taken = true; break; }
            if(!taken) { what = "Swing Low"; return true; }
           }
         if(dir == -1 && gSwM[k].type == 1 && h > p && c < p)
           {
            bool taken = false;
            for(int m = gSwM[k].idx + 1; m < i; m++)
               if(gM[m].high > p) { taken = true; break; }
            if(!taken) { what = "Swing High"; return true; }
           }
        }
     }
   return false;
  }

//+------------------------------------------------------------------+
//| Условие 3: активация POI (необработанный OB с FVG)               |
//+------------------------------------------------------------------+
bool CheckPOI(int dir, int &obIdx)
  {
   int sz = ArraySize(gM);
   if(sz < 50)
      return false;
   int    last   = sz - 2;
   int    cutoff = last - InpPOITouchBars;
   double curLow = gM[sz - 1].low, curHigh = gM[sz - 1].high;

   for(int k = ArraySize(gObM) - 1; k >= 0; k--)
     {
      if(gObM[k].dir != dir || gObM[k].invalidIdx >= 0)
         continue;
      int  mi = gObM[k].mitigIdx;
      bool active = false;
      if(mi >= 0 && mi > cutoff)
         active = true;  // первое касание — внутри окна
      else if(mi < 0)
        {
         if(dir == 1 && curLow <= gObM[k].top)     active = true;
         if(dir == -1 && curHigh >= gObM[k].bottom) active = true;
        }
      if(!active)
         continue;
      obIdx = k;
      return true;
     }
   return false;
  }

//+------------------------------------------------------------------+
//| Условие 4: Quasimodo + CHOCH на LTF                              |
//+------------------------------------------------------------------+
bool FindQM(int dir, QMSetup &q)
  {
   int n = ArraySize(gSwL), sz = ArraySize(gL);
   if(n < 3 || sz < 30)
      return false;
   int last = sz - 2;
   int tExt = (dir == 1) ? -1 : 1;

   for(int k = n - 1; k >= 2 && k >= n - 4; k--)
     {
      if(gSwL[k].type != tExt || gSwL[k - 1].type != -tExt || gSwL[k - 2].type != tExt)
         continue;
      double ext = gSwL[k].price, mid = gSwL[k - 1].price, sh = gSwL[k - 2].price;
      // BUY:  L(sh) -> H(mid) -> LL(ext) -> HH (close > mid = CHOCH)
      // SELL: H(sh) -> L(mid) -> HH(ext) -> LL (close < mid = CHOCH)
      if(dir == 1 && !(ext < sh && mid > sh))
         continue;
      if(dir == -1 && !(ext > sh && mid < sh))
         continue;

      int  ch = -1;
      bool bad = false;
      for(int i = gSwL[k].idx + 1; i <= last; i++)
        {
         if(dir == 1)
           {
            if(gL[i].low < ext) { bad = true; break; }
            if(ch < 0 && gL[i].close > mid) ch = i;
           }
         else
           {
            if(gL[i].high > ext) { bad = true; break; }
            if(ch < 0 && gL[i].close < mid) ch = i;
           }
        }
      if(bad || ch < 0)
         continue;
      if(last - ch > InpQMMaxAgeBars)
         continue;

      q.dir = dir;
      q.shoulder = sh;
      q.shoulderT = gSwL[k - 2].time;
      q.mid = mid;
      q.midT = gSwL[k - 1].time;
      q.ext = ext;
      q.extT = gSwL[k].time;
      q.chochIdx = ch;
      q.hasOB = false;
      // LTF OB: последняя противоположная свеча у экстремума
      int from = MathMin(gSwL[k].idx + 1, last);
      int to   = MathMax(0, gSwL[k].idx - 4);
      for(int i = from; i >= to; i--)
        {
         bool opp = (dir == 1) ? (gL[i].close < gL[i].open) : (gL[i].close > gL[i].open);
         if(opp)
           {
            q.obHi = gL[i].high;
            q.obLo = gL[i].low;
            q.hasOB = true;
            break;
           }
        }
      return true;
     }
   return false;
  }

//+------------------------------------------------------------------+
//| Цели: TP1 / TP2                                                  |
//+------------------------------------------------------------------+
void ConsiderTarget(int dir, double entry, double p, double minDist, double &best)
  {
   if(p <= 0)
      return;
   double d = (p - entry) * dir;
   if(d < minDist)
      return;
   if(best <= 0 || (p - best) * dir < 0)
      best = p;
  }

double PickTP1(int dir, double entry, double R)
  {
   double best = 0, minDist = R * InpMinRR;
   // ближайший противоположный Unfresh A/V уровень
   for(int k = 0; k < ArraySize(gLvM); k++)
      if(!gLvM[k].fresh && gLvM[k].kind != LV_GAP)
         ConsiderTarget(dir, entry, gLvM[k].price, minDist, best);
   for(int k = 0; k < ArraySize(gLvH1); k++)
      if(!gLvH1[k].fresh && gLvH1[k].kind != LV_GAP)
         ConsiderTarget(dir, entry, gLvH1[k].price, minDist, best);
   // противоположный M15 OB
   for(int k = 0; k < ArraySize(gObM); k++)
     {
      if(gObM[k].dir != -dir || gObM[k].invalidIdx >= 0)
         continue;
      ConsiderTarget(dir, entry, dir == 1 ? gObM[k].bottom : gObM[k].top, minDist, best);
     }
   if(best <= 0 && InpTP1Fallback)
      best = entry + dir * minDist;
   return best;
  }

double PickTP2(int dir, double entry, double tp1, double R)
  {
   double best = 0, minDist = MathAbs(tp1 - entry) + 0.5 * R;
   // главная HTF ликвидность: PDH/PDL, PWH/PWL, HTF уровни против позиции
   ConsiderTarget(dir, entry, dir == 1 ? gPDH : gPDL, minDist, best);
   ConsiderTarget(dir, entry, dir == 1 ? gPWH : gPWL, minDist, best);
   for(int k = 0; k < ArraySize(gLvH1); k++)
      if(gLvH1[k].side == -dir)
         ConsiderTarget(dir, entry, gLvH1[k].price, minDist, best);
   for(int k = 0; k < ArraySize(gLvH2); k++)
      if(gLvH2[k].side == -dir)
         ConsiderTarget(dir, entry, gLvH2[k].price, minDist, best);
   if(best <= 0)
      best = entry + dir * MathMax(InpTP2FallbackRR * R, minDist);
   return best;
  }

//+------------------------------------------------------------------+
//| Расчёт лота                                                      |
//+------------------------------------------------------------------+
double CalcLots(int dir, double entry, double sl)
  {
   double bal = AccountInfoDouble(ACCOUNT_BALANCE);
   double riskMoney = bal * InpRiskPercent / 100.0;
   double lossPerLot = 0;
   if(!OrderCalcProfit(dir == 1 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, _Symbol, 1.0, entry, sl, lossPerLot) || lossPerLot == 0)
     {
      double tv = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
      double ts = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
      if(tv <= 0 || ts <= 0)
         return 0;
      lossPerLot = MathAbs(entry - sl) / ts * tv;
     }
   lossPerLot = MathAbs(lossPerLot);
   if(lossPerLot <= 0)
      return 0;

   double minL = VolMin();
   double lots = NormVolDown(riskMoney / lossPerLot);
   if(lots < minL)
     {
      double minRiskPct = lossPerLot * minL / bal * 100.0;
      if(InpAllowMinLot && minRiskPct <= InpMaxRiskAtMinLot)
        {
         lots = minL;
         PrintFormat("Расчётный лот < минимального. Используем %.2f (риск %.2f%%)", minL, minRiskPct);
        }
      else
        {
         PrintFormat("Сделка пропущена: мин. лот %.2f = риск %.2f%% > допустимого %.2f%%", minL, minRiskPct, InpMaxRiskAtMinLot);
         return 0;
        }
     }
   lots = MathMin(lots, VolMax());
   if(InpMaxLot > 0)
      lots = MathMin(lots, InpMaxLot);
   lots = NormVolDown(lots);

   double margin = 0;
   if(OrderCalcMargin(dir == 1 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, _Symbol, lots, entry, margin))
     {
      if(margin > AccountInfoDouble(ACCOUNT_MARGIN_FREE) * 0.9)
        {
         Print("Сделка пропущена: недостаточно свободной маржи");
         return 0;
        }
     }
   return lots;
  }

//+------------------------------------------------------------------+
//| Фильтры: сессия, спред, новости, лимиты                          |
//+------------------------------------------------------------------+
bool InWindow(int m, int startH, int endH)
  {
   int s = startH * 60, e = endH * 60;
   if(s <= e)
      return m >= s && m < e;
   return m >= s || m < e;
  }

bool InSession()
  {
   if(!InpUseSessionFilter)
      return true;
   datetime g = TimeCurrent() - GMTOffsetHours() * 3600;
   MqlDateTime dt;
   TimeToStruct(g, dt);
   int m = dt.hour * 60 + dt.min;
   return InWindow(m, InpLondonStartH, InpLondonEndH) || InWindow(m, InpNYStartH, InpNYEndH);
  }

void UpdateSpread()
  {
   double sp = SpreadPoints();
   if(sp <= 0)
      return;
   gSpreadTicks++;
   gAvgSpread = (gAvgSpread <= 0) ? sp : gAvgSpread * 0.995 + sp * 0.005;
  }

bool SpreadBlocked(string &why)
  {
   double sp = SpreadPoints();
   if(InpMaxSpreadPoints > 0 && sp > InpMaxSpreadPoints)
     { why = "спред " + DoubleToString(sp, 0) + " > " + IntegerToString(InpMaxSpreadPoints); return true; }
   if(InpSpreadSpikeMult > 0 && gSpreadTicks > 200 && sp > gAvgSpread * InpSpreadSpikeMult)
     { why = "расширение спреда x" + DoubleToString(sp / gAvgSpread, 1); return true; }
   return false;
  }

bool CurrencyNews(string cur, datetime from, datetime to, string &info)
  {
   if(cur == "")
      return false;
   MqlCalendarValue vals[];
   int cnt = CalendarValueHistory(vals, from, to, NULL, cur);
   for(int i = 0; i < cnt; i++)
     {
      MqlCalendarEvent ev;
      if(!CalendarEventById(vals[i].event_id, ev))
         continue;
      if(ev.importance == CALENDAR_IMPORTANCE_HIGH ||
         (InpNewsMediumToo && ev.importance == CALENDAR_IMPORTANCE_MODERATE))
        {
         info = cur + ": " + ev.name + " " + TimeToString(vals[i].time, TIME_MINUTES);
         return true;
        }
     }
   return false;
  }

bool NewsBlocked(string &why)
  {
   if(!InpUseNewsFilter || MQLInfoInteger(MQL_TESTER))
      return false;
   if(TimeCurrent() - gNewsCheckT >= 60)
     {
      gNewsCheckT = TimeCurrent();
      datetime now = TimeTradeServer();
      datetime from = now - InpNewsAfterMin * 60, to = now + InpNewsBeforeMin * 60;
      string info = "";
      string base = SymbolInfoString(_Symbol, SYMBOL_CURRENCY_BASE);
      string prof = SymbolInfoString(_Symbol, SYMBOL_CURRENCY_PROFIT);
      gNewsBlocked = CurrencyNews(base, from, to, info) || (prof != base && CurrencyNews(prof, from, to, info));
      gNewsInfo = info;
     }
   if(gNewsBlocked)
      why = "новости (" + gNewsInfo + ")";
   return gNewsBlocked;
  }

bool SpikeBlocked(string &why)
  {
   if(TimeCurrent() < gSpikeUntil)
     { why = "новостной импульс, пауза до " + TimeToString(gSpikeUntil, TIME_MINUTES); return true; }
   return false;
  }

void CheckVolatilitySpike()
  {
   if(InpSpikeATRMult <= 0)
      return;
   int sz = ArraySize(gL);
   if(sz < 20)
      return;
   double atr = CalcATR(gL, sz - 3, 14);
   double rng = gL[sz - 2].high - gL[sz - 2].low;
   if(atr > 0 && rng > atr * InpSpikeATRMult)
     {
      gSpikeUntil = TimeCurrent() + InpSpikePauseMin * 60;
      PrintFormat("Импульсная свеча (%.1f ATR) — пауза %d мин", rng / atr, InpSpikePauseMin);
     }
  }

void DayStats(double &pnl, int &cnt)
  {
   pnl = 0;
   cnt = 0;
   datetime d0 = iTime(_Symbol, PERIOD_D1, 0);
   if(!HistorySelect(d0, TimeCurrent() + 86400))
      return;
   int n = HistoryDealsTotal();
   for(int i = 0; i < n; i++)
     {
      ulong dt = HistoryDealGetTicket(i);
      if(dt == 0) continue;
      if(HistoryDealGetString(dt, DEAL_SYMBOL) != _Symbol) continue;
      if(HistoryDealGetInteger(dt, DEAL_MAGIC) != InpMagic) continue;
      if(HistoryDealGetInteger(dt, DEAL_ENTRY) == DEAL_ENTRY_IN)
         cnt++;
      pnl += HistoryDealGetDouble(dt, DEAL_PROFIT) + HistoryDealGetDouble(dt, DEAL_SWAP) + HistoryDealGetDouble(dt, DEAL_COMMISSION);
     }
  }

bool RiskBlocked(string &why)
  {
   return NewsBlocked(why) || SpikeBlocked(why) || SpreadBlocked(why);
  }

bool TradingAllowed(string &why)
  {
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) || !MQLInfoInteger(MQL_TRADE_ALLOWED))
     { why = "автоторговля запрещена"; return false; }
   if(!InSession())
     { why = "вне сессии London/NY"; return false; }
   if(RiskBlocked(why))
      return false;
   if(InpMinEquity > 0 && AccountInfoDouble(ACCOUNT_EQUITY) < InpMinEquity)
     { why = "эквити ниже минимума"; return false; }
   double pnl;
   int cnt;
   DayStats(pnl, cnt);
   if(InpMaxTradesPerDay > 0 && cnt >= InpMaxTradesPerDay)
     { why = "лимит сделок за день"; return false; }
   double bal = AccountInfoDouble(ACCOUNT_BALANCE);
   if(InpMaxDailyLossPct > 0 && pnl < 0 && -pnl >= (bal - pnl) * InpMaxDailyLossPct / 100.0)
     { why = "дневной лимит убытка"; return false; }
   return true;
  }

bool HasOurTrades()
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) == _Symbol && PositionGetInteger(POSITION_MAGIC) == InpMagic)
         return true;
     }
   for(int i = OrdersTotal() - 1; i >= 0; i--)
     {
      ulong tk = OrderGetTicket(i);
      if(tk == 0) continue;
      if(OrderGetString(ORDER_SYMBOL) == _Symbol && OrderGetInteger(ORDER_MAGIC) == InpMagic)
         return true;
     }
   return false;
  }

//+------------------------------------------------------------------+
//| Размещение лимитного ордера                                      |
//+------------------------------------------------------------------+
bool TryPlace(int dir, const QMSetup &q, string reason)
  {
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double spread = ask - bid;
   double stops = StopsDistance();
   double entry = q.shoulder, ext = q.ext, sl;

   if(dir == 1)
     {
      if(InpEntryMode == ENTRY_LTF_OB && q.hasOB && q.obHi < ask - stops)
        { entry = q.obHi; ext = MathMin(ext, q.obLo); }
      sl = ext - InpSLBufferPoints * _Point - spread;
      if(entry >= ask - stops)
        { Print("QM BUY: цена уже у уровня входа — лимитку не ставим"); return false; }
     }
   else
     {
      if(InpEntryMode == ENTRY_LTF_OB && q.hasOB && q.obLo > bid + stops)
        { entry = q.obLo; ext = MathMax(ext, q.obHi); }
      sl = ext + InpSLBufferPoints * _Point + spread;
      if(entry <= bid + stops)
        { Print("QM SELL: цена уже у уровня входа — лимитку не ставим"); return false; }
     }
   entry = NP(entry);
   sl = NP(sl);
   double R = MathAbs(entry - sl);
   if(R <= 0 || R < stops)
      return false;
   double atrL = CalcATR(gL, ArraySize(gL) - 2, 14);
   if(InpMaxSLATR > 0 && atrL > 0 && R > InpMaxSLATR * atrL)
     { PrintFormat("SL слишком широкий (%.1f ATR) — пропуск", R / atrL); return false; }

   double tp1 = PickTP1(dir, entry, R);
   if(tp1 <= 0)
     { Print("Нет цели TP1 с RR >= ", DoubleToString(InpMinRR, 1)); return false; }
   double tp2 = PickTP2(dir, entry, tp1, R);
   tp1 = NP(tp1);
   tp2 = NP(tp2);

   double lots = CalcLots(dir, entry, sl);
   if(lots <= 0)
      return false;
   double part = NormVolDown(lots * InpPartialPercent / 100.0);
   bool   split = part >= VolMin() && (lots - part) >= VolMin() - 1e-9;
   double tp = split ? tp2 : (InpSingleLotTP == SINGLE_TP1 ? tp1 : tp2);

   string cmt = (dir == 1) ? "SMCSNR BUY QM" : "SMCSNR SELL QM";
   bool ok = (dir == 1) ? trade.BuyLimit(lots, entry, _Symbol, sl, tp, ORDER_TIME_GTC, 0, cmt)
                        : trade.SellLimit(lots, entry, _Symbol, sl, tp, ORDER_TIME_GTC, 0, cmt);
   ulong tk = trade.ResultOrder();
   if(!ok || tk == 0)
     {
      PrintFormat("Ошибка постановки ордера: %d %s", trade.ResultRetcode(), trade.ResultRetcodeDescription());
      return false;
     }
   GVSet(tk, "TP1", tp1);
   GVSet(tk, "SPLIT", split ? 1 : 0);
   GVSet(tk, "EXP", (double)(TimeCurrent() + InpPendingExpiryBars * PeriodSeconds(InpLTF)));
   gLastSetupT = q.extT;
   gLastSetupDir = dir;

   PrintFormat("%s LIMIT %.2f @ %s SL %s TP1 %s (RR %.1f) TP2 %s | %s",
               dir == 1 ? "BUY" : "SELL", lots, DoubleToString(entry, _Digits), DoubleToString(sl, _Digits),
               DoubleToString(tp1, _Digits), MathAbs(tp1 - entry) / R, DoubleToString(tp2, _Digits), reason);
   if(InpDraw)
      DrawQM(q, entry, sl, tp1, tp2);
   return true;
  }

//+------------------------------------------------------------------+
//| Сопровождение                                                    |
//+------------------------------------------------------------------+
bool HasLTFBOSAfter(int dir, datetime since)
  {
   int lp = PeriodSeconds(InpLTF);
   datetime idmT = 0;
   for(int e = 0; e < ArraySize(gEvL); e++)
     {
      if(gEvL[e].breakTime + lp <= since)
         continue;
      // первый IDM по ходу движения (для BUY — снят откатный минимум)
      if(idmT == 0 && gEvL[e].type == EV_IDM && gEvL[e].dir == -dir)
         idmT = gEvL[e].breakTime;
      if(idmT > 0 && gEvL[e].type == EV_BOS && gEvL[e].dir == dir && gEvL[e].breakTime >= idmT)
         return true;
     }
   return false;
  }

bool MoveToBE(ulong tk, int dir, double open, double sl, double tp)
  {
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double stops = StopsDistance();
   double be = NP(open + dir * InpBEOffsetPoints * _Point);
   if(dir == 1)
     {
      if(sl >= be) return true;
      if(bid - be <= stops) return false;
     }
   else
     {
      if(sl > 0 && sl <= be) return true;
      if(be - ask <= stops) return false;
     }
   if(trade.PositionModify(tk, be, tp))
     {
      Print("Позиция ", tk, " переведена в безубыток");
      return true;
     }
   return false;
  }

void ManagePositions()
  {
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol || PositionGetInteger(POSITION_MAGIC) != InpMagic)
         continue;
      int      dir  = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? 1 : -1;
      ulong    id   = (ulong)PositionGetInteger(POSITION_IDENTIFIER);
      double   open = PositionGetDouble(POSITION_PRICE_OPEN);
      double   sl   = PositionGetDouble(POSITION_SL);
      double   tp   = PositionGetDouble(POSITION_TP);
      double   vol  = PositionGetDouble(POSITION_VOLUME);
      datetime pt   = (datetime)PositionGetInteger(POSITION_TIME);

      double tp1   = GVGet(id, "TP1", 0);
      bool   split = GVGet(id, "SPLIT", 0) > 0.5;
      bool   part  = GVGet(id, "PART", 0) > 0.5;
      bool   be    = GVGet(id, "BE", 0) > 0.5;

      // TP1: фиксация части объёма
      if(split && !part && tp1 > 0 && ((dir == 1 && bid >= tp1) || (dir == -1 && ask <= tp1)))
        {
         double cv = NormVolDown(vol * InpPartialPercent / 100.0);
         if(cv >= VolMin() && vol - cv >= VolMin() - 1e-9)
           {
            if(trade.PositionClosePartial(tk, cv))
              {
               GVSet(id, "PART", 1);
               Print("TP1: закрыто ", DoubleToString(cv, 2), " лота");
               if(InpBEAfterTP1 && MoveToBE(tk, dir, open, sl, tp))
                 { GVSet(id, "BE", 1); be = true; }
              }
           }
         else
            GVSet(id, "PART", 1);
        }

      // BE по структуре: IDM + BOS на LTF после входа
      if(InpBEOnLTFBOS && !be && HasLTFBOSAfter(dir, pt))
         if(MoveToBE(tk, dir, open, sl, tp))
            GVSet(id, "BE", 1);
     }
  }

void ManagePending(bool riskBlock, string riskWhy)
  {
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   for(int i = OrdersTotal() - 1; i >= 0; i--)
     {
      ulong tk = OrderGetTicket(i);
      if(tk == 0) continue;
      if(OrderGetString(ORDER_SYMBOL) != _Symbol || OrderGetInteger(ORDER_MAGIC) != InpMagic)
         continue;
      long     type = OrderGetInteger(ORDER_TYPE);
      double   tp1  = GVGet(tk, "TP1", 0);
      datetime exp  = (datetime)GVGet(tk, "EXP", 0);
      string   why  = "";
      if(exp > 0 && TimeCurrent() >= exp)
         why = "истёк срок";
      else if(type == ORDER_TYPE_BUY_LIMIT && tp1 > 0 && bid >= tp1)
         why = "цена дошла до TP1 без входа";
      else if(type == ORDER_TYPE_SELL_LIMIT && tp1 > 0 && ask <= tp1)
         why = "цена дошла до TP1 без входа";
      else if(InpCancelPendingOnRisk && riskBlock)
         why = riskWhy;
      if(why != "" && trade.OrderDelete(tk))
         Print("Лимитка ", tk, " удалена: ", why);
     }
  }

//+------------------------------------------------------------------+
//| Визуализация                                                     |
//+------------------------------------------------------------------+
void DrawLine(string name, datetime t1, double p1, datetime t2, double p2, color clr, int width, ENUM_LINE_STYLE st, string tip)
  {
   if(!ObjectCreate(0, name, OBJ_TREND, 0, t1, p1, t2, p2))
      return;
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, width);
   ObjectSetInteger(0, name, OBJPROP_STYLE, st);
   ObjectSetInteger(0, name, OBJPROP_RAY_RIGHT, false);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, name, OBJPROP_BACK, true);
   ObjectSetString(0, name, OBJPROP_TOOLTIP, tip);
  }

void DrawRect(string name, datetime t1, double p1, datetime t2, double p2, color clr, string tip)
  {
   if(!ObjectCreate(0, name, OBJ_RECTANGLE, 0, t1, p1, t2, p2))
      return;
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, name, OBJPROP_FILL, true);
   ObjectSetInteger(0, name, OBJPROP_BACK, true);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetString(0, name, OBJPROP_TOOLTIP, tip);
  }

void DrawText(string name, datetime t, double p, string text, color clr, ENUM_ANCHOR_POINT anchor, int size = 7)
  {
   if(!ObjectCreate(0, name, OBJ_TEXT, 0, t, p))
      return;
   ObjectSetString(0, name, OBJPROP_TEXT, text);
   ObjectSetString(0, name, OBJPROP_FONT, "Arial");
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE, size);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, name, OBJPROP_ANCHOR, anchor);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
  }

void DrawLevels(const SNRLevel &lv[], ENUM_TIMEFRAMES tf, datetime tEnd)
  {
   int drawn = 0;
   string tfn = TFName(tf);
   for(int k = ArraySize(lv) - 1; k >= 0 && drawn < InpDrawMaxLevels; k--)
     {
      string kn = lv[k].kind == LV_A ? "A" : (lv[k].kind == LV_V ? "V" : "GAP");
      color  clr = !lv[k].fresh ? InpClrUnfresh : (lv[k].side == 1 ? InpClrSupport : InpClrResist);
      string st = lv[k].fresh ? "Fresh" : "Unfresh";
      string nm = PFX + "LV_" + tfn + "_" + IntegerToString(k);
      DrawLine(nm, lv[k].time, lv[k].price, tEnd, lv[k].price, clr, lv[k].fresh ? 2 : 1,
               lv[k].fresh ? STYLE_SOLID : STYLE_DOT, tfn + " " + kn + " " + st);
      DrawText(nm + "_t", tEnd, lv[k].price, tfn + " " + kn + (lv[k].fresh ? "" : " (u)"), clr, ANCHOR_LEFT);
      drawn++;
     }
  }

void DrawEvents(const StructEvent &ev[], ENUM_TIMEFRAMES tf)
  {
   string tfn = TFName(tf);
   int from = MathMax(0, ArraySize(ev) - InpDrawMaxEvents);
   for(int e = from; e < ArraySize(ev); e++)
     {
      string txt = ev[e].type == EV_BOS ? "BOS" : (ev[e].type == EV_CHOCH ? "CHOCH" : "IDM");
      string nm = PFX + "EV_" + tfn + "_" + IntegerToString(e);
      DrawLine(nm, ev[e].levelTime, ev[e].price, ev[e].breakTime, ev[e].price, InpClrEvents, 1, STYLE_DASH, tfn + " " + txt);
      bool up = ev[e].dir == 1;
      DrawText(nm + "_t", ev[e].breakTime, ev[e].price, txt + " " + tfn, InpClrEvents, up ? ANCHOR_LOWER : ANCHOR_UPPER);
     }
  }

void DrawAll()
  {
   if(!InpDraw)
      return;
   if(MQLInfoInteger(MQL_TESTER) && !MQLInfoInteger(MQL_VISUAL_MODE))
      return;
   ObjectsDeleteAll(0, PFX + "LV_");
   ObjectsDeleteAll(0, PFX + "EV_");
   ObjectsDeleteAll(0, PFX + "OB_");
   ObjectsDeleteAll(0, PFX + "LQ_");
   ObjectsDeleteAll(0, PFX + "IFC_");

   datetime tEnd = TimeCurrent() + PeriodSeconds(InpMTF) * 8;
   DrawLevels(gLvH1, InpHTF1, tEnd);
   DrawLevels(gLvH2, InpHTF2, tEnd);

   // OB + FVG
   int drawn = 0;
   for(int k = ArraySize(gObM) - 1; k >= 0 && drawn < InpDrawMaxZones; k--)
     {
      if(gObM[k].invalidIdx >= 0)
         continue;
      string nm = PFX + "OB_" + IntegerToString(k);
      bool   mitig = gObM[k].mitigIdx >= 0;
      string tip = (gObM[k].dir == 1 ? "Bullish OB" : "Bearish OB") + string(mitig ? " (mitigated)" : " (unmitigated)");
      DrawRect(nm, gObM[k].time, gObM[k].top, tEnd, gObM[k].bottom, gObM[k].dir == 1 ? InpClrBullOB : InpClrBearOB, tip);
      DrawText(nm + "_t", gObM[k].time, gObM[k].dir == 1 ? gObM[k].bottom : gObM[k].top,
               "OB" + string(mitig ? "" : "*"), InpClrEvents, gObM[k].dir == 1 ? ANCHOR_LEFT_UPPER : ANCHOR_LEFT_LOWER);
      DrawRect(nm + "_fvg", gObM[k].fvgTime, gObM[k].fvgTop, gObM[k].fvgTime + PeriodSeconds(InpMTF) * 6,
               gObM[k].fvgBottom, InpClrFVG, "FVG");
      drawn++;
     }

   DrawEvents(gEvM, InpMTF);
   DrawEvents(gEvL, InpLTF);

   // сессионная ликвидность
   datetime d0 = iTime(_Symbol, PERIOD_D1, 0);
   if(gPDH > 0) { DrawLine(PFX + "LQ_PDH", d0, gPDH, tEnd, gPDH, InpClrLiquidity, 1, STYLE_DASHDOT, "PDH"); DrawText(PFX + "LQ_PDH_t", tEnd, gPDH, "PDH", InpClrLiquidity, ANCHOR_LEFT); }
   if(gPDL > 0) { DrawLine(PFX + "LQ_PDL", d0, gPDL, tEnd, gPDL, InpClrLiquidity, 1, STYLE_DASHDOT, "PDL"); DrawText(PFX + "LQ_PDL_t", tEnd, gPDL, "PDL", InpClrLiquidity, ANCHOR_LEFT); }
   if(gAsiaHigh > 0)
     {
      DrawLine(PFX + "LQ_AH", gAsiaStartSrv, gAsiaHigh, tEnd, gAsiaHigh, InpClrLiquidity, 1, STYLE_DOT, "Asia High");
      DrawLine(PFX + "LQ_AL", gAsiaStartSrv, gAsiaLow, tEnd, gAsiaLow, InpClrLiquidity, 1, STYLE_DOT, "Asia Low");
      DrawText(PFX + "LQ_AH_t", tEnd, gAsiaHigh, "Asia H", InpClrLiquidity, ANCHOR_LEFT);
      DrawText(PFX + "LQ_AL_t", tEnd, gAsiaLow, "Asia L", InpClrLiquidity, ANCHOR_LEFT);
     }

   // IFC — институциональные свечи
   int sz = ArraySize(gM);
   double atr = CalcATR(gM, sz - 2, 14);
   for(int i = MathMax(1, sz - 100); i <= sz - 2 && atr > 0; i++)
     {
      double body = MathAbs(gM[i].close - gM[i].open), rng = gM[i].high - gM[i].low;
      if(body >= InpIFCBodyATR * atr && rng > 0 && body / rng >= 0.6)
        {
         bool bull = gM[i].close > gM[i].open;
         DrawText(PFX + "IFC_" + IntegerToString(i), gM[i].time, bull ? gM[i].low : gM[i].high, "IFC",
                  clrOrange, bull ? ANCHOR_UPPER : ANCHOR_LOWER);
        }
     }
   ChartRedraw();
  }

void DrawQM(const QMSetup &q, double entry, double sl, double tp1, double tp2)
  {
   if(MQLInfoInteger(MQL_TESTER) && !MQLInfoInteger(MQL_VISUAL_MODE))
      return;
   string id = PFX + "QM_" + IntegerToString((long)q.extT) + "_";
   color  c  = q.dir == 1 ? InpClrSupport : InpClrResist;
   datetime tEnd = TimeCurrent() + PeriodSeconds(InpLTF) * 20;
   DrawLine(id + "1", q.shoulderT, q.shoulder, q.midT, q.mid, c, 1, STYLE_SOLID, "QM");
   DrawLine(id + "2", q.midT, q.mid, q.extT, q.ext, c, 1, STYLE_SOLID, "QM");
   DrawLine(id + "3", q.extT, q.ext, gL[q.chochIdx].time, q.mid, c, 1, STYLE_SOLID, "QM");
   DrawLine(id + "E", q.shoulderT, entry, tEnd, entry, c, 2, STYLE_SOLID, "Entry");
   DrawLine(id + "S", q.extT, sl, tEnd, sl, clrRed, 1, STYLE_DASH, "SL");
   DrawLine(id + "T1", gL[q.chochIdx].time, tp1, tEnd, tp1, clrAqua, 1, STYLE_DASH, "TP1");
   DrawLine(id + "T2", gL[q.chochIdx].time, tp2, tEnd, tp2, clrAqua, 1, STYLE_DOT, "TP2");
   DrawText(id + "Et", tEnd, entry, "QML entry", c, ANCHOR_LEFT, 8);
   DrawText(id + "Ct", gL[q.chochIdx].time, q.mid, "CHOCH", c, q.dir == 1 ? ANCHOR_LOWER : ANCHOR_UPPER, 8);
   ChartRedraw();
  }

void ShowPanel(string state)
  {
   if(!InpShowPanel)
      return;
   string trendM = gTrendM == 1 ? "Bull" : (gTrendM == -1 ? "Bear" : "-");
   string trendL = gTrendL == 1 ? "Bull" : (gTrendL == -1 ? "Bear" : "-");
   string s = "SMC + Malaysian SNR Hybrid EA\n";
   s += "Баланс: " + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2) + " " + AccountInfoString(ACCOUNT_CURRENCY) +
        " | Риск: " + DoubleToString(InpRiskPercent, 2) + "%\n";
   s += "Структура: " + TFName(InpMTF) + " " + trendM + " | " + TFName(InpLTF) + " " + trendL + "\n";
   s += "Спред: " + DoubleToString(SpreadPoints(), 0) + " (ср. " + DoubleToString(gAvgSpread, 0) + ")\n";
   s += "Статус: " + state + "\n";
   s += gPanel[0] + "\n" + gPanel[1];
   Comment(s);
  }

//+------------------------------------------------------------------+
//| Основная логика                                                  |
//+------------------------------------------------------------------+
void Evaluate()
  {
   string why = "";
   bool canTrade = TradingAllowed(why);
   bool busy = HasOurTrades();

   for(int d = 0; d < 2; d++)
     {
      int     dir = (d == 0) ? 1 : -1;
      string  i1 = "", i2 = "";
      int     obIdx = -1;
      QMSetup q;
      ZeroMemory(q);

      bool c1 = !InpUseHTFContext || HTFContext(dir, i1);
      bool c2 = !InpUseSweep || CheckSweep(dir, i2);
      bool c3 = !InpUsePOI || CheckPOI(dir, obIdx);
      bool c4 = FindQM(dir, q);

      string poi = obIdx >= 0 ? DoubleToString(gObM[obIdx].bottom, _Digits) + "-" + DoubleToString(gObM[obIdx].top, _Digits) : "";
      gPanel[d] = (dir == 1 ? "BUY : " : "SELL: ") +
                  "HTF " + (c1 ? "[+] " + i1 : "[-]") + " | Sweep " + (c2 ? "[+] " + i2 : "[-]") +
                  " | POI " + (c3 ? "[+] " + poi : "[-]") + " | QM " + (c4 ? "[+]" : "[-]");

      if(!(c1 && c2 && c3 && c4) || !canTrade || busy)
         continue;
      if(q.extT == gLastSetupT && dir == gLastSetupDir)
         continue; // этот сетап уже отработан
      string reason = "HTF[" + i1 + "] Sweep[" + i2 + "] POI[" + poi + "]";
      if(TryPlace(dir, q, reason))
         busy = true;
     }
   string state = busy ? "есть позиция/ордер" : (canTrade ? "поиск сетапа" : "пауза: " + why);
   ShowPanel(state);
  }

//+------------------------------------------------------------------+
//| События эксперта                                                 |
//+------------------------------------------------------------------+
int OnInit()
  {
   if(PeriodSeconds(InpLTF) >= PeriodSeconds(InpMTF) || PeriodSeconds(InpMTF) >= PeriodSeconds(InpHTF1) ||
      PeriodSeconds(InpHTF1) > PeriodSeconds(InpHTF2))
     {
      Print("Неверные таймфреймы: должно быть LTF < MTF < HTF1 <= HTF2");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(InpRiskPercent <= 0 || InpRiskPercent > 100)
     {
      Print("Неверный риск на сделку");
      return INIT_PARAMETERS_INCORRECT;
     }
   trade.SetExpertMagicNumber((ulong)InpMagic);
   trade.SetDeviationInPoints((ulong)InpMaxSlippagePoints);
   trade.SetTypeFillingBySymbol(_Symbol);
   trade.SetAsyncMode(false);

   double minL = VolMin(), bal = AccountInfoDouble(ACCOUNT_BALANCE);
   PrintFormat("Старт: баланс %.2f %s, мин. лот %.2f, риск %.2f%% = %.2f %s",
               bal, AccountInfoString(ACCOUNT_CURRENCY), minL, InpRiskPercent, bal * InpRiskPercent / 100.0,
               AccountInfoString(ACCOUNT_CURRENCY));
   gBarH1 = gBarH2 = gBarM = gBarL = 0;
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   ObjectsDeleteAll(0, PFX);
   Comment("");
  }

void OnTick()
  {
   UpdateSpread();
   string riskWhy = "";
   bool riskBlock = RiskBlocked(riskWhy);
   ManagePending(riskBlock, riskWhy);
   ManagePositions();

   datetime lt = iTime(_Symbol, InpLTF, 0);
   if(lt == 0 || lt == gBarL)
      return;
   if(!RefreshAll())
      return;
   gBarL = lt;

   CheckVolatilitySpike();
   Evaluate();
   DrawAll();
  }
//+------------------------------------------------------------------+
