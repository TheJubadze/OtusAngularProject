import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  input,
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

const COLORS: Record<Trend, { line: string; fill: string }> = {
  up: { line: '#3fb950', fill: 'rgba(63, 185, 80, 0.18)' },
  down: { line: '#f85149', fill: 'rgba(248, 81, 73, 0.18)' },
  neutral: { line: '#58a6ff', fill: 'rgba(88, 166, 255, 0.18)' },
};

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

  private readonly canvasRef =
    viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  private chart?: Chart<'line'>;

  /**
   * Latest snapshot of the data the chart is showing. The tooltip callbacks
   * are wired once at chart creation, so they need a stable reference (`this`)
   * to read the current points and current X-axis formatter from.
   */
  private currentPoints: readonly HistoricalPoint[] = [];
  private currentFormatX: (timestamp: number) => string = makeXFormatter('7d');

  constructor() {
    effect(() => {
      const points = this.points() ?? [];
      const range = this.range();
      // Trend is derived from the visible series itself (first vs. last
      // point) so the chart's color always matches what the user sees in
      // the selected range — independent of any external 24h figure.
      const trend = computeTrend(points);
      this.render(points, trend, range);
    });
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
    this.chart = undefined;
  }

  private render(
    points: readonly HistoricalPoint[],
    trend: Trend,
    range: Range,
  ): void {
    this.currentPoints = points;
    this.currentFormatX = makeXFormatter(range);
    const canvas = this.canvasRef().nativeElement;
    const colors = COLORS[trend];

    if (!this.chart) {
      this.chart = new Chart<'line'>(canvas, {
        type: 'line',
        data: {
          labels: points.map((p) => p.timestamp),
          datasets: [
            {
              data: points.map((p) => p.price),
              borderColor: colors.line,
              backgroundColor: colors.fill,
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
              backgroundColor: '#161b22',
              titleColor: '#e6edf3',
              bodyColor: '#e6edf3',
              borderColor: '#30363d',
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
                  `$ ${formatPrice(Number(item.parsed.y))}`,
              },
            },
          },
          scales: {
            x: {
              type: 'linear',
              ticks: {
                color: '#8b949e',
                maxTicksLimit: 6,
                callback: (value) => this.currentFormatX(Number(value)),
              },
              grid: { color: 'rgba(48, 54, 61, 0.5)' },
            },
            y: {
              ticks: {
                color: '#8b949e',
                callback: (value) => formatPrice(Number(value)),
              },
              grid: { color: 'rgba(48, 54, 61, 0.5)' },
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
    dataset.borderColor = colors.line;
    dataset.backgroundColor = colors.fill;
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
