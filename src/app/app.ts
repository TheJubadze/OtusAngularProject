import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Store } from '@ngrx/store';
import { map } from 'rxjs';

import { CryptoProviderRegistry } from './core/data';
import { PrefsActions, prefsFeature } from './core/store/prefs';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, AsyncPipe],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly registry = inject(CryptoProviderRegistry);
  private readonly store = inject(Store);

  protected readonly theme$ = this.store.select(prefsFeature.selectTheme);
  /**
   * The icon shows the theme the button switches TO (sun ⇒ "click to go
   * light"), which is the convention most apps use — the button advertises
   * the destination, not the current state.
   */
  protected readonly themeLabel$ = this.theme$.pipe(
    map((t) => (t === 'dark' ? '☀' : '☾')),
  );

  protected onSelect(name: string): void {
    this.registry.setActive(name);
  }

  protected onToggleTheme(): void {
    this.store.dispatch(PrefsActions.toggleTheme());
  }
}
