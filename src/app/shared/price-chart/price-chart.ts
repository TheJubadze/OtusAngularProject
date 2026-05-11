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
  Filler,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';

import { HistoricalPoint, Range } from '../../core/domain';

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Filler,
  Tooltip,
);

export type Trend = 'up' | 'down' | 'neutral';

const TREND_COLORS: Record<Trend, { line: string; fill: string }> = {
  up: { line: '#3fb950', fill: 'rgba(63, 185, 80, 0.18)' },
  down: { line: '#f85149', fill: 'rgba(248, 81, 73, 0.18)' },
  neutral: { line: '#58a6ff', fill: 'rgba(88, 166, 255, 0.18)' },
};

interface ThemeColors {
  readonly tooltipBg: string;
  readonly text: string;
  readonly border: string;
  readonly axis: string;
  readonly grid: string;
}

@Component({
  selector: 'app-price-chart',
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
export class PriceChart implements OnDestroy {
  readonly points = input.required<readonly HistoricalPoint[] | null | undefined>();
  readonly range = input<Range>('7d');
  readonly vsCurrency = input<string>('usd');

  private readonly canvasRef =
    viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly doc = inject(DOCUMENT);

  private chart?: Chart<'line'>;
  private themeObserver?: MutationObserver;

  /**
   * Latest snapshot of what the chart is showing. The tooltip callbacks
   * are wired once at chart creation, so they need a stable reference
   * (`this`) to read the current points, X-axis formatter, and currency
   * label from. The signal is the theme tick — bumping it triggers the
   * effect below so we re-render with fresh CSS-variable colors.
   */
  private currentPoints: readonly HistoricalPoint[] = [];
  private currentFormatX: (timestamp: number) => string = makeXFormatter('7d');
  private currentVsLabel = 'USD';
  private readonly themeTick = signal(0);

  constructor() {
    effect(() => {
      const points = this.points() ?? [];
      const range = this.range();
      const vs = this.vsCurrency();
      this.themeTick();
      // Trend is derived from the visible series itself (first vs. last
      // point) so the chart's color always matches what the user sees in
      // the selected range — independent of any external 24h figure.
      const trend = computeTrend(points);
      this.render(points, trend, range, vs);
    });

    // Watch <html data-theme> so that toggling the theme re-renders the
    // chart with the freshly-resolved CSS variable colors. Without this,
    // tooltips/axes would stay frozen at whatever palette was active when
    // the chart was first created.
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

  private render(
    points: readonly HistoricalPoint[],
    trend: Trend,
    range: Range,
    vsCurrency: string,
  ): void {
    this.currentPoints = points;
    this.currentFormatX = makeXFormatter(range);
    this.currentVsLabel = vsCurrency.toUpperCase();
    const canvas = this.canvasRef().nativeElement;
    const trendColors = TREND_COLORS[trend];
    const theme = resolveThemeColors(this.doc.documentElement);

    if (!this.chart) {
      this.chart = new Chart<'line'>(canvas, {
        type: 'line',
        data: {
          labels: points.map((p) => p.timestamp),
          datasets: [
            {
              data: points.map((p) => p.price),
              borderColor: trendColors.line,
              backgroundColor: trendColors.fill,
              borderWidth: 1.7,
              pointRadius: 0,
              pointHoverRadius: 4,
              tension: 0.25,
              fill: true,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: theme.tooltipBg,
              titleColor: theme.text,
              bodyColor: theme.text,
              borderColor: theme.border,
              borderWidth: 1,
              displayColors: false,
              callbacks: {
                // Resolve via dataIndex so we read the original timestamp,
                // not the X-axis label string (which is already formatted).
                title: (items) => {
                  const point = this.currentPoints[items[0].dataIndex];
                  return point ? this.currentFormatX(point.timestamp) : '';
                },
                label: (item) =>
                  `${formatPrice(Number(item.parsed.y))} ${this.currentVsLabel}`,
              },
            },
          },
          scales: {
            x: {
              type: 'linear',
              ticks: {
                color: theme.axis,
                maxTicksLimit: 6,
                callback: (value) => this.currentFormatX(Number(value)),
              },
              grid: { color: theme.grid },
            },
            y: {
              ticks: {
                color: theme.axis,
                callback: (value) => formatPrice(Number(value)),
              },
              grid: { color: theme.grid },
            },
          },
          elements: { line: { borderJoinStyle: 'round' } },
        },
      });
      return;
    }

    const dataset = this.chart.data.datasets[0];
    dataset.data = points.map((p) => p.price);
    this.chart.data.labels = points.map((p) => p.timestamp);
    dataset.borderColor = trendColors.line;
    dataset.backgroundColor = trendColors.fill;
    applyThemeToChart(this.chart, theme);
    this.chart.update('none');
  }
}

function computeTrend(points: readonly HistoricalPoint[]): Trend {
  if (points.length < 2) return 'neutral';
  const diff = points[points.length - 1].price - points[0].price;
  if (diff > 0) return 'up';
  if (diff < 0) return 'down';
  return 'neutral';
}

function makeXFormatter(range: Range): (timestamp: number) => string {
  return (timestamp) => {
    const d = new Date(timestamp);
    if (range === '1m') {
      return d.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    }
    if (range === '1h' || range === '1d') {
      return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }
    if (range === '7d' || range === '30d' || range === '90d') {
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  };
}

function formatPrice(value: number): string {
  if (value >= 1) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (value >= 0.01) return value.toFixed(4);
  return value.toFixed(6);
}

/**
 * Pull the chart-relevant tokens out of the cascade. Reading at render
 * time (rather than caching once) means theme switches just work: the
 * MutationObserver bumps a signal, the effect re-runs, this function
 * returns the current palette.
 */
function resolveThemeColors(root: HTMLElement): ThemeColors {
  const styles = getComputedStyle(root);
  const read = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  const border = read('--border', '#30363d');
  return {
    tooltipBg: read('--surface', '#161b22'),
    text: read('--text', '#e6edf3'),
    border,
    axis: read('--text-muted', '#8b949e'),
    // Half-strength border, used for the gridlines so they don't dominate.
    grid: hexToRgba(border, 0.5),
  };
}

function applyThemeToChart(chart: Chart<'line'>, theme: ThemeColors): void {
  const tooltip = chart.options.plugins?.tooltip;
  if (tooltip) {
    tooltip.backgroundColor = theme.tooltipBg;
    tooltip.titleColor = theme.text;
    tooltip.bodyColor = theme.text;
    tooltip.borderColor = theme.border;
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

/**
 * Accepts `#rrggbb` or already-`rgb(…)`-shaped strings (CSS variable
 * values can be either after the cascade resolves). Returns an `rgba()`
 * string with the requested alpha. Anything we can't parse falls back
 * to the dark-theme grid color so the chart stays legible.
 */
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
