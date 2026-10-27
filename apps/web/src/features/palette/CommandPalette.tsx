/**
 * ⌘K — the command palette overlay.
 *
 * The component owns exactly four things: the query, the active row, focus and the recent list. Every
 * row it renders comes from the pure derivations in `derive.ts`; every pick is an item's own `run()`.
 * That split is why ranking changes never touch JSX and why the keyboard/ARIA behaviour is testable
 * without a live hub.
 *
 * Accessibility follows the WAI-ARIA combobox + listbox pattern: focus stays on the input, the active
 * option is announced through `aria-activedescendant`, and groups are labelled `role="group"`
 * sections inside the listbox.
 */
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { EmptyState, Kbd } from '../../components';
import { cn } from '../../lib/cn';
import { usePrefersReducedMotion } from '../metrics';
import { collectItems, flattenGroups, GROUP_LABELS, groupResults, type PaletteGroupResult } from './derive';
import { formatHotkey } from './hotkey';
import { PaletteIcon } from './icons';
import { type PaletteItem, recentItems } from './items';
import { readRecent, recordRecent, writeRecent } from './recent';
import type { FeatureProps, PaletteCommand, PaletteFeature } from './types';

/** The result cap from the brief: 50 rows, however large the plan. */
export const RESULT_LIMIT = 50;

export interface CommandPaletteProps extends FeatureProps {
  /** Manifests from the shell's registry (a structural subset of L39; pass them straight in). */
  features?: readonly PaletteFeature[];
  /** Actions the shell owns: toggle theme, switch view, change demo speed, … */
  commands?: readonly PaletteCommand[];
  /** Called instead of opening a feature directly; the shell decides what `id` means. */
  onOpenFeature?(id: string): void;
  /** Seeds the recent list instead of `localStorage` (playgrounds and tests). */
  initialRecent?: readonly string[];
  /** `false` keeps the recents read-only. Default: persist every pick. */
  persistRecent?: boolean;
  /** Render as a normal block instead of a full-screen modal layer (playground only). */
  inline?: boolean;
}

interface HighlightProps {
  text: string;
  ranges: readonly [number, number][];
}

/** Render matched spans as <mark>. Ranges are half-open and already merged by `fuzzy.ts`. */
function Highlight({ text, ranges }: HighlightProps) {
  if (ranges.length === 0) return <>{text}</>;
  const parts: Array<{ key: string; text: string; match: boolean }> = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) parts.push({ key: `gap-${cursor}`, text: text.slice(cursor, start), match: false });
    parts.push({ key: `hit-${start}`, text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) parts.push({ key: `gap-${cursor}`, text: text.slice(cursor), match: false });

  return (
    <>
      {parts.map((part) =>
        part.match ? (
          <mark key={part.key} className="rounded-[2px] bg-irid-teal/25 px-[1px] text-ink-1">
            {part.text}
          </mark>
        ) : (
          <span key={part.key}>{part.text}</span>
        ),
      )}
    </>
  );
}

function iconNameFor(item: PaletteItem, featureIcons: ReadonlyMap<string, string>): string {
  if (item.group === 'features') return featureIcons.get(item.id) ?? 'Command';
  if (item.group === 'tasks') return 'ListOrdered';
  if (item.group === 'runs') return 'Bird';
  if (item.group === 'recent') return 'Clock';
  return 'Command';
}

interface RowProps {
  item: PaletteItem;
  ranges: readonly [number, number][];
  active: boolean;
  optionId: string;
  iconName: string;
  reducedMotion: boolean;
  onHover(): void;
  onPick(): void;
}

