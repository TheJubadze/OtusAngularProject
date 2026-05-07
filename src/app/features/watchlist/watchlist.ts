import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AsyncPipe, DecimalPipe, PercentPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MarketSortField } from '../../core/data';
import { Sparkline, Trend } from '../../shared/sparkline/sparkline';
import { WatchlistState } from './watchlist-state';

@Component({
  selector: 'app-watchlist',
  imports: [AsyncPipe, DecimalPipe, PercentPipe, FormsModule, Sparkline],
  providers: [WatchlistState],
  templateUrl: './watchlist.html',
  styleUrl: './watchlist.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Watchlist {
  protected readonly state = inject(WatchlistState);

  protected trendOf(change: number | undefined): Trend {
    if (change === undefined || change === 0) return 'neutral';
    return change > 0 ? 'up' : 'down';
  }

  protected onSearch(value: string): void {
    this.state.setSearch(value);
  }

  protected onCurrencyChange(value: string): void {
    this.state.setVsCurrency(value);
  }

  protected onSort(field: MarketSortField): void {
    this.state.toggleSort(field);
  }

  protected priceDigits(price: number): string {
    if (price >= 1) return '1.2-2';
    if (price >= 0.01) return '1.4-4';
    return '1.6-6';
  }
}
