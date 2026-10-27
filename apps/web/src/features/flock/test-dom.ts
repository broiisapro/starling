import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/**
 * Minimal DOM harness for this lane. The repo's boot test drives `react-dom/client` directly
 * because `@testing-library/react` registers a `beforeAll` at import time that Bun's test runner
 * does not like (see docs/epic-00-foundation.md). Feature tests follow the same pattern.
 *
 * The root `bun run test` does not load `apps/web/bunfig.toml`, so every test file registers
 * happy-dom defensively and releases it in `afterAll`.
 */
export function ensureDom(): boolean {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (typeof document !== 'undefined') return false;
  GlobalRegistrator.register({ url: 'http://localhost/' });
  return true;
}

export function releaseDom(registeredHere: boolean): void {
  if (registeredHere) GlobalRegistrator.unregister();
}

export interface Mounted {
  container: HTMLElement;
  update(node: ReactNode): Promise<void>;
  click(target: Element | null): Promise<void>;
  unmount(): Promise<void>;
}

export async function mount(node: ReactNode): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  await act(async () => {
    root.render(node);
  });

  return {
    container,
    async update(next: ReactNode) {
      await act(async () => {
        root.render(next);
      });
    },
    async click(target: Element | null) {
      if (!target) throw new Error('expected an element to click');
      await act(async () => {
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        // Let async handlers (clipboard, state resets) settle inside act.
        await Promise.resolve();
        await Promise.resolve();
      });
    },
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

export function all(root: ParentNode, selector: string): Element[] {
  return [...root.querySelectorAll(selector)];
}

export function one(root: ParentNode, selector: string): Element {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`no element matched ${selector}`);
  return element;
}

export function text(root: ParentNode): string {
  return (root.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Replace `navigator.clipboard` with a recorder and return the captured writes. */
export function mockClipboard(): string[] {
  const writes: string[] = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (value: string) => {
        writes.push(value);
      },
    },
  });
  return writes;
}

export function restoreClipboard(): void {
  Reflect.deleteProperty(navigator, 'clipboard');
}

/** Wait inside `act` so timer-driven state updates are flushed without warnings. */
export async function wait(ms: number): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  });
}
