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
  TimeScale,
} from 'chart.js';

import { HistoricalPoint } from '../../core/domain';

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  TimeScale,
  Filler,
);

export type Trend = 'up' | 'down' | 'neutral';

const COLORS: Record<Trend, { line: string; fill: string }> = {
  up: { line: '#3fb950', fill: 'rgba(63, 185, 80, 0.15)' },
  down: { line: '#f85149', fill: 'rgba(248, 81, 73, 0.15)' },
  neutral: { line: '#58a6ff', fill: 'rgba(88, 166, 255, 0.15)' },
};

@Component({
  selector: 'app-sparkline',
  template: '<canvas #canvas></canvas>',
  styles: [`
    :host {
      display: block;
      width: 120px;
      height: 36px;
    }
    canvas {
      width: 100% !important;
      height: 100% !important;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Sparkline implements OnDestroy {
  readonly points = input.required<readonly HistoricalPoint[] | null | undefined>();
  readonly trend = input<Trend>('neutral');

  private readonly canvasRef =
    viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

  private chart?: Chart<'line'>;

  constructor() {
    effect(() => {
      const points = this.points();
      const trend = this.trend();
      this.render(points ?? [], trend);
    });
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
    this.chart = undefined;
  }

  private render(points: readonly HistoricalPoint[], trend: Trend): void {
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
              borderWidth: 1.5,
              pointRadius: 0,
              tension: 0.3,
              fill: true,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
          scales: {
            x: { display: false, type: 'linear' },
            y: { display: false },
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
