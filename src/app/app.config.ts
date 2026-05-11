import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideEffects } from '@ngrx/effects';
import { provideStore, provideState } from '@ngrx/store';
import { provideStoreDevtools } from '@ngrx/store-devtools';

import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { PrefsEffects, prefsFeature } from './core/store/prefs';
import { WalletEffects, walletFeature } from './core/store/wallet';
import {
  CRYPTO_PROVIDER,
  CRYPTO_PROVIDER_REGISTRATION,
  ProviderRegistration,
  WALLET_API_BASE_URL,
} from './core/data';
import { BinanceCryptoProvider } from './core/data/providers/binance-crypto-provider';
import {
  COINGECKO_API_KEY,
  CoinGeckoCryptoProvider,
} from './core/data/providers/coingecko-crypto-provider';
import { MockCryptoProvider } from './core/data/providers/mock-crypto-provider';
import { RoutingCryptoProvider } from './core/data/providers/routing-crypto-provider';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(),

    // NgRx: empty root store + per-feature slices, with effects driving
    // the wallet's HTTP traffic against json-server. DevTools enabled in
    // dev for action/state inspection.
    provideStore(),
    provideState(prefsFeature),
    provideState(walletFeature),
    provideEffects(PrefsEffects, WalletEffects),
    provideStoreDevtools({
      maxAge: 50,
      logOnly: !isDevMode(),
      autoPause: true,
    }),

    // CoinGecko demo-plan API key. Pulled from environment.ts (committed,
    // empty by default) or environment.local.ts (gitignored). Run
    // `npm run start:local` to use the local file.
    { provide: COINGECKO_API_KEY, useValue: environment.coingeckoApiKey },

    // Fake-backend (json-server) base URL for the Wallet feature. Run the
    // server with `npm run wallet:server` in parallel with `npm start`.
    { provide: WALLET_API_BASE_URL, useValue: environment.walletApiBaseUrl },

    {
      provide: CRYPTO_PROVIDER_REGISTRATION,
      multi: true,
      deps: [MockCryptoProvider],
      useFactory: (impl: MockCryptoProvider): ProviderRegistration => ({
        name: 'mock',
        label: 'Mock',
        impl,
      }),
    },
    {
      provide: CRYPTO_PROVIDER_REGISTRATION,
      multi: true,
      deps: [CoinGeckoCryptoProvider],
      useFactory: (impl: CoinGeckoCryptoProvider): ProviderRegistration => ({
        name: 'coingecko',
        label: 'CoinGecko',
        impl,
      }),
    },
    {
      provide: CRYPTO_PROVIDER_REGISTRATION,
      multi: true,
      deps: [BinanceCryptoProvider],
      useFactory: (impl: BinanceCryptoProvider): ProviderRegistration => ({
        name: 'binance',
        label: 'Binance Live',
        impl,
      }),
    },

    { provide: CRYPTO_PROVIDER, useClass: RoutingCryptoProvider },
  ],
};
