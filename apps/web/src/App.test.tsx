import { afterAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

// `apps/web/bunfig.toml` preloads happy-dom when tests run from this package. The root
// `bun run test` does not load nested bunfig files, so register here too (idempotently).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const registeredHere = typeof document === 'undefined';
if (registeredHere) GlobalRegistrator.register({ url: 'http://localhost/' });

test('renders the boot page into a happy-dom document', async () => {
  const [{ act }, { createRoot }, { default: App }, { PACKAGE }, { PACKAGE: CORE_PACKAGE }] =
    await Promise.all([
      import('react'),
      import('react-dom/client'),
      import('./App'),
      import('./index'),
      import('@starling/core'),
    ]);

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<App />);
  });

  expect(container.textContent).toContain('the sky is loading');
  expect(container.textContent).toContain('murmuration');
  expect(container.querySelector('svg')).not.toBeNull();
  expect(PACKAGE).toBe('@starling/web');
  expect(CORE_PACKAGE).toBe('@starling/core');

  await act(async () => {
    root.unmount();
  });
  container.remove();
});

test('feature folders exist for every dashboard lane', async () => {
  const features = ['about', 'agents', 'dag', 'flock', 'launch', 'metrics', 'queue', 'sky'] as const;
  for (const name of features) {
    const mod = await import(`./features/${name}/index.ts`);
    expect(mod.FEATURE).toBe(name);
  }
});

afterAll(() => {
  if (registeredHere) GlobalRegistrator.unregister();
});
