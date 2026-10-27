/**
 * Copy-to-clipboard for the command strips.
 *
 * Every button is declared in the HTML with `data-copy` and an aria-label; its text comes from the
 * nearest `<code>`. Comment lines (`# …`) are dropped so a judge pastes runnable commands.
 */

const COPY_ICON =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.6"/><path d="M10.5 3.5v-1a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8.5 3.2 3.2L13 4.8"/></svg>';

/** Pull the runnable text out of a code block: comments removed, blank edges trimmed. */
export function copyableText(code: { textContent: string | null } | null): string {
  if (code === null) return '';
  const lines = (code.textContent ?? '').split('\n').filter((line) => !line.trimStart().startsWith('#'));
  while (lines.length > 0 && (lines[0] ?? '').trim() === '') lines.shift();
  while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') lines.pop();
  return lines.join('\n');
}

function legacyCopy(text: string, doc: Document): boolean {
  const area = doc.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  doc.body.append(area);
  area.select();
  let copied = false;
  try {
    copied = doc.execCommand('copy');
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

export function mountCopyButtons(doc: Document = document): void {
  const status = doc.querySelector<HTMLElement>('#copy-status');
  const timers = new WeakMap<HTMLButtonElement, number>();

  for (const button of doc.querySelectorAll<HTMLButtonElement>('button[data-copy]')) {
    button.innerHTML = COPY_ICON;

    button.addEventListener('click', () => {
      const container = button.closest('.runline, .skill-cmd, .term-line') ?? button.parentElement;
      const text = copyableText(container?.querySelector('code') ?? null);
      if (text === '') return;

      const clipboard = navigator.clipboard;
      const write =
        clipboard === undefined
          ? Promise.resolve(legacyCopy(text, doc))
          : clipboard.writeText(text).then(
              () => true,
              () => legacyCopy(text, doc),
            );

      void write.then((ok) => {
        if (!ok) {
          if (status !== null) status.textContent = 'Copy failed — select the command and copy it by hand.';
          return;
        }
        button.classList.add('is-copied');
        button.innerHTML = CHECK_ICON;
        if (status !== null) status.textContent = 'Copied to clipboard.';

        const existing = timers.get(button);
        if (existing !== undefined) window.clearTimeout(existing);
        timers.set(
          button,
          window.setTimeout(() => {
            button.classList.remove('is-copied');
            button.innerHTML = COPY_ICON;
          }, 1600),
        );
      });
    });
  }
}
