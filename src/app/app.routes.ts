import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'watchlist' },
  {
    path: 'watchlist',
    loadComponent: () =>
      import('./features/watchlist/watchlist').then((m) => m.Watchlist),
  },
  { path: '**', redirectTo: 'watchlist' },
];
