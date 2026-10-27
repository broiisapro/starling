import { afterEach, describe, expect, test } from 'bun:test';
import { ensureDom } from '../../lib/test-dom';
import { birdAvatar } from './avatar';
import { BirdAvatar } from './BirdAvatar';

ensureDom();
const { cleanup, render } = await import('@testing-library/react');

afterEach(cleanup);

describe('BirdAvatar', () => {
  test('is decorative: the label next to it does the talking', () => {
    const { container } = render(<BirdAvatar seed="dates-fix" />);
    const svg = container.querySelector('[data-testid="bird-avatar"]');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('focusable')).toBe('false');
    expect(svg?.querySelector('title')).toBeNull();
  });

  test('exposes the generated pattern and eye for debugging', () => {
    const spec = birdAvatar('theme');
    const { container } = render(<BirdAvatar seed="theme" />);
    const svg = container.querySelector('[data-testid="bird-avatar"]');
    expect(svg?.getAttribute('data-pattern')).toBe(spec.pattern);
    expect(svg?.getAttribute('data-eye')).toBe(spec.eye);
  });

  test('clamps its size to the 16–24 px brief', () => {
    const tiny = render(<BirdAvatar seed="alpha" size={4} />);
    const small = tiny.container.querySelector('[data-testid="bird-avatar"]');
    expect(small?.getAttribute('width')).toBe('16');
    expect(small?.getAttribute('height')).toBe('16');
    tiny.unmount();

    const huge = render(<BirdAvatar seed="alpha" size={99} />);
    const big = huge.container.querySelector('[data-testid="bird-avatar"]');
    expect(big?.getAttribute('width')).toBe('24');
    huge.unmount();

    const normal = render(<BirdAvatar seed="alpha" />);
    expect(normal.container.querySelector('[data-testid="bird-avatar"]')?.getAttribute('width')).toBe('20');
  });

  test('the same seed draws the same bird and different seeds do not', () => {
    const first = render(<BirdAvatar seed="theme" />);
    const themePattern = first.container
      .querySelector('[data-testid="bird-avatar"]')
      ?.getAttribute('data-pattern');
    first.unmount();

    const again = render(<BirdAvatar seed="theme" />);
    expect(again.container.querySelector('[data-testid="bird-avatar"]')?.getAttribute('data-pattern')).toBe(
      themePattern,
    );
  });

  test('two avatars never share a gradient id', () => {
    const { container } = render(
      <>
        <BirdAvatar seed="theme" />
        <BirdAvatar seed="theme" />
      </>,
    );
    const gradients = [...container.querySelectorAll('linearGradient')].map((node) =>
      node.getAttribute('id'),
    );
    expect(gradients).toHaveLength(2);
    expect(gradients[0]).not.toBe(gradients[1]);
  });

  test('draws one clipped speckle per generated feather mark', () => {
    const spec = birdAvatar('hub');
    const { container } = render(<BirdAvatar seed="hub" />);
    const clipped = container.querySelector('g[clip-path]');
    expect(clipped).not.toBeNull();
    expect(clipped?.children.length).toBe(spec.speckles.length);
  });
});
