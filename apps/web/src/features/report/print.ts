/**
 * The report page's only side effect. Guarded because happy-dom, unit tests and an embedded webview
 * may all lack `window.print`; a button that throws is worse than one that does nothing.
 */
export function printPage(target?: Window): boolean {
  const win = target ?? (typeof window === 'undefined' ? undefined : window);
  if (win === undefined || typeof win.print !== 'function') return false;
  win.print();
  return true;
}
