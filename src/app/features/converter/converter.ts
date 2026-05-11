import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AsyncPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { PriceFlash } from '../../shared/price-flash/price-flash';
import { ConverterState } from './converter-state';

@Component({
  selector: 'app-converter',
  imports: [AsyncPipe, DecimalPipe, FormsModule, PriceFlash],
  providers: [ConverterState],
  templateUrl: './converter.html',
  styleUrl: './converter.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Converter {
  protected readonly state = inject(ConverterState);

  protected onFromCoinChange(id: string): void {
    this.state.setFromCoin(id);
  }

  protected onToCoinChange(id: string): void {
    this.state.setToCoin(id);
  }

  protected onFromAmountChange(value: number | null): void {
    this.state.setAmount('from', value ?? 0);
  }

  protected onToAmountChange(value: number | null): void {
    this.state.setAmount('to', value ?? 0);
  }

  protected onSwap(): void {
    this.state.swap();
  }

  protected onCurrencyChange(value: string): void {
    this.state.setVsCurrency(value);
  }

  protected priceDigits(price: number | undefined | null): string {
    if (price == null) return '1.2-2';
    if (price >= 1) return '1.2-2';
    if (price >= 0.01) return '1.4-4';
    return '1.6-8';
  }
}
