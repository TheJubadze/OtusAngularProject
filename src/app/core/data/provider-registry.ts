import { Inject, Injectable } from '@angular/core';
import { BehaviorSubject, Observable, distinctUntilChanged, map } from 'rxjs';

import { CryptoDataProvider } from './crypto-data-provider';
import {
  CRYPTO_PROVIDER_REGISTRATION,
  ProviderRegistration,
} from './provider-registration';

/**
 * Holds all registered providers and tracks the active one.
 * The UI reads `available` and `activeName$` to render a switcher;
 * the routing provider subscribes to `active$` to delegate calls.
 */
@Injectable({ providedIn: 'root' })
export class CryptoProviderRegistry {
  readonly available: readonly ProviderRegistration[];
  readonly activeName$: Observable<string>;
  readonly active$: Observable<CryptoDataProvider>;

  private readonly byName: ReadonlyMap<string, CryptoDataProvider>;
  private readonly activeNameSubject: BehaviorSubject<string>;

  constructor(
    @Inject(CRYPTO_PROVIDER_REGISTRATION)
    registrations: readonly ProviderRegistration[],
  ) {
    if (!registrations || registrations.length === 0) {
      throw new Error('CryptoProviderRegistry: no providers registered');
    }
    this.available = registrations;
    this.byName = new Map(registrations.map((r) => [r.name, r.impl]));
    this.activeNameSubject = new BehaviorSubject<string>(registrations[0].name);

    this.activeName$ = this.activeNameSubject.asObservable();
    this.active$ = this.activeName$.pipe(
      distinctUntilChanged(),
      map((name) => {
        const impl = this.byName.get(name);
        if (!impl) {
          throw new Error(
            `CryptoProviderRegistry: unknown provider "${name}"`,
          );
        }
        return impl;
      }),
    );
  }

  setActive(name: string): void {
    if (!this.byName.has(name)) {
      throw new Error(`CryptoProviderRegistry: unknown provider "${name}"`);
    }
    this.activeNameSubject.next(name);
  }

  get activeName(): string {
    return this.activeNameSubject.value;
  }

  /**
   * Synchronous accessor for the currently active provider. Used by the
   * routing provider to capture a snapshot at subscribe time, so that one
   * call's lifecycle is bound to one provider — switching providers does
   * not magically swap the underlying source mid-stream.
   */
  get active(): CryptoDataProvider {
    const impl = this.byName.get(this.activeNameSubject.value);
    if (!impl) {
      throw new Error(
        `CryptoProviderRegistry: unknown provider "${this.activeNameSubject.value}"`,
      );
    }
    return impl;
  }
}
