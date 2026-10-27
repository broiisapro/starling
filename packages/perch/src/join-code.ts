/**
 * Join-code fallback for a perch started without `--code`.
 *
 * Shape matches Epic 30's hub codes: eight characters grouped `XXXX-XXXX`, from an alphabet with
 * no lookalikes (no I/O/0/1). The perch publishes the code in its mDNS TXT record so a hub doing
 * zero-config discovery can authenticate. A hub that already has a code passes it in instead.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomJoinCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let code = '';
  for (const byte of bytes) {
    // 256 % 32 === 0, so the modulo introduces no bias.
    code += ALPHABET.charAt(byte % ALPHABET.length);
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
