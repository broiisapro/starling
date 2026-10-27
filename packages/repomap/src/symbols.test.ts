import { describe, expect, test } from 'bun:test';
import { extractSymbols, SYMBOL_CAP } from './symbols';

describe('TypeScript / JavaScript symbols', () => {
  test('captures exported declarations in source order', () => {
    const source = `
export interface Options { a: string }
export type Mode = 'a' | 'b'
export const MAX = 10
export let counter = 0
export class Store {}
export enum Color { Red }
export async function loadThing() {}
export default function boot() {}
export { helper, other as renamed, type Shape }
`;
    expect(extractSymbols(source, 'typescript')).toEqual([
      'Options',
      'Mode',
      'MAX',
      'counter',
      'Store',
      'Color',
      'loadThing',
      'boot',
      'helper',
      'renamed',
      'Shape',
    ]);
  });

  test('captures CommonJS exports too', () => {
    const source = `
exports.legacy = 1
module.exports.older = 2
const local = 3
`;
    expect(extractSymbols(source, 'javascript')).toEqual(['legacy', 'older']);
  });

  test('handles anonymous default expressions without inventing keywords', () => {
    const source = `
export default function () {}
export default bootApp;
`;
    expect(extractSymbols(source, 'typescript')).toEqual(['bootApp']);
  });

  test(`caps a file at ${SYMBOL_CAP} symbols`, () => {
    const source = Array.from({ length: 50 }, (_, i) => `export function fn${i}() {}`).join('\n');
    const symbols = extractSymbols(source, 'typescript');
    expect(symbols).toHaveLength(SYMBOL_CAP);
    expect(symbols[0]).toBe('fn0');
    expect(symbols.at(-1)).toBe(`fn${SYMBOL_CAP - 1}`);
  });
});

describe('other language families', () => {
  test('Python captures only top-level defs and classes', () => {
    const source = `def top():
    pass

class Thing:
    def method(self):
        pass

async def fetch():
    pass
`;
    expect(extractSymbols(source, 'python')).toEqual(['top', 'Thing', 'fetch']);
  });

  test('Go captures functions, methods and types', () => {
    const source = `package main

func Run() {}
func (s *Server) Stop() {}
type Config struct{}
`;
    expect(extractSymbols(source, 'go')).toEqual(['Run', 'Stop', 'Config']);
  });

  test('Rust captures pub items, methods and private top-level items', () => {
    const source = `pub fn start() {}
pub(crate) struct Thing;
pub enum Mode {}
pub async fn serve() {}
fn private() {}

impl Thing {
    pub fn method(&self) {}
    fn hidden_method(&self) {}
}
`;
    expect(extractSymbols(source, 'rust')).toEqual([
      'start',
      'Thing',
      'Mode',
      'serve',
      'private',
      'method',
    ]);
  });
  test('CSS captures top-level class selectors only', () => {
    const source = `.a { color: red }
.b, .c:hover { color: blue }
@media (min-width: 10px) {
  .nested { color: green }
}
.d {}
`;
    expect(extractSymbols(source, 'css')).toEqual(['a', 'b', 'c', 'd']);
  });

  test('CSS caps at 20 selectors', () => {
    const source = Array.from({ length: 30 }, (_, i) => `.class-${i} {}`).join('\n');
    expect(extractSymbols(source, 'css')).toHaveLength(20);
  });

  test('Markdown headings are prose, not symbols', () => {
    const source = `# Title

## Section One

### Not included
`;
    expect(extractSymbols(source, 'markdown')).toEqual([]);
  });

  test('returns nothing for languages without an extractor', () => {
    expect(extractSymbols('{"a":1}', 'json')).toEqual([]);
    expect(extractSymbols('key: value', 'yaml')).toEqual([]);
    expect(extractSymbols('<div></div>', 'html')).toEqual([]);
  });
});
