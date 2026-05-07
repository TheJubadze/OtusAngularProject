import {
  Directive,
  ElementRef,
  OnDestroy,
  OnChanges,
  SimpleChanges,
  inject,
  input,
} from '@angular/core';

/**
 * Adds a brief background-flash animation to its host element whenever the
 * bound numeric value changes — green flash on increase, red on decrease.
 *
 * Usage:
 *   <td [appPriceFlash]="row.price">{{ row.price | number }}</td>
 *
 * Pairs with `.flash-up` / `.flash-down` keyframe animations defined in the
 * consumer's stylesheet.
 */
@Directive({
  selector: '[appPriceFlash]',
  standalone: true,
})
export class PriceFlash implements OnChanges, OnDestroy {
  readonly appPriceFlash = input<number | undefined | null>();

  private readonly el = inject(ElementRef<HTMLElement>);
  private prev: number | undefined;
  private resetTimer: ReturnType<typeof setTimeout> | undefined;

  ngOnChanges(_: SimpleChanges): void {
    const next = this.appPriceFlash();
    const prev = this.prev;
    this.prev = next ?? undefined;

    if (prev === undefined || next === undefined || next === null) return;
    if (next === prev) return;

    const cls = next > prev ? 'flash-up' : 'flash-down';
    const host = this.el.nativeElement;

    // Remove any in-flight flash classes; force a reflow so re-adding the
    // class restarts the CSS animation from frame 0.
    host.classList.remove('flash-up', 'flash-down');
    void host.offsetWidth;
    host.classList.add(cls);

    if (this.resetTimer) clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => {
      host.classList.remove(cls);
      this.resetTimer = undefined;
    }, 700);
  }

  ngOnDestroy(): void {
    if (this.resetTimer) clearTimeout(this.resetTimer);
  }
}
