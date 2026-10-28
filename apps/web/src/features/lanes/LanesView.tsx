import type { TaskSpec } from '@starling/core/browser';
import { LayoutGrid } from 'lucide-react';
import { type KeyboardEvent, useId, useMemo, useRef, useState } from 'react';
import { Badge, EmptyState } from '../../components';
import { usePrefersReducedMotion } from '../metrics';
import { buildLaneModel, formatLaneSummary, type LaneNode, type LaneSummary } from './derive';
import { LaneTable } from './LaneTable';
import {
  type ArrowDirection,
  LANE_VIEW_HEIGHT,
  LANE_VIEW_WIDTH,
  layoutLaneTree,
  nearestTile,
} from './layout';
import {
  CONFLICT_COLOUR,
  colourFor,
  laneColours,
  laneTitles,
  SELECTED_STROKE,
  UNOWNED_COLOUR,
  VIOLATION_COLOUR,
} from './palette';
import type { FeatureProps, LaneViewMode } from './types';

/**
 * The lanes map (Epic 115).
 *
 * A treemap of the repo coloured by the task that owns each area: directory frames nest, read-only
 * areas fade, a path claimed by two lanes is hatched, and a conflict or lane violation is outlined in
 * red. The point on stage is one glance — "every bird has its own patch of sky" — followed by a click
 * into the owner. The same data is also a table, because a treemap is a terrible way to read a path.
 *
 * Props-only: it reads `SkyState` and calls `onSelectTask`; the shell (C3) wires the store.
 */

export interface LanesViewProps extends FeatureProps {
  /** Start in the list; the playground uses this. Optional so the `ComponentType<FeatureProps>` cast stays honest. */
  initialMode?: LaneViewMode;
}

