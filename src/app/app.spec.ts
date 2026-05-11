import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideMockStore } from '@ngrx/store/testing';
import { EMPTY } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';

import { App } from './app';
import {
  CRYPTO_PROVIDER,
  CRYPTO_PROVIDER_REGISTRATION,
  CryptoDataProvider,
  ProviderRegistration,
} from './core/data';

/**
 * Minimal CryptoDataProvider that yields nothing — App only consults
 * the registry for available providers, never the impl itself, so the
 * methods stay empty.
 */
class StubProvider implements CryptoDataProvider {
  getMarkets = () => EMPTY;
  getQuote = () => EMPTY as never;
  getHistory = () => EMPTY;
  getCandles = () => EMPTY;
  liveCandles = () => EMPTY as never;
  searchCoins = () => EMPTY;
  liveQuotes = () => EMPTY as never;
  getSupportedVsCurrencies = () => EMPTY;
}

describe('App', () => {
  beforeEach(async () => {
    const stub = new StubProvider();
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        provideMockStore({
          initialState: {
            prefs: { theme: 'dark' as const, vsCurrency: 'usd' },
          },
        }),
        {
          provide: CRYPTO_PROVIDER_REGISTRATION,
          multi: true,
          useValue: {
            name: 'stub',
            label: 'Stub',
            impl: stub,
          } satisfies ProviderRegistration,
        },
        { provide: CRYPTO_PROVIDER, useValue: stub },
      ],
    }).compileComponents();
  });

  it('renders the shell with the brand title', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('h1')?.textContent).toContain('Crypto Platform');
  });

  it('shows a button for each registered provider', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const buttons = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '.provider-btn',
    );
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toContain('Stub');
  });
});
