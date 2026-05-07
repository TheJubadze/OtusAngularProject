import { InjectionToken } from '@angular/core';

import { CryptoDataProvider } from './crypto-data-provider';

export interface ProviderRegistration {
  readonly name: string;
  readonly label: string;
  readonly impl: CryptoDataProvider;
}

/**
 * Multi-provider token. Each implementation registers itself here so the
 * registry sees them all and can offer them as runtime-switchable options.
 */
export const CRYPTO_PROVIDER_REGISTRATION = new InjectionToken<
  readonly ProviderRegistration[]
>('CRYPTO_PROVIDER_REGISTRATION');
