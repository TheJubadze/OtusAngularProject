import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import {
  Chart,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  TimeScale,
  Tooltip,
} from 'chart.js';
import {
  CandlestickController,
  CandlestickElement,
} from 'chartjs-chart-financial';
import 'chartjs-adapter-date-fns';

import { Candle, Range } from '../../core/domain';

Chart.register(
  CandlestickController,
  CandlestickElement,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  TimeScale,
  Tooltip,
  Legend,
);

interface MaSpec {
  readonly period: number;
  readonly color: string;
}

const MA_SPECS: readonly MaSpec[] = [
  { period: 7, color: '#facc15' },   // amber
  { period: 25, color: '#ec4899' },  // pink
  { period: 99, color: '#a78bfa' },  // violet
];

const CANDLE_COLORS = {
  up: '#3fb950',
  down: '#f85149',
  unchanged: '#8b949e',
} as const;

interface ThemeColors {
  readonly tooltipBg: string;
  readonly text: string;
  readonly textSecondary: string;
  readonly border: string;
  readonly axis: string;
  readonly grid: string;
}

@Component({
  selector: 'app-candle-chart',
  template: '<canvas #canvas></canvas>',
  styles: [`
    :host {
      display: block;
      width: 100%;
      height: 280px;
    }
    canvas {
      width: 100% !important;
      height: 100% !important;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CandleChart implements OnDestroy {
  readonly candles = input.required<readonly Candle[] | null | undefined>();
  readonly range = input<Range>('7d');

  private readonly canvasRef =
    viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly doc = inject(DOCUMENT);

  // The financial chart's data type isn't exported well; cast at the boundary.
  private chart?: Chart;
  private themeObserver?: MutationObserver;
  /** See PriceChart for the rationale; same pattern. */
  private readonly themeTick = signal(0);

  constructor() {
    effect(() => {
      const candles = this.candles() ?? [];
      const range = this.range();
      this.themeTick();
      this.render(candles, range);
    });

    this.themeObserver = new MutationObserver(() =>
      this.themeTick.update((n) => n + 1),
    );
    this.themeObserver.observe(this.doc.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  }

  ngOnDestroy(): void {
    this.themeObserver?.disconnect();
    this.themeObserver = undefined;
    this.chart?.destroy();
    this.chart = undefined;
  }

  private render(candles: readonly Candle[], range: Range): void {
    const canvas = this.canvasRef().nativeElement;
    const timeUnit = pickTimeUnit(range);
    const theme = resolveThemeColors(this.doc.documentElement);

    // Compute MAs over the FULL fetched series (lookback candles included)
    // so that even MA(99) has data at the leftmost visible candle.
    const fullMaData = MA_SPECS.map((spec) => computeMa(candles, spec.period));

    // Slice to visible window for rendering. Passing only visible candles
    // (instead of clipping via scales.x.min) lets the Y-axis auto-fit to
    // the visible price range — otherwise off-screen lookback prices would
    // pull the scale and leave dead space at the top/bottom of the chart.
    const visible = visibleCount(range);
    const visibleStart = Math.max(0, candles.length - visible);
    const visibleCandles = candles.slice(visibleStart);
    const minTimestamp = visibleCandles[0]?.timestamp ?? 0;

    const candleData = visibleCandles.map((c) => ({
      x: c.timestamp,
      o: c.open,
      h: c.high,
      l: c.low,
      c: c.close,
    }));
    // Trim MA series to visible time range; their leading lookback portion
    // sits outside and gets dropped here.
    const maData = fullMaData.map((arr) =>
      arr.filter((p) => p.x >= minTimestamp),
    );

    // Pin the X scale around visible candles with a padding that's a tiny
    // fraction of the TOTAL visible time span — this makes the visual gap
    // between the outermost candles and the chart edges identical across
    // every range. (Padding by a fraction of bucketMs would be different
    // pixel-wise on each range because the candle/range ratio varies.)
    const lastIdx = visibleCandles.length - 1;
    const totalSpanMs =
      visibleCandles.length >= 2
        ? visibleCandles[lastIdx].timestamp - visibleCandles[0].timestamp
        : 0;
    const edgePadMs = totalSpanMs * 0.005; // 0.5% of plot width on each side
    const xMin = visibleCandles.length > 0
      ? visibleCandles[0].timestamp - edgePadMs
      : undefined;
    const xMax = visibleCandles.length > 0
      ? visibleCandles[lastIdx].timestamp + edgePadMs
      : undefined;

    if (!this.chart) {
      this.chart = new Chart(canvas, {
        type: 'candlestick',
        data: {
          datasets: [
            {
              type: 'candlestick',
              label: 'Price',
              data: candleData as never,
              // chartjs-chart-financial picks colors per-candle automatically
              // (green when close >= open, red otherwise) but we override for
              // theme consistency. The candle colors stay constant across
              // light/dark — green/red are universal trading signals.
              borderColor: theme.border,
              backgroundColors: { ...CANDLE_COLORS } as never,
              borderColors: { ...CANDLE_COLORS } as never,
            },
            ...MA_SPECS.map((spec, i) => ({
              type: 'line' as const,
              label: `MA(${spec.period})`,
              data: maData[i] as never,
              borderColor: spec.color,
              backgroundColor: 'transparent',
              borderWidth: 1.2,
              pointRadius: 0,
              pointHoverRadius: 0,
              tension: 0.1,
              fill: false,
              spanGaps: true,
            })),
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          // Fixed pixel padding round the plot area — works together with
          // the locked Y-axis width (afterFit below) to keep the plot
          // dimensions identical across all ranges.
          layout: {
            padding: { top: 4, right: 8, bottom: 0, left: 0 },
          },
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              display: true,
              position: 'top',
              align: 'start',
              labels: {
                color: theme.textSecondary,
                boxWidth: 8,
                boxHeight: 8,
                font: { size: 11 },
                // Hide 'Price' from the legend — the candles are obvious.
                filter: (item) => item.text !== 'Price',
              },
            },
            tooltip: {
              backgroundColor: theme.tooltipBg,
              titleColor: theme.text,
              bodyColor: theme.text,
              borderColor: theme.border,
              borderWidth: 1,
              displayColors: true,
              callbacks: {
                label: (item) => {
                  if (item.dataset.type === 'candlestick') {
                    const raw = item.raw as {
                      o: number; h: number; l: number; c: number;
                    };
                    return [
                      `O ${formatPrice(raw.o)}`,
                      `H ${formatPrice(raw.h)}`,
                      `L ${formatPrice(raw.l)}`,
                      `C ${formatPrice(raw.c)}`,
                    ];
                  }
                  const raw = item.raw as { x: number; y: number };
                  return `${item.dataset.label}: ${formatPrice(raw.y)}`;
                },
              },
            },
          },
          scales: {
            x: {
              type: 'time',
              // bounds: 'data' overrides the default 'ticks' which would
              // round the axis to time-unit boundaries (e.g. midnight on a
              // day-unit) and add unwanted right-side space.
              bounds: 'data',
              min: xMin,
              max: xMax,
              time: { unit: timeUnit },
              ticks: { color: theme.axis, maxTicksLimit: 6 },
              grid: { color: theme.grid },
            },
            y: {
              // Fixed axis width so the plot area's left edge is the same
              // pixel position on every range — otherwise label widths
              // (e.g. "79,720" vs "1,234,567") would shift it around.
              afterFit: (scale) => {
                scale.width = 64;
              },
              ticks: {
                color: theme.axis,
                callback: (value) => formatPrice(Number(value)),
              },
              grid: { color: theme.grid },
            },
          },
        },
      });
      return;
    }

    this.chart.data.datasets[0].data = candleData as never;
    // Candle dataset's `borderColor` follows the surface border so the
    // outline pops against either palette.
    (this.chart.data.datasets[0] as { borderColor?: string }).borderColor =
      theme.border;
    for (let i = 0; i < MA_SPECS.length; i++) {
      this.chart.data.datasets[i + 1].data = maData[i] as never;
    }
    applyThemeToChart(this.chart, theme);
    if (this.chart.options.scales?.['x']) {
      const xScale = this.chart.options.scales['x'] as {
        time?: { unit?: string };
        min?: number;
        max?: number;
      };
      if (xScale.time) xScale.time.unit = timeUnit;
      xScale.min = xMin;
      xScale.max = xMax;
    }
    this.chart.update('none');
  }
}

/**
 * How many trailing candles to actually display. The series we receive
 * holds extra leading candles for MA computation only.
 */
function visibleCount(range: Range): number {
  switch (range) {
    case '1m': return 60;
    case '1h': return 60;
    case '1d': return 96;
    case '7d': return 168;
    case '30d': return 180;
    case '90d': return 90;
    case '1y': return 365;
    case 'max': return 1000;
  }
}

/**
 * Sliding-window simple moving average. Skips the first (period-1) candles
 * for which a full window isn't available; downstream `spanGaps: true` lets
 * the line start cleanly when enough data has accumulated.
 */
function computeMa(
  candles: readonly Candle[],
  period: number,
): Array<{ x: number; y: number }> {
  if (candles.length < period) return [];
  const out: Array<{ x: number; y: number }> = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += candles[i].close;
  out.push({ x: candles[period - 1].timestamp, y: sum / period });
  for (let i = period; i < candles.length; i++) {
    sum += candles[i].close - candles[i - period].close;
    out.push({ x: candles[i].timestamp, y: sum / period });
  }
  return out;
}

type TimeUnit =
  | 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

function pickTimeUnit(range: Range): TimeUnit {
  switch (range) {
    case '1m': return 'second';
    case '1h': return 'minute';
    case '1d': return 'hour';
    case '7d':
    case '30d': return 'day';
    case '90d': return 'week';
    case '1y':
    case 'max': return 'month';
  }
}

function formatPrice(value: number): string {
  if (value >= 1) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (value >= 0.01) return value.toFixed(4);
  return value.toFixed(6);
}

function resolveThemeColors(root: HTMLElement): ThemeColors {
  const styles = getComputedStyle(root);
  const read = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  const border = read('--border', '#30363d');
  return {
    tooltipBg: read('--surface', '#161b22'),
    text: read('--text', '#e6edf3'),
    textSecondary: read('--text-2', '#c9d1d9'),
    border,
    axis: read('--text-muted', '#8b949e'),
    grid: hexToRgba(border, 0.5),
  };
}

function applyThemeToChart(chart: Chart, theme: ThemeColors): void {
  const tooltip = chart.options.plugins?.tooltip;
  if (tooltip) {
    tooltip.backgroundColor = theme.tooltipBg;
    tooltip.titleColor = theme.text;
    tooltip.bodyColor = theme.text;
    tooltip.borderColor = theme.border;
  }
  const legendLabels = chart.options.plugins?.legend?.labels;
  if (legendLabels) {
    legendLabels.color = theme.textSecondary;
  }
  const xScale = chart.options.scales?.['x'] as
    | { ticks?: { color?: string }; grid?: { color?: string } }
    | undefined;
  const yScale = chart.options.scales?.['y'] as
    | { ticks?: { color?: string }; grid?: { color?: string } }
    | undefined;
  if (xScale?.ticks) xScale.ticks.color = theme.axis;
  if (xScale?.grid) xScale.grid.color = theme.grid;
  if (yScale?.ticks) yScale.ticks.color = theme.axis;
  if (yScale?.grid) yScale.grid.color = theme.grid;
}

function hexToRgba(value: string, alpha: number): string {
  const hex = value.startsWith('#') ? value : null;
  if (hex && (hex.length === 7 || hex.length === 4)) {
    const expand = hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex;
    const r = parseInt(expand.slice(1, 3), 16);
    const g = parseInt(expand.slice(3, 5), 16);
    const b = parseInt(expand.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  const rgb = value.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (rgb) {
    return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`;
  }
  return `rgba(48, 54, 61, ${alpha})`;
}
