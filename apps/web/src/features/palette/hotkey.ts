/**
 * Hotkey display for palette rows and the footer.
 *
 * The palette never *binds* a hotkey — the shell's registry does that from the L39 manifest. It only
 * renders the hint, so a Mac sees `⌘K` and everything else sees `Ctrl K` while the manifest keeps the
 * portable `mod+k` spelling.
 */

export type HotkeyPlatform = 'mac' | 'other';

/** `navigator.platform` is deprecated but still the one field that works in every browser. */
export function detectPlatform(): HotkeyPlatform {
  try {
    const nav = globalThis.navigator as
      | { platform?: string; userAgentData?: { platform?: string } }
      | undefined;
    const platform = nav?.userAgentData?.platform ?? nav?.platform ?? '';
    return /mac|iphone|ipad/i.test(platform) ? 'mac' : 'other';
  } catch {
    return 'other';
  }
}

/** `mod+k` → `⌘K` on a Mac, `Ctrl K` elsewhere. Unknown tokens are shown title-cased. */
export function formatHotkey(hotkey: string, platform: HotkeyPlatform = detectPlatform()): string {
  const parts = hotkey
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part !== '');

  const rendered = parts.map((part) => {
    const token = part.toLowerCase();
    if (token === 'mod') return platform === 'mac' ? '⌘' : 'Ctrl';
    if (token === 'shift') return platform === 'mac' ? '⇧' : 'Shift';
    if (token === 'alt') return platform === 'mac' ? '⌥' : 'Alt';
    if (token === 'enter') return platform === 'mac' ? '↵' : 'Enter';
    if (token === 'esc') return 'Esc';
    if (token.length === 1) return token.toUpperCase();
    return part.charAt(0).toUpperCase() + part.slice(1);
  });

  return rendered.join(platform === 'mac' ? '' : ' ');
}
