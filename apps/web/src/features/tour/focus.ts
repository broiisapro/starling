import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/** Tab stops inside the card. Disabled buttons are deliberately not focusable. */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keep Tab inside the dialog. `preventDefault` only fires at the wrap points, so ordinary movement
 * between the two or three buttons stays native (and predictable for screen readers).
 */
export function trapTab(event: ReactKeyboardEvent<HTMLElement>, card: HTMLElement | null): void {
  if (card === null) return;
  const items = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (items.length === 0) {
    event.preventDefault();
    card.focus();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  if (first === undefined || last === undefined) return;
  const active = typeof document === 'undefined' ? null : document.activeElement;
  // The card itself is focusable (tabIndex -1) but is not a Tab stop: treat it like "outside" so
  // Shift+Tab from a freshly focused dialog wraps to the last control instead of escaping.
  const inside = active instanceof Node && active !== card && card.contains(active);
  if (event.shiftKey) {
    if (!inside || active === first) {
      event.preventDefault();
      last.focus();
    }
    return;
  }
  if (!inside || active === last) {
    event.preventDefault();
    first.focus();
  }
}
