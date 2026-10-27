// biome-ignore-all lint/suspicious/noArrayIndexKey: rendered markdown fragments are positional
import type { ReactNode } from 'react';

/**
 * Markdown-lite for agent prose: fenced code blocks, inline code spans, and paragraphs with hard
 * line breaks. Deliberately not a Markdown engine — agent text arrives from an untrusted model, so we
 * never inject HTML. Anything richer belongs in a later epic.
 */
export type MarkdownBlock = { kind: 'code'; lang: string; code: string } | { kind: 'prose'; text: string };

export function parseMarkdownLite(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let prose: string[] = [];
  let code: string[] | undefined;
  let lang = '';

  const flushProse = () => {
    const joined = prose.join('\n').trim();
    if (joined.length > 0) blocks.push({ kind: 'prose', text: joined });
    prose = [];
  };

  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      if (code === undefined) {
        flushProse();
        code = [];
        lang = line.trim().slice(3).trim();
      } else {
        blocks.push({ kind: 'code', lang, code: code.join('\n') });
        code = undefined;
        lang = '';
      }
      continue;
    }
    if (code !== undefined) code.push(line);
    else prose.push(line);
  }

  // An unterminated fence still renders as code rather than leaking backticks into a paragraph.
  if (code !== undefined) blocks.push({ kind: 'code', lang, code: code.join('\n') });
  flushProse();
  return blocks;
}

/** Split prose into plain strings and `code` spans. */
export function inlineParts(text: string): { code: boolean; text: string }[] {
  const parts: { code: boolean; text: string }[] = [];
  const pattern = /`([^`\n]+)`/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) parts.push({ code: false, text: text.slice(cursor, start) });
    parts.push({ code: true, text: match[1] ?? '' });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) parts.push({ code: false, text: text.slice(cursor) });
  return parts;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return inlineParts(text).map((part, index) =>
    part.code ? (
      <code
        key={`${keyPrefix}-c${index}`}
        className="rounded bg-slate-800/80 px-1 py-0.5 font-mono text-[12px] text-sky-200"
      >
        {part.text}
      </code>
    ) : (
      <span key={`${keyPrefix}-t${index}`}>{part.text}</span>
    ),
  );
}

export function MarkdownLite({ text }: { text: string }) {
  const blocks = parseMarkdownLite(text);
  return (
    <div className="space-y-2" data-testid="markdown-lite">
      {blocks.map((block, index) =>
        block.kind === 'code' ? (
          <pre
            key={`b${index}`}
            className="overflow-x-auto rounded-md border border-slate-800 bg-slate-950/90 p-2 font-mono text-[12px] leading-relaxed text-slate-200"
          >
            <code data-lang={block.lang || undefined}>{block.code}</code>
          </pre>
        ) : (
          <p key={`b${index}`} className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
            {renderInline(block.text, `b${index}`)}
          </p>
        ),
      )}
    </div>
  );
}
