import { Bird, ScanLine, Wifi } from 'lucide-react';
import { CopyButton } from './CopyButton';
import type { JoinInfo } from './handshake';
import { QrCode } from './QrCode';

export interface JoinCardProps {
  join?: JoinInfo;
  /** Element id used by the panel's "Add a laptop" links so multiple panels stay addressable. */
  anchorId: string;
  /**
   * How many roosts are on screen. Used only for the copy when `join` is missing: with one node the
   * hub really may have flock mode off, but with two or more nodes flock mode demonstrably works —
   * saying "off" there would be a lie, so the card says the join info is unavailable instead.
   */
  nodeCount?: number;
}

/**
 * The on-ramp: one command, one code, one QR. "Anyone in the room can lend their laptop" should be
 * one scan away, so the QR is the visual anchor and the command is copyable for people who prefer a
 * terminal.
 *
 * With no join info the card is deliberately neutral: the hub has not published a code yet, which is
 * not the same thing as flock mode being off (a running perch proves otherwise).
 */
export function JoinCard({ join, anchorId, nodeCount = 1 }: JoinCardProps) {
  if (!join) {
    const flockOff = nodeCount <= 1;
    return (
      <section
        id={anchorId}
        data-testid="join-card"
        data-join-disabled="true"
        data-join-reason={flockOff ? 'off' : 'unavailable'}
        aria-label="Add a laptop to the flock"
        className="flex flex-col justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3.5"
      >
        <header className="flex items-center gap-2">
          <Bird aria-hidden="true" className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-200">
            {flockOff ? 'Add a laptop' : 'Join info unavailable'}
          </h3>
        </header>
        <p className="text-[12px] leading-relaxed text-slate-300">
          {flockOff
            ? 'Flock mode is off for this run. Start the hub with flock enabled and its join code will perch here.'
            : `${nodeCount} roosts are already in this run, but the hub has not published a join code. The flock panel will fill this card in as soon as it does.`}
        </p>
      </section>
    );
  }

  const payload = join.command || join.hubUrl;

  return (
    <section
      id={anchorId}
      data-testid="join-card"
      data-join-code={join.code}
      aria-label="Add a laptop to the flock"
      className="relative overflow-hidden rounded-xl border border-sky-400/20 bg-gradient-to-br from-sky-500/[0.09] via-violet-500/[0.05] to-transparent p-3.5"
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sky-400/70 to-transparent"
      />

      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.2em] text-sky-300/80">
            lend a laptop
          </p>
          <h3 className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-slate-100">
            <ScanLine aria-hidden="true" className="h-4 w-4 text-sky-300" />
            Add a roost
          </h3>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[12px] text-slate-200">
          <Wifi aria-hidden="true" className="h-2.5 w-2.5 text-emerald-300" />
          same wifi
        </span>
      </header>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <QrCode value={payload} size={104} label="Scan to join the flock" className="shrink-0" />

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[12px] uppercase tracking-[0.16em] text-slate-300">join code</p>
              <p
                data-testid="join-code"
                className="select-all font-mono text-lg font-semibold tracking-[0.18em] text-sky-100"
              >
                {join.code}
              </p>
            </div>
            <CopyButton
              value={join.code}
              label="Copy code"
              ariaLabel="Copy join code"
              testId="copy-join-code"
            />
          </div>

          <div className="rounded-lg border border-white/10 bg-slate-950/50 p-2">
            <div className="flex items-start justify-between gap-2">
              <code
                data-testid="join-command"
                className="min-w-0 select-all break-all font-mono text-[12px] leading-relaxed text-slate-200"
              >
                {join.command}
              </code>
              <CopyButton
                value={join.command}
                label="Copy"
                ariaLabel="Copy join command"
                testId="copy-join-command"
                className="shrink-0"
              />
            </div>
          </div>

          <p data-testid="join-hub-url" className="truncate font-mono text-[12px] text-slate-400">
            hub {join.hubUrl}
          </p>
        </div>
      </div>

      <p className="mt-3 text-[12px] leading-relaxed text-slate-300">
        Run this on any laptop with opencode + Starling installed to add it to the flock.
      </p>
    </section>
  );
}
