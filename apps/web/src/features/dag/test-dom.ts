/**
 * happy-dom is missing a few browser APIs React Flow touches. Installed from tests (and playgrounds)
 * rather than apps/web/src/test-setup.ts because that file is owned by the shell lane.
 */
export function installDomShims(): void {
  const scope = globalThis as { ResizeObserver?: unknown; DOMMatrixReadOnly?: unknown };

  if (typeof scope.ResizeObserver === 'undefined') {
    class ResizeObserverShim {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    scope.ResizeObserver = ResizeObserverShim;
  }

  if (typeof scope.DOMMatrixReadOnly === 'undefined') {
    class DOMMatrixReadOnlyShim {
      m22 = 1;
    }
    scope.DOMMatrixReadOnly = DOMMatrixReadOnlyShim;
  }
}
