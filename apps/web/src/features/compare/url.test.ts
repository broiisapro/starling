import { describe, expect, test } from 'bun:test';
import { compareHref, compareSearch, parseCompareParams, pickerValue, writeCompareUrl } from './url';

describe('parseCompareParams', () => {
  test('reads a and b, tolerating the leading ?', () => {
    expect(parseCompareParams('?a=one&b=two')).toEqual({ a: 'one', b: 'two' });
    expect(parseCompareParams('a=one&b=two')).toEqual({ a: 'one', b: 'two' });
  });

  test('ignores blank and unrelated parameters', () => {
    expect(parseCompareParams('?demo=1&speed=4')).toEqual({});
    expect(parseCompareParams('?a=&b=')).toEqual({});
  });

  test('keeps b=baseline as the literal sentinel', () => {
    expect(parseCompareParams('?a=one&b=baseline')).toEqual({ a: 'one', b: 'baseline' });
  });
});

describe('compareSearch', () => {
  test('sets the pair and preserves demo/speed/run parameters', () => {
    const search = compareSearch('?demo=1&speed=4&run=old', 'a1', 'b1');
    const params = new URLSearchParams(search);
    expect(params.get('a')).toBe('a1');
    expect(params.get('b')).toBe('b1');
    expect(params.get('demo')).toBe('1');
    expect(params.get('speed')).toBe('4');
    expect(params.get('run')).toBe('old');
  });

  test('drops b when there is only one side', () => {
    expect(compareSearch('?a=old&b=old2', 'new', undefined)).toBe('?a=new');
  });
});

describe('compareHref', () => {
  test('keeps the hash and writes a shareable pair', () => {
    expect(compareHref({ search: '?demo=1', hash: '#/runs/x' }, 'one', 'two')).toBe(
      '?demo=1&a=one&b=two#/runs/x',
    );
  });
});

describe('writeCompareUrl', () => {
  test('calls history.replaceState without navigating', () => {
    const calls: Array<{ data: unknown; unused: string; url?: string | URL | null }> = [];
    const search = writeCompareUrl(
      'a1',
      'baseline',
      { replaceState: (data, unused, url) => calls.push({ data, unused, url }) },
      { search: '?speed=4', hash: '#/top' },
    );
    expect(search).toBe('?speed=4&a=a1&b=baseline');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('?speed=4&a=a1&b=baseline#/top');
  });

  test('is SSR-safe when history is absent', () => {
    expect(writeCompareUrl('a1', undefined, undefined, { search: '' })).toBe('?a=a1');
  });
});

describe('pickerValue', () => {
  test('maps the baseline flag to the sentinel', () => {
    expect(pickerValue(undefined, true)).toBe('baseline');
    expect(pickerValue('run-1', false)).toBe('run-1');
    expect(pickerValue(undefined, false)).toBe('baseline');
  });
});
