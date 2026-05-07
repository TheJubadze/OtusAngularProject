import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { AsyncPipe, DatePipe, DecimalPipe, PercentPipe } from '@angular/common';
import { toObservable } from '@angular/core/rxjs-interop';
import {
  BehaviorSubject,
  Observable,
  catchError,
  combineLatest,
  distinctUntilChanged,
  map,
  of,
  scan,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs';

import { CRYPTO_PROVIDER } from '../../../core/data';
import {
  ALL_RANGES,
  Candle,
  HistoricalPoint,
  MarketRow,
  Range,
  rangeLabel,
} from '../../../core/domain';
import { CandleChart } from '../../../shared/candle-chart/candle-chart';
import { PriceChart } from '../../../shared/price-chart/price-chart';
import { PriceFlash } from '../../../shared/price-flash/price-flash';

export type ChartType = 'line' | 'candle';

type ChartState =
  | {
      readonly kind: 'line';
      readonly points: readonly HistoricalPoint[];
      readonly loading: boolean;
      readonly error: string | null;
    }
  | {
      readonly kind: 'candle';
      readonly candles: readonly Candle[];
      readonly loading: boolean;
      readonly error: string | null;
    };

interface HeaderChange {
  readonly pct: number | null;
  readonly label: string;
}

@Component({
  selector: 'app-coin-detail',
  imports: [
    AsyncPipe,
    DatePipe,
    DecimalPipe,
    PercentPipe,
    PriceChart,
    CandleChart,
    PriceFlash,
  ],
  templateUrl: './coin-detail.html',
  styleUrl: './coin-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CoinDetail {
  readonly coin = input.required<MarketRow>();
  readonly close = output<void>();

  private readonly provider = inject(CRYPTO_PROVIDER);
  private readonly rangeSubject = new BehaviorSubject<Range>('7d');
  private readonly chartTypeSubject = new BehaviorSubject<ChartType>('candle');

  readonly ranges = ALL_RANGES;
  readonly rangeLabel = rangeLabel;
  readonly range$ = this.rangeSubject.asObservable();
  readonly chartType$ = this.chartTypeSubject.asObservable();

  /**
   * coinId & vsCurrency tracked from the input signal so that switching
   * to a different row (without closing the panel) re-fetches the chart.
   */
  private readonly coinId$ = toObservable(
    computed(() => this.coin().id),
  ).pipe(distinctUntilChanged());
  private readonly vsCurrency$ = toObservable(
    computed(() => this.coin().vsCurrency),
  ).pipe(distinctUntilChanged());

  /**
   * Each new tick from the parent (driven by liveQuotes) becomes a chart
   * data point. We dedupe by (timestamp, price) so re-emissions caused by
   * unrelated state changes (sort, search) don't create phantom points.
   */
  private readonly liveTick$: Observable<HistoricalPoint> = toObservable(
    computed<HistoricalPoint>(() => ({
      timestamp: this.coin().updatedAt.getTime(),
      price: this.coin().price,
    })),
  ).pipe(
    distinctUntilChanged(
      (a, b) => a.timestamp === b.timestamp && a.price === b.price,
    ),
  );

  /**
   * Unified chart state stream that dispatches to either getHistory (line)
   * or getCandles (candle) based on chartType. Each branch maps into a
   * tagged-union ChartState so the template can switch on `state.kind`.
   * Switching the chart type kills the old branch via switchMap and starts
   * the new fetch — UI shows a loading state while we wait.
   */
  readonly chart$: Observable<ChartState> = combineLatest([
    this.coinId$,
    this.vsCurrency$,
    this.range$,
    this.chartType$.pipe(distinctUntilChanged()),
  ]).pipe(
    switchMap(([id, vs, range, type]) => {
      if (type === 'line') {
        return this.provider.getHistory(id, vs, range).pipe(
          switchMap((history) =>
            this.liveTick$.pipe(
              scan(
                (acc, tick) => appendTick(acc, tick),
                history as readonly HistoricalPoint[],
              ),
              startWith(history as readonly HistoricalPoint[]),
            ),
          ),
          map(
            (points): ChartState => ({
              kind: 'line',
              points,
              loading: false,
              error: null,
            }),
          ),
          startWith<ChartState>({
            kind: 'line',
            points: [],
            loading: true,
            error: null,
          }),
          catchError((err) =>
            of<ChartState>({
              kind: 'line',
              points: [],
              loading: false,
              error: err instanceof Error ? err.message : 'Failed to load',
            }),
          ),
        );
      }
      return this.provider.getCandles(id, vs, range).pipe(
        switchMap((candles) => {
          // Window stays the size of the initial fetch — as new candles
          // come in from the WebSocket, the oldest fall off the left,
          // producing the "auto-scroll" feel of pro trading terminals.
          const windowSize = Math.max(candles.length, 60);
          return this.provider.liveCandles(id, vs, range).pipe(
            scan(
              (acc, candle) => mergeCandle(acc, candle, windowSize),
              candles as readonly Candle[],
            ),
            startWith(candles as readonly Candle[]),
          );
        }),
        map(
          (candles): ChartState => ({
            kind: 'candle',
            candles,
            loading: false,
            error: null,
          }),
        ),
        startWith<ChartState>({
          kind: 'candle',
          candles: [],
          loading: true,
          error: null,
        }),
        catchError((err) =>
          of<ChartState>({
            kind: 'candle',
            candles: [],
            loading: false,
            error: err instanceof Error ? err.message : 'Failed to load',
          }),
        ),
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  /**
   * Header percentage shown next to the price. Computed from the actual
   * chart points (first vs last) and the selected range — so when the
   * user picks 1M, the % reflects the change over the visible minute,
   * not the unrelated 24h figure baked into the row.
   */
  readonly headerChange$: Observable<HeaderChange> = combineLatest([
    this.chart$,
    this.range$,
  ]).pipe(
    map(([state, range]): HeaderChange => {
      const label = rangeLabel(range);
      let first: number | undefined;
      let last: number | undefined;
      if (state.kind === 'line' && state.points.length >= 2) {
        first = state.points[0].price;
        last = state.points[state.points.length - 1].price;
      } else if (state.kind === 'candle' && state.candles.length >= 2) {
        first = state.candles[0].open;
        last = state.candles[state.candles.length - 1].close;
      }
      if (first == null || last == null || first === 0) {
        return { pct: null, label };
      }
      return { pct: ((last - first) / first) * 100, label };
    }),
  );

  protected setRange(range: Range): void {
    if (this.rangeSubject.value !== range) this.rangeSubject.next(range);
  }

  protected setChartType(type: ChartType): void {
    if (this.chartTypeSubject.value !== type) {
      this.chartTypeSubject.next(type);
    }
  }

  protected onClose(): void {
    this.close.emit();
  }

  protected onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.onClose();
  }

  protected priceDigits(price: number): string {
    if (price >= 1) return '1.2-2';
    if (price >= 0.01) return '1.4-4';
    return '1.6-6';
  }
}

/**
 * Append a live tick to the series. If the new timestamp is older than the
 * tail (out-of-order replay) we ignore it; if it equals the tail's stamp
 * we replace (refresh price for the same bucket); otherwise we append.
 */
function appendTick(
  points: readonly HistoricalPoint[],
  tick: HistoricalPoint,
): readonly HistoricalPoint[] {
  if (points.length === 0) return [tick];
  const last = points[points.length - 1];
  if (tick.timestamp < last.timestamp) return points;
  if (tick.timestamp === last.timestamp) {
    return [...points.slice(0, -1), tick];
  }
  return [...points, tick];
}

/**
 * Merges a candle update from `liveCandles` into the visible series.
 * Three cases:
 *   - Same timestamp as the tail → in-progress update (replace tail).
 *   - Newer timestamp → append, dropping the oldest if we exceed the
 *     window. The drop-from-left is what produces the auto-scroll
 *     animation as time progresses.
 *   - Older timestamp → out-of-order replay, ignore.
 */
function mergeCandle(
  candles: readonly Candle[],
  incoming: Candle,
  maxWindow: number,
): readonly Candle[] {
  if (candles.length === 0) return [incoming];
  const last = candles[candles.length - 1];
  if (incoming.timestamp === last.timestamp) {
    return [...candles.slice(0, -1), incoming];
  }
  if (incoming.timestamp < last.timestamp) return candles;
  const next = [...candles, incoming];
  return next.length > maxWindow ? next.slice(-maxWindow) : next;
}
