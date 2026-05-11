import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';

/**
 * Search input shared by feature screens. Encapsulates the typing →
 * debounce → distinct pipeline so each consumer can just bind a value
 * and receive the *settled* string after the user stops typing.
 *
 * `value` flows one way: it sets the input on mount and reacts to
 * external programmatic resets (e.g. when the parent clears state),
 * but typing does NOT push back through it — the parent gets the
 * settled value via `valueChange`.
 */
@Component({
  selector: 'app-search-box',
  imports: [FormsModule],
  template: `
    <input
      type="search"
      class="search-box__input"
      [ngModel]="value()"
      (ngModelChange)="onChange($event)"
      [ngModelOptions]="{ standalone: true }"
      [placeholder]="placeholder()"
    />
  `,
  styles: [`
    :host {
      display: inline-block;
    }
    .search-box__input {
      width: 100%;
      padding: 0.5rem 0.75rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 0.9rem;
      box-sizing: border-box;
    }
    .search-box__input:focus {
      outline: none;
      border-color: var(--accent);
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchBox {
  readonly value = input<string>('');
  readonly placeholder = input<string>('Search…');
  readonly debounceMs = input<number>(200);
  readonly valueChange = output<string>();

  private readonly typing = new Subject<string>();

  constructor() {
    // Sampled once at construction. `debounceTime` doesn't dynamically
    // re-tune from a changing input signal; if a host ever needs to flip
    // debounceMs at runtime we'd switch to a per-emission `debounce()`,
    // but that's overkill for current callers.
    const ms = this.debounceMs();
    this.typing
      .pipe(
        debounceTime(ms),
        distinctUntilChanged(),
        takeUntilDestroyed(),
      )
      .subscribe((v) => this.valueChange.emit(v));
  }

  protected onChange(value: string): void {
    this.typing.next(value);
  }
}
