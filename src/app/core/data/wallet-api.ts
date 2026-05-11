import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { Holding, Transaction } from '../domain';

/**
 * Base URL of the json-server fake backend that persists wallet data.
 * Provided from `environment.ts` so dev/test/prod can point to different
 * instances without rebuilding the API service.
 */
export const WALLET_API_BASE_URL = new InjectionToken<string>(
  'WALLET_API_BASE_URL',
);

/**
 * Thin REST client over json-server (https://github.com/typicode/json-server).
 * One method per endpoint, no caching, no transformation beyond what's needed
 * to keep our domain types clean (e.g. coercing the auto-assigned `id` to
 * string — json-server v0.17 sometimes returns numeric ids).
 */
@Injectable({ providedIn: 'root' })
export class WalletApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(WALLET_API_BASE_URL);

  listHoldings(): Observable<Holding[]> {
    return this.http
      .get<Holding[]>(`${this.baseUrl}/holdings`)
      .pipe(map((rows) => rows.map(normalizeHolding)));
  }

  createHolding(holding: Holding): Observable<Holding> {
    return this.http
      .post<Holding>(`${this.baseUrl}/holdings`, holding)
      .pipe(map(normalizeHolding));
  }

  updateHolding(id: string, patch: Partial<Holding>): Observable<Holding> {
    return this.http
      .patch<Holding>(`${this.baseUrl}/holdings/${id}`, patch)
      .pipe(map(normalizeHolding));
  }

  deleteHolding(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/holdings/${id}`);
  }

  /**
   * Fetched newest-first so the UI doesn't have to re-sort. `_sort`/`_order`
   * are the canonical json-server v0.17 query parameters.
   */
  listTransactions(): Observable<Transaction[]> {
    return this.http
      .get<Transaction[]>(
        `${this.baseUrl}/transactions?_sort=createdAt&_order=desc`,
      )
      .pipe(map((rows) => rows.map(normalizeTransaction)));
  }

  createTransaction(transaction: Transaction): Observable<Transaction> {
    return this.http
      .post<Transaction>(`${this.baseUrl}/transactions`, transaction)
      .pipe(map(normalizeTransaction));
  }
}

function normalizeHolding(raw: Holding): Holding {
  return { ...raw, id: String(raw.id) };
}

function normalizeTransaction(raw: Transaction): Transaction {
  return { ...raw, id: String(raw.id) };
}
