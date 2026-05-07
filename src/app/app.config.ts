import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { CRYPTO_PROVIDER } from './core/data';
import { MockCryptoProvider } from './core/data/providers/mock-crypto-provider';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    { provide: CRYPTO_PROVIDER, useExisting: MockCryptoProvider },
  ],
};