function Row({ item, ranges, active, optionId, iconName, reducedMotion, onHover, onPick }: RowProps) {
  return (
    <div
      id={optionId}
      role="option"
      aria-selected={active}
      // The combobox keeps DOM focus on the input (aria-activedescendant announces this row), so an
      // option must not join the tab order. `-1` keeps it programmatically focusable and clickable.
      tabIndex={-1}
      onMouseEnter={onHover}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onPick();
        }
      }}
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5',
        active ? 'bg-irid-teal/15 text-ink-1' : 'text-ink-2 hover:bg-surface-3/60',
        reducedMotion ? undefined : 'transition-colors duration-100',
      )}
    >
      <span aria-hidden="true" className={cn('shrink-0', active ? 'text-irid-teal' : 'text-ink-4')}>
        <PaletteIcon name={iconName} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body">
          <Highlight text={item.label} ranges={ranges} />
        </span>
        {item.hint !== undefined ? (
          <span className="block truncate text-micro text-ink-3">{item.hint}</span>
        ) : null}
      </span>
      {item.hotkey !== undefined ? (
        <Kbd size="sm" className="shrink-0">
          {formatHotkey(item.hotkey)}
        </Kbd>
      ) : null}
    </div>
  );
}

function Group({
  group,
  headingId,
  children,
}: {
  group: PaletteGroupResult;
  headingId: string;
  children: ReactNode;
}) {
  return (
    // A listbox may only own options and groups; a <fieldset> here would be announced as a form and
    // break the combobox's owned-children semantics, so the ARIA group role is the correct element.
    // biome-ignore lint/a11y/useSemanticElements: fieldset is invalid inside a listbox
    <div role="group" aria-labelledby={headingId} data-testid={`palette-group-${group.id}`}>
      <div
        id={headingId}
        role="presentation"
        className="px-2.5 pb-1 pt-2 text-micro font-semibold uppercase tracking-[0.08em] text-ink-4"
      >
        {GROUP_LABELS[group.id]}
      </div>
      {children}
    </div>
  );
}

