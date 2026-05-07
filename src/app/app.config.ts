import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { environment } from '../environments/environment';
import { routes } from './app.routes';
import {
  CRYPTO_PROVIDER,
  CRYPTO_PROVIDER_REGISTRATION,
  ProviderRegistration,
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

    // CoinGecko demo-plan API key. Pulled from environment.ts (committed,
    // empty by default) or environment.local.ts (gitignored). Run
    // `npm run start:local` to use the local file.
    { provide: COINGECKO_API_KEY, useValue: environment.coingeckoApiKey },

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