function nodeOpacity(node: LaneNode, selected: string | undefined): number {
  if (selected === undefined) return 1;
  return node.owners.includes(selected) || node.readers.includes(selected) ? 1 : 0.18;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(1, max - 1))}…`;
}

function SummaryStrip({ summary, violations }: { summary: LaneSummary; violations: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-1 pt-2">
      <p data-testid="lanes-summary" className="text-caption font-medium tabular-nums text-ink-2">
        {formatLaneSummary(summary)}
      </p>
      {violations > 0 ? (
        <Badge tone="danger">
          {violations} lane {violations === 1 ? 'violation' : 'violations'}
        </Badge>
      ) : null}
    </div>
  );
}

interface TreemapProps {
  tree: LaneNode;
  selectedTask?: string;
  colours: ReadonlyMap<string, string>;
  titles: ReadonlyMap<string, string>;
  reducedMotion: boolean;
  onSelectTask?(key: string): void;
}

function Treemap({ tree, selectedTask, colours, titles, reducedMotion, onSelectTask }: TreemapProps) {
  const layout = useMemo(() => layoutLaneTree(tree), [tree]);
  const [activeIndex, setActiveIndex] = useState(0);
  const refs = useRef<(SVGGElement | null)[]>([]);
  const hatchId = `lanes-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const active = layout.tiles.length === 0 ? -1 : Math.min(activeIndex, layout.tiles.length - 1);

  const select = (node: LaneNode): void => {
    const key = node.owners[0] ?? node.readers[0];
    if (key !== undefined) onSelectTask?.(key);
  };

  const focusTile = (index: number): void => {
    setActiveIndex(index);
    refs.current[index]?.focus();
  };

  const onTileKeyDown = (event: KeyboardEvent<SVGGElement>, index: number, node: LaneNode): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      select(node);
      return;
    }
    const direction: ArrowDirection | undefined =
      event.key === 'ArrowLeft'
        ? 'left'
        : event.key === 'ArrowRight'
          ? 'right'
          : event.key === 'ArrowUp'
            ? 'up'
            : event.key === 'ArrowDown'
              ? 'down'
              : undefined;
    if (direction === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    focusTile(nearestTile(layout.tiles, index, direction));
  };

  const label = (node: LaneNode): string => {
    const owner = node.owners[0];
    const title = owner === undefined ? undefined : titles.get(owner);
    const size = node.touched > 0 ? `${node.touched} lines touched` : 'not touched';
    const flags = [node.overlap ? 'overlapping lanes' : undefined, node.conflict ? 'conflict' : undefined]
      .filter((flag): flag is string => flag !== undefined)
      .join(', ');
    const readOnly = node.owners.length === 0 && node.readers.length > 0 ? ', read-only' : '';
    return `${node.path || 'repo'} · ${title ?? 'unowned'} · ${size}${flags === '' ? '' : ` · ${flags}`}${readOnly}`;
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: an SVG treemap is a group; <fieldset> is not valid inside <svg>
    <svg
      viewBox={`0 0 ${LANE_VIEW_WIDTH} ${LANE_VIEW_HEIGHT}`}
      preserveAspectRatio="none"
      role="group"
      aria-label="Lane treemap: which task owns which area of the repo"
      data-testid="lanes-map"
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      className="h-full w-full"
    >
      <defs>
        <pattern
          id={hatchId}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="6"
            stroke="var(--color-amber-soft)"
            strokeWidth="1.6"
            opacity="0.55"
          />
        </pattern>
      </defs>

      {layout.frames.map(({ node, rect }) => {
        const owner = node.owners[0] ?? node.readers[0];
        const opacity = nodeOpacity(node, selectedTask);
        const tint = colourFor(colours, owner);
        const selected = selectedTask !== undefined && node.owners.includes(selectedTask);
        return (
          <g
            key={`frame:${node.path}`}
            data-testid="lane-frame"
            data-path={node.path}
            data-selected={selected ? 'true' : 'false'}
            opacity={opacity}
            pointerEvents="none"
          >
            <rect
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              rx={3}
              fill={tint}
              fillOpacity={0.05}
              stroke="var(--color-hairline-strong)"
              strokeWidth={selected ? 2 : 1}
            />
            {rect.width >= 34 && rect.height >= 16 ? (
              <text
                x={rect.x + 4}
                y={rect.y + 10}
                fontSize={8}
                fill="var(--color-ink-3)"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {truncate(`${node.name}/`, Math.max(3, Math.floor(rect.width / 5)))}
              </text>
            ) : null}
          </g>
        );
      })}

      {layout.tiles.map(({ node, rect }, index) => {
        const owner = node.owners[0] ?? node.readers[0];
        const readOnly = node.owners.length === 0 && node.readers.length > 0;
        const opacity = nodeOpacity(node, selectedTask);
        const selected = selectedTask !== undefined && node.owners.includes(selectedTask);
        const stroke = node.conflict
          ? CONFLICT_COLOUR
          : node.violation
            ? VIOLATION_COLOUR
            : selected
              ? SELECTED_STROKE
              : 'var(--color-hairline)';
        const showLabel = rect.width >= 58 && rect.height >= 18;
        return (
          // biome-ignore lint/a11y/useSemanticElements: SVG <g> cannot be a native button; role + tabIndex + key handling is the equivalent
          <g
            key={`tile:${node.path}`}
            ref={(element) => {
              refs.current[index] = element;
            }}
            role="button"
            tabIndex={index === active ? 0 : -1}
            aria-label={label(node)}
            data-testid="lane-tile"
            data-path={node.path}
            data-owner={owner ?? ''}
            data-kind={node.kind}
            data-overlap={node.overlap ? 'true' : 'false'}
            data-conflict={node.conflict ? 'true' : 'false'}
            data-violation={node.violation ? 'true' : 'false'}
            data-readonly={readOnly ? 'true' : 'false'}
            data-selected={selected ? 'true' : 'false'}
            data-dim={opacity < 1 ? 'true' : 'false'}
            opacity={opacity}
            className="cursor-pointer outline-none"
            onClick={() => select(node)}
            onFocus={() => setActiveIndex(index)}
            onKeyDown={(event) => onTileKeyDown(event, index, node)}
          >
            <title>{label(node)}</title>
            <rect
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              rx={2}
              fill={colourFor(colours, owner)}
              fillOpacity={readOnly ? 0.22 : 0.5}
              stroke={stroke}
              strokeWidth={node.conflict || node.violation || selected ? 2 : 1}
              strokeDasharray={node.violation && !node.conflict ? '4 3' : undefined}
            />
            {node.overlap ? (
              <rect
                x={rect.x}
                y={rect.y}
                width={rect.width}
                height={rect.height}
                rx={2}
                fill={`url(#${hatchId})`}
                pointerEvents="none"
              />
            ) : null}
            {showLabel ? (
              <text
                x={rect.x + 4}
                y={rect.y + Math.min(rect.height - 4, 13)}
                fontSize={9}
                fill="var(--color-ink-1)"
                pointerEvents="none"
              >
                {truncate(
                  node.kind === 'file' ? node.name : `${node.name}/`,
                  Math.max(4, Math.floor(rect.width / 5.5)),
                )}
              </text>
            ) : null}
          </g>
        );
      })}

      {layout.tiles.length === 0 ? (
        <text x={16} y={24} fontSize={12} fill={UNOWNED_COLOUR}>
          No paths to draw yet.
        </text>
      ) : null}
    </svg>
  );
}