export function CommandPalette({
  state,
  onSelectTask,
  onSelectRun,
  onClose,
  features,
  commands,
  onOpenFeature,
  initialRecent,
  persistRecent = true,
  inline = false,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState<string[]>(() => [...(initialRecent ?? readRecent())]);
  const inputRef = useRef<HTMLInputElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const listId = useId();
  const inputId = useId();

  const items = useMemo(
    () =>
      collectItems({
        state,
        ...(features === undefined ? {} : { features }),
        ...(commands === undefined ? {} : { commands }),
        ...(onSelectTask === undefined ? {} : { onSelectTask }),
        ...(onSelectRun === undefined ? {} : { onSelectRun }),
        ...(onOpenFeature === undefined ? {} : { onOpenFeature }),
      }),
    [state, features, commands, onSelectTask, onSelectRun, onOpenFeature],
  );

  const groups = useMemo(() => groupResults(items, query, recents, RESULT_LIMIT), [items, query, recents]);
  const flat = useMemo(() => flattenGroups(groups), [groups]);
  const activeIndex = flat.length === 0 ? -1 : Math.min(active, flat.length - 1);
  const activeItem = activeIndex < 0 ? undefined : flat[activeIndex];
  const optionId = useCallback((index: number): string => `${listId}-option-${index}`, [listId]);
  const activeDescendant = activeIndex < 0 ? undefined : optionId(activeIndex);

  const featureIcons = useMemo(
    () => new Map((features ?? []).map((feature) => [`feature:${feature.id}`, feature.icon] as const)),
    [features],
  );

  // Opening focuses the input; closing puts focus back where it came from (the shell's trigger, a
  // task card, the body). Never leave a keyboard user stranded on a removed node.
  useEffect(() => {
    const previous = typeof document === 'undefined' ? null : document.activeElement;
    inputRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  useEffect(() => {
    if (activeIndex < 0) return;
    const node = document.getElementById(optionId(activeIndex));
    if (node !== null && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, optionId]);

  const pick = (item: PaletteItem | undefined): void => {
    if (item === undefined) return;
    if (persistRecent) {
      const next = recordRecent(recents, item.id);
      setRecents(next);
      writeRecent(next);
    }
    item.run();
    onClose?.();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (flat.length > 0) setActive((activeIndex + 1) % flat.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (flat.length > 0) setActive(activeIndex <= 0 ? flat.length - 1 : activeIndex - 1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      if (flat.length > 0) setActive(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      if (flat.length > 0) setActive(flat.length - 1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      pick(activeItem);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose?.();
      return;
    }
    // The palette has one focusable control (the combobox). Tab stays in the dialog instead of
    // escaping to the dashboard behind the overlay and losing the query.
    if (event.key === 'Tab') {
      event.preventDefault();
    }
  };

  const recentCount = recentItems(items, recents).length;
  const total = flat.length;

  const dialog = (
    <div
      role="dialog"
      aria-modal={inline ? undefined : true}
      aria-label="Command palette"
      data-testid="palette"
      data-reduced-motion={reducedMotion}
      className={cn(
        'flex max-h-[min(70vh,32rem)] w-full max-w-xl flex-col overflow-hidden rounded-[var(--radius-panel)] border border-hairline-strong bg-panel-strong text-ink-1 shadow-[var(--shadow-panel)]',
        reducedMotion ? undefined : 'transition-opacity duration-150',
      )}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-2.5">
        <span aria-hidden="true" className="text-ink-4">
          <PaletteIcon name="Search" className="h-4 w-4" />
        </span>
        <label htmlFor={inputId} className="sr-only">
          Search commands, views, tasks and runs
        </label>
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={true}
          aria-controls={listId}
          aria-activedescendant={activeDescendant}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          autoComplete="off"
          spellCheck={false}
          placeholder="Type a task, run or view…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            // A new query is a new result list: the first row is always the sensible selection.
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent text-body text-ink-1 outline-none placeholder:text-ink-4"
        />
        <Kbd size="sm">Esc</Kbd>
      </div>

      <div
        id={listId}
        role="listbox"
        aria-label="Palette results"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 py-1"
      >
        {groups.map((group) => (
          <Group key={group.id} group={group} headingId={`${listId}-${group.id}-label`}>
            {group.items.map((entry) => {
              const index = flat.indexOf(entry.item);
              return (
                <Row
                  key={entry.item.id}
                  item={entry.item}
                  ranges={entry.ranges}
                  active={index === activeIndex}
                  optionId={optionId(index)}
                  iconName={iconNameFor(entry.item, featureIcons)}
                  reducedMotion={reducedMotion}
                  onHover={() => setActive(index)}
                  onPick={() => pick(entry.item)}
                />
              );
            })}
          </Group>
        ))}

        {total === 0 ? (
          <div data-testid="palette-empty">
            <EmptyState
              compact
              icon={<PaletteIcon name="Search" />}
              title="No matches"
              description={
                query.trim() === ''
                  ? 'No commands, views, tasks or runs are available yet.'
                  : `Nothing matches “${query.trim()}”. Try a task key, a run goal or a view name.`
              }
            />
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-hairline px-3 py-1.5 text-micro text-ink-4">
        <span className="flex items-center gap-1.5">
          <Kbd size="sm">↑</Kbd>
          <Kbd size="sm">↓</Kbd>
          <span>navigate</span>
          <Kbd size="sm">↵</Kbd>
          <span>open</span>
        </span>
        <span aria-hidden="true" data-testid="palette-count">
          {total} {total === 1 ? 'result' : 'results'}
          {query.trim() === '' && recentCount > 0 ? ` · ${recentCount} recent` : ''}
        </span>
      </div>

      <div role="status" aria-live="polite" className="sr-only">
        {total} {total === 1 ? 'result' : 'results'}
      </div>
    </div>
  );

  if (inline) {
    return <div data-testid="palette-inline">{dialog}</div>;
  }

  return (
    // The backdrop is not a button: Escape and the input are the accessible exits, and a click only
    // closes when it lands outside the dialog.
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss mirrors a native popover
    <div
      data-testid="palette-overlay"
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/55 px-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      {dialog}
    </div>
  );
}
