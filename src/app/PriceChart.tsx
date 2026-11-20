import { useEffect, useRef, useState } from "react";
import { createChart, CrosshairMode, LineStyle, type IChartApi, type IPriceLine, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import type { Candle, Level, Signal } from "@/engine/types";

export interface Zone {
  low: number;
  high: number;
  color: string;
  label: string;
}

const toZone = (l: Level): Zone => ({
  low: l.low,
  high: l.high,
  color: l.direction === "demand" ? "rgba(138,168,96,0.09)" : "rgba(193,86,59,0.09)",
  label: `${l.tf} ${l.kind === "order_block" ? "OB" : l.kind === "fvg" ? "FVG" : l.kind === "liquidity_pool" ? "LIQ" : "SnR"}`,
});

export function PriceChart({
  candles,
  levels = [],
  signal,
  height = 340,
  markers = [],
}: {
  candles: Candle[];
  levels?: Level[];
  signal?: Signal | null;
  height?: number;
  markers?: { time: number; text: string; color: string; position: "aboveBar" | "belowBar"; shape: "arrowUp" | "arrowDown" | "circle" }[];
}) {
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const zonesRef = useRef<Zone[]>([]);
  const [rects, setRects] = useState<{ top: number; h: number; z: Zone }[]>([]);
  const fitted = useRef(false);

  useEffect(() => {
    if (!box.current) return;
    const chart = createChart(box.current, {
      height,
      layout: { background: { color: "transparent" }, textColor: "#988575", fontFamily: "IBM Plex Mono, monospace", fontSize: 11 },
      grid: { vertLines: { color: "rgba(44,38,29,0.5)" }, horzLines: { color: "rgba(44,38,29,0.5)" } },
      rightPriceScale: { borderColor: "#2c261d" },
      timeScale: { borderColor: "#2c261d", timeVisible: true, secondsVisible: false },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { locale: "ru-RU" },
    });
    const series = chart.addCandlestickSeries({
      upColor: "#8aa860",
      downColor: "#c1563b",
      borderUpColor: "#8aa860",
      borderDownColor: "#c1563b",
      wickUpColor: "#8aa860",
      wickDownColor: "#c1563b",
    });
    chartRef.current = chart;
    seriesRef.current = series;
    const ro = new ResizeObserver(() => chart.applyOptions({ width: box.current?.clientWidth ?? 300 }));
    ro.observe(box.current);
    const update = () => {
      const s = seriesRef.current;
      if (!s) return;
      setRects(
        zonesRef.current
          .map((z) => {
            const a = s.priceToCoordinate(z.high);
            const b = s.priceToCoordinate(z.low);
            if (a == null || b == null) return null;
            return { top: a, h: Math.max(2, b - a), z };
          })
          .filter(Boolean) as { top: number; h: number; z: Zone }[],
      );
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(update);
    const iv = setInterval(update, 400);
    return () => {
      clearInterval(iv);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      fitted.current = false;
    };
  }, [height]);

  useEffect(() => {
    const s = seriesRef.current;
    if (!s || !candles.length) return;
    s.setData(candles.map((c) => ({ time: (c.t / 1000) as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c })));
    s.setMarkers(
      markers
        .filter((m) => m.time >= candles[0].t)
        .sort((a, b) => a.time - b.time)
        .map((m) => {
          // snap to candle open time
          let t = candles[0].t;
          for (const c of candles) if (c.t <= m.time) t = c.t;
          return { time: (t / 1000) as UTCTimestamp, text: m.text, color: m.color, position: m.position, shape: m.shape };
        }),
    );
    if (!fitted.current) {
      chartRef.current?.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles.length - 120), to: candles.length + 3 });
      fitted.current = true;
    }
  }, [candles, markers]);

  useEffect(() => {
    const s = seriesRef.current;
    if (!s) return;
    linesRef.current.forEach((l) => s.removePriceLine(l));
    linesRef.current = [];
    zonesRef.current = levels.map(toZone);
    if (signal) {
      const add = (price: number, color: string, title: string, style = LineStyle.Solid) =>
        linesRef.current.push(s.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }));
      add(signal.entry, "#d69900", "ENTRY");
      add(signal.sl, "#c1563b", "SL", LineStyle.Dashed);
      signal.tps.forEach((tp, i) => add(tp, "#8aa860", `TP${i + 1}`, LineStyle.Dashed));
    }
  }, [levels, signal]);

  return (
    <div className="relative w-full overflow-hidden" style={{ height }}>
      <div ref={box} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-0 right-[60px]">
        {rects.map((r, i) => (
          <div key={i} className="absolute left-0 right-0 border-y border-dashed" style={{ top: r.top, height: r.h, background: r.z.color, borderColor: r.z.color.replace("0.09", "0.45") }}>
            <span className="absolute left-1 top-0 font-mono text-[9px] text-cream/60">{r.z.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
