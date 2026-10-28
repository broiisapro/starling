/**
 * Connection settings: the hub origin and the flock token (Epic 118).
 *
 * The URL uses a local draft and commits on blur/Enter/Test. Committing every keystroke would clear
 * the field as soon as the first character (`h`) failed validation, which is a maddening way to type
 * a URL. The token, by contrast, is written on every change — it is opaque, so there is nothing to
 * validate visually and losing focus should never lose the paste.
 */
import { Check, Eye, EyeOff, Loader2, Plug, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '../../lib/cn';
import type { SettingsPatch, StarlingSettings } from './schema';
import { checkServerUrl, type HealthCheckResult, testServerHealth } from './url';

export interface ConnectionSectionProps {
  settings: StarlingSettings;
  onChange(patch: SettingsPatch): void;
  fetchImpl?: typeof fetch;
}

const INPUT_CLASS =
  'w-full rounded-lg border border-hairline-strong bg-surface-0/70 px-2.5 py-1.5 font-mono text-caption text-ink-1 placeholder:text-ink-4 focus-visible:border-focus';

export function ConnectionSection({ settings, onChange, fetchImpl }: ConnectionSectionProps) {
  const [urlDraft, setUrlDraft] = useState(settings.serverUrl);
  const [urlError, setUrlError] = useState<string | undefined>(undefined);
  const [health, setHealth] = useState<HealthCheckResult | undefined>(undefined);
  const [testing, setTesting] = useState(false);
  const [revealToken, setRevealToken] = useState(false);

  // A reset or another tab can change the stored URL while the field is idle.
  useEffect(() => {
    setUrlDraft(settings.serverUrl);
    setUrlError(undefined);
    setHealth(undefined);
  }, [settings.serverUrl]);

  const commitUrl = (): string | undefined => {
    const check = checkServerUrl(urlDraft);
    if (!check.ok) {
      setUrlError(check.error ?? 'That URL is not usable.');
      return undefined;
    }
    setUrlDraft(check.value);
    setUrlError(undefined);
    if (check.value !== settings.serverUrl) onChange({ serverUrl: check.value });
    return check.value;
  };

  const runHealthCheck = async (): Promise<void> => {
    const origin = commitUrl();
    if (origin === undefined) return;
    setTesting(true);
    setHealth(undefined);
    const result = await testServerHealth(origin, { fetchImpl });
    setHealth(result);
    setTesting(false);
  };

  const healthTone = health === undefined ? '' : health.ok ? 'text-emerald-200' : 'text-amber-200';

  return (
    <>
      <div>
        <label className="mb-1 block text-caption text-ink-2" htmlFor="settings-server-url">
          Hub URL
        </label>
        <div className="flex items-stretch gap-1.5">
          <input
            id="settings-server-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="Same origin (default)"
            aria-describedby="settings-server-url-hint"
            aria-invalid={urlError === undefined ? undefined : true}
            value={urlDraft}
            onChange={(event) => {
              setUrlDraft(event.target.value);
              setUrlError(undefined);
              setHealth(undefined);
            }}
            onBlur={commitUrl}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              commitUrl();
            }}
            className={INPUT_CLASS}
          />
          <button
            type="button"
            onClick={() => void runHealthCheck()}
            disabled={testing}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-hairline-strong bg-surface-2 px-2.5 text-caption font-medium text-ink-2 transition-colors motion-safe-only hover:text-ink-1 disabled:opacity-50"
          >
            {testing ? (
              <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
            ) : (
              <Plug aria-hidden="true" className="h-3 w-3" />
            )}
            {testing ? 'Testing…' : 'Test'}
          </button>
        </div>
        <p id="settings-server-url-hint" className="mt-1 text-micro text-ink-4">
          Leave blank to talk to this page&apos;s origin.
        </p>
        {urlError !== undefined ? (
          <p className="mt-1 text-micro text-amber-200" data-testid="server-url-error" role="alert">
            {urlError}
          </p>
        ) : null}
        {health !== undefined ? (
          <p
            className={cn('mt-1 flex items-center gap-1 text-micro', healthTone)}
            data-testid="health-status"
            data-ok={health.ok ? 'true' : 'false'}
            role="status"
          >
            {health.ok ? (
              <Check aria-hidden="true" className="h-3 w-3" />
            ) : (
              <Plug aria-hidden="true" className="h-3 w-3" />
            )}
            {health.ok ? 'Reachable' : 'Not reachable'} — {health.detail}
          </p>
        ) : null}
      </div>

      <div>
        <div className="flex items-center justify-between gap-2">
          <label className="text-caption text-ink-2" htmlFor="settings-token">
            Access token
          </label>
          {settings.token === '' ? null : (
            <button
              type="button"
              onClick={() => onChange({ token: '' })}
              className="inline-flex items-center gap-1 text-micro text-ink-3 hover:text-ink-1"
            >
              <Trash2 aria-hidden="true" className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>
        <div className="mt-1 flex items-stretch gap-1.5">
          <input
            id="settings-token"
            type={revealToken ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            placeholder="Join code, e.g. 7QK4-2M9P"
            aria-describedby="settings-token-hint"
            value={settings.token}
            onChange={(event) => onChange({ token: event.target.value })}
            className={INPUT_CLASS}
          />
          <button
            type="button"
            aria-label={revealToken ? 'Hide access token' : 'Show access token'}
            aria-pressed={revealToken}
            onClick={() => setRevealToken((current) => !current)}
            className="inline-flex shrink-0 items-center justify-center rounded-lg border border-hairline-strong bg-surface-2 px-2 text-ink-3 transition-colors motion-safe-only hover:text-ink-1"
          >
            {revealToken ? (
              <EyeOff aria-hidden="true" className="h-3.5 w-3.5" />
            ) : (
              <Eye aria-hidden="true" className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
        <p id="settings-token-hint" className="mt-1 text-micro text-ink-4">
          Stored only in this browser. Never shown unless you reveal it, and never written to logs.
        </p>
      </div>
    </>
  );
}