function Header({ mode, onMode }: { mode: LaneViewMode; onMode(mode: LaneViewMode): void }) {
  const button = (value: LaneViewMode, testId: string, label: string) => (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={mode === value}
      onClick={() => onMode(value)}
      className={
        mode === value
          ? 'rounded-full border border-focus/50 bg-focus/15 px-2.5 py-1 text-caption font-medium text-ink-1'
          : 'rounded-full border border-hairline bg-surface-2/60 px-2.5 py-1 text-caption text-ink-3 hover:text-ink-1'
      }
    >
      {label}
    </button>
  );

  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-hairline px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-heading font-semibold tracking-tight text-ink-1">Lanes</h2>
        <p className="mt-0.5 text-caption text-ink-3">
          Who owns which patch of sky. Read-only areas fade, overlaps hatch, conflicts outline in red.
        </p>
      </div>
      <fieldset aria-label="Lane view mode" className="m-0 flex shrink-0 items-center gap-1.5 border-0 p-0">
        {button('map', 'lanes-mode-map', 'Map')}
        {button('list', 'lanes-mode-list', 'View as list')}
      </fieldset>
    </header>
  );
}

function Legend({ tasks, colours }: { tasks: readonly TaskSpec[]; colours: ReadonlyMap<string, string> }) {
  return (
    <ul
      data-testid="lanes-legend"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-y border-hairline/60 px-4 py-1.5"
    >
      {tasks.map((task) => (
        <li
          key={task.key}
          data-testid="lanes-legend-item"
          data-task-key={task.key}
          className="flex items-center gap-1.5 text-caption text-ink-2"
          title={task.key}
        >
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-[2px]"
            style={{ backgroundColor: colourFor(colours, task.key) }}
          />
          {task.title}
        </li>
      ))}
      <li data-testid="lanes-legend-readonly" className="flex items-center gap-1.5 text-caption text-ink-3">
        <span
          aria-hidden="true"
          className="inline-block h-2.5 w-2.5 rounded-[2px] border border-dashed border-ink-3"
        />
        read-only
      </li>
    </ul>
  );
}

export function LanesView({ state, onSelectTask, initialMode = 'map' }: LanesViewProps) {
  const model = useMemo(() => buildLaneModel(state), [state]);
  const colours = useMemo(() => laneColours(model.tasks), [model.tasks]);
  const titles = useMemo(() => laneTitles(model.tasks), [model.tasks]);
  const reducedMotion = usePrefersReducedMotion();
  const [mode, setMode] = useState<LaneViewMode>(initialMode);
  const known = model.tasks.some((task) => task.key === state.selectedTask);
  const selectedTask = known ? state.selectedTask : undefined;

  return (
    <section
      data-testid="lanes-view"
      data-mode={mode}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      className="flex h-full min-h-0 flex-col bg-panel text-ink-1"
    >
      <Header mode={mode} onMode={setMode} />
      <SummaryStrip summary={model.summary} violations={model.summary.violations} />

      {model.issues.length > 0 ? (
        <div data-testid="lanes-warnings" role="status" className="flex flex-wrap gap-1.5 px-4 pb-1">
          {model.issues.map((issue) => (
            <Badge
              key={`${issue.code}:${issue.message}:${issue.taskKeys.join(',')}`}
              tone="warn"
              title={issue.taskKeys.join(', ')}
            >
              {issue.message}
            </Badge>
          ))}
        </div>
      ) : null}

      {model.tasks.length === 0 ? (
        <div className="min-h-0 flex-1">
          <EmptyState
            title="No lanes yet"
            description="When a plan is ready, every task's lane is painted here — one patch of sky per bird."
            icon={<LayoutGrid />}
          />
        </div>
      ) : (
        <>
          <Legend tasks={model.tasks} colours={colours} />
          <div className="min-h-0 flex-1 overflow-hidden p-2">
            {mode === 'map' ? (
              <Treemap
                tree={model.tree}
                selectedTask={selectedTask}
                colours={colours}
                titles={titles}
                reducedMotion={reducedMotion}
                onSelectTask={onSelectTask}
              />
            ) : (
              <LaneTable tree={model.tree} colours={colours} titles={titles} selectedTask={selectedTask} />
            )}
          </div>
        </>
      )}
    </section>
  );
}
