import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AsyncPipe, DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { Holding, MarketRow } from '../../core/domain';
import { PriceFlash } from '../../shared/price-flash/price-flash';
import { WalletState } from './wallet-state';

@Component({
  selector: 'app-wallet',
  imports: [AsyncPipe, DatePipe, DecimalPipe, FormsModule, PriceFlash],
  providers: [WalletState],
  templateUrl: './wallet.html',
  styleUrl: './wallet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Wallet {
  protected readonly state = inject(WalletState);

  protected depositCoinId: string | null = null;
  protected depositAmount: number | null = null;
  protected depositNote = '';

  protected sendCoinId: string | null = null;
  protected sendAmount: number | null = null;
  protected sendNote = '';

  protected onSearch(value: string): void {
    this.state.setSearch(value);
  }

  protected onCurrencyChange(value: string): void {
    this.state.setVsCurrency(value);
  }

  protected onRowClick(coinId: string, currentSelected: string | null): void {
    // Toggle: clicking the already-selected row clears the filter.
    this.state.selectCoin(currentSelected === coinId ? null : coinId);
  }

  protected onClearSelection(): void {
    this.state.selectCoin(null);
  }

  protected onDismissError(): void {
    this.state.clearError();
  }

  protected onDepositSubmit(coins: readonly MarketRow[]): void {
    const id = this.depositCoinId;
    const amount = this.depositAmount;
    if (!id || amount == null || !(amount > 0)) return;
    const coin = coins.find((c) => c.id === id);
    if (!coin) return;
    const note = this.depositNote.trim();
    this.state.deposit({
      coinId: coin.id,
      symbol: coin.symbol,
      name: coin.name,
      amount,
      note: note || undefined,
    });
    this.depositAmount = null;
    this.depositNote = '';
  }

  protected onSendSubmit(holdings: readonly Holding[]): void {
    const id = this.sendCoinId;
    const amount = this.sendAmount;
    if (!id || amount == null || !(amount > 0)) return;
    const holding = holdings.find((h) => h.coinId === id);
    if (!holding) return;
    const note = this.sendNote.trim();
    this.state.send({
      coinId: holding.coinId,
      symbol: holding.symbol,
      name: holding.name,
      amount,
      note: note || undefined,
    });
    this.sendAmount = null;
    this.sendNote = '';
  }

  protected onSendMax(holdings: readonly Holding[]): void {
    const id = this.sendCoinId;
    if (!id) return;
    const holding = holdings.find((h) => h.coinId === id);
    if (!holding) return;
    this.sendAmount = holding.amount;
  }

  protected priceDigits(price: number | undefined): string {
    if (price == null) return '1.2-2';
    if (price >= 1) return '1.2-2';
    if (price >= 0.01) return '1.4-4';
    return '1.6-8';
  }

  protected amountDigits(amount: number): string {
    if (amount >= 1) return '1.2-6';
    if (amount >= 0.0001) return '1.4-8';
    return '1.6-10';
  }
}
