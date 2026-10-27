import type { Edge, NodeTypes } from '@xyflow/react';
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import { Crosshair, Flame, Map as MapIcon, Maximize2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { criticalEdges, criticalPath } from './critical-path';
import { activeKeys, followTarget } from './follow';
import { type Direction, firstKey, layoutFor, NODE_HEIGHT, NODE_WIDTH, pickNeighbour } from './layout';
import { edgeAnimates, isLive } from './status';
import { TaskNode, type TaskNodeType } from './TaskNode';
import type { DagViewAllProps } from './types';
import { useNow } from './use-now';

const nodeTypes = { task: TaskNode } satisfies NodeTypes;

const ARROW_KEY_DIRECTIONS: Record<string, Direction> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

const CRITICAL = '#fbbf24';
const LIVE = '#38bdf8';
const CALM = '#475569';

/**
 * DagView's motion. Status changes glow once (a transition, not a loop) and reduced motion removes
 * the animation entirely — the card still changes colour, so the information is never lost.
 */
const DAG_STYLES = `
[data-starling-dag] [data-flash='true'] {
  animation: starling-dag-status 700ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
@keyframes starling-dag-status {
  0% { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0.45); }
  45% { box-shadow: 0 0 0 7px rgba(56, 189, 248, 0.16); }
  100% { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0); }
}
@media (prefers-reduced-motion: reduce) {
  [data-starling-dag] [data-flash='true'] { animation: none !important; }
}
[data-starling-dag][data-reduced-motion='true'] [data-flash='true'] { animation: none !important; }
`;

function DagCanvas({ plan, tasks, selectedTask, onSelectTask, reducedMotion = false }: DagViewAllProps) {
  const layout = useMemo(() => layoutFor(plan), [plan]);
  const anyLive = useMemo(() => Object.values(tasks).some((task) => isLive(task.status)), [tasks]);
  const now = useNow(anyLive);
  const [minimap, setMinimap] = useState(false);
  const [follow, setFollow] = useState(false);
  const { fitView, setCenter } = useReactFlow();

  const critical = useMemo(() => criticalPath(plan), [plan]);
  const criticalSet = useMemo(() => new Set(critical.keys), [critical]);
  const criticalEdgeSet = useMemo(() => criticalEdges(plan), [plan]);

  const nodes = useMemo<TaskNodeType[]>(() => {
    if (!plan) return [];
    return plan.tasks.map((spec) => ({
      id: spec.key,
      type: 'task',
      position: layout.positions[spec.key] ?? { x: 0, y: 0 },
      data: { spec, run: tasks[spec.key], now, critical: criticalSet.has(spec.key) },
      selected: spec.key === selectedTask,
      draggable: false,
      connectable: false,
      // React Flow measures nodes with ResizeObserver in a browser. Declaring the size matters for
      // server/happy-dom renders (and for the very first paint before measurement lands): without it
      // edges are withheld because their endpoints are unknown.
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      initialWidth: NODE_WIDTH,
      initialHeight: NODE_HEIGHT,
      measured: { width: NODE_WIDTH, height: NODE_HEIGHT },
      // Declared handle geometry is the fallback when measurement has not run yet (SSR, happy-dom,
      // or the first frame before ResizeObserver reports). Without it React Flow withholds edges
      // because it cannot place their endpoints.
      handles: [
        { type: 'target', position: Position.Left, x: 0, y: NODE_HEIGHT / 2 },
        { type: 'source', position: Position.Right, x: NODE_WIDTH, y: NODE_HEIGHT / 2 },
      ],
    }));
  }, [plan, tasks, layout, now, selectedTask, criticalSet]);

  const edges = useMemo<Edge[]>(() => {
    if (!plan) return [];
    const known = new Set(plan.tasks.map((task) => task.key));
    const result: Edge[] = [];
    for (const spec of plan.tasks) {
      const downstream = tasks[spec.key]?.status;
      for (const dep of spec.dependsOn) {
        if (!known.has(dep)) continue;
        const id = `${dep}->${spec.key}`;
        const animated = edgeAnimates(tasks[dep]?.status, downstream);
        const onCriticalPath = criticalEdgeSet.has(id);
        const stroke = animated ? LIVE : onCriticalPath ? CRITICAL : CALM;
        result.push({
          id,
          source: dep,
          target: spec.key,
          animated,
          label: onCriticalPath ? 'critical' : undefined,
          labelStyle: onCriticalPath ? { fill: '#fcd34d', fontSize: 11, fontWeight: 600 } : undefined,
          labelBgStyle: onCriticalPath ? { fill: '#0b1220', fillOpacity: 0.9 } : undefined,
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: stroke },
          style: { stroke, strokeWidth: animated ? 2 : onCriticalPath ? 2.5 : 1.5 },
        });
      }
    }
    return result;
  }, [plan, tasks, criticalEdgeSet]);

  // Re-fit whenever the plan identity changes (`plan.created` → a whole new graph), not on every
  // status tick, so the viewport does not jump while the flock is working.
  const planId = plan?.id;
  useEffect(() => {
    if (!planId) return;
    void fitView({ padding: 0.18, duration: 0 });
  }, [planId, fitView]);

  // Follow the action: pan to the newest live task, but only while the toggle is on. `previousActive`
  // makes "newest" mean "has not been live before", so two agents do not fight over the viewport.
  const active = useMemo(() => activeKeys(tasks), [tasks]);
  const previousActive = useRef<string[]>(active);
  useEffect(() => {
    const target = follow ? followTarget(tasks, previousActive.current) : undefined;
    previousActive.current = active;
    if (target === undefined) return;
    const point = layout.positions[target];
    if (point === undefined) return;
    void setCenter(point.x + NODE_WIDTH / 2, point.y + NODE_HEIGHT / 2, { zoom: 1, duration: 450 });
  }, [active, follow, layout, setCenter, tasks]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!plan) return;
      const direction = ARROW_KEY_DIRECTIONS[event.key];
      if (!direction) return;
      event.preventDefault();
      const start = selectedTask !== undefined && layout.positions[selectedTask] ? selectedTask : undefined;
      if (start === undefined) {
        const first = firstKey(layout.positions);
        if (first) onSelectTask(first);
        return;
      }
      const next = pickNeighbour(layout.positions, start, direction);
      if (next) onSelectTask(next);
    },
    [plan, selectedTask, layout, onSelectTask],
  );

  if (!plan || plan.tasks.length === 0) {
    return (
      <div
        className="grid h-full min-h-[240px] place-items-center rounded-lg border border-dashed border-slate-700 bg-slate-950/50 p-8 text-center"
        data-testid="dag-empty"
      >
        <p className="text-sm text-slate-400">No plan yet — the flock is still thinking. 🐦</p>
      </div>
    );
  }

  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-lg border border-slate-800 bg-slate-950"
      data-starling-dag=""
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      data-testid="dag-canvas"
      data-plan-id={plan.id}
      data-critical-path={critical.keys.join(',')}
      // One tab stop for the whole graph; arrow keys move the selection between task cards.
      // biome-ignore lint/a11y/noNoninteractiveTabindex: role=application makes this a keyboard-navigable graph
      tabIndex={0}
      role="application"
      aria-label="Task dependency graph"
      onKeyDown={handleKeyDown}
    >
      <style>{DAG_STYLES}</style>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => onSelectTask(node.id)}
        nodesDraggable={false}
        nodesConnectable={false}
        fitView
        minZoom={0.2}
        maxZoom={1.6}
        proOptions={{ hideAttribution: false }}
      >
        <Background gap={22} size={1} color="#1e293b" />

        <Panel position="top-left">
          <p
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-300/30 bg-slate-950/85 px-2 py-1 text-[12px] font-medium text-amber-200 shadow-lg"
            data-testid="critical-path-legend"
            title="Longest dependency chain by planner estimate — the run cannot finish sooner"
          >
            <Flame aria-hidden="true" className="h-3.5 w-3.5" />
            critical path
            <span className="tabular-nums text-amber-100">{critical.estimateMin} min</span>
            <span className="text-amber-300/60">·</span>
            <span className="tabular-nums text-amber-300/90">
              {critical.keys.length} {critical.keys.length === 1 ? 'task' : 'tasks'}
            </span>
          </p>
        </Panel>

        <Panel position="top-right" className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void fitView({ padding: 0.18, duration: 300 })}
            aria-label="Fit the graph to the canvas"
            title="Fit the graph to the canvas"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900/90 px-2 py-1 text-[12px] font-medium text-slate-300 transition-colors hover:border-slate-500"
          >
            <Maximize2 aria-hidden="true" className="h-3.5 w-3.5" />
            Fit
          </button>
          <button
            type="button"
            onClick={() => setFollow((on) => !on)}
            aria-pressed={follow}
            aria-label="Follow the action"
            title="Keep the viewport on the newest agent that is working"
            data-testid="dag-follow"
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] font-medium transition-colors ${
              follow
                ? 'border-sky-500 bg-sky-950/80 text-sky-200'
                : 'border-slate-700 bg-slate-900/90 text-slate-300 hover:border-slate-500'
            }`}
          >
            <Crosshair aria-hidden="true" className="h-3.5 w-3.5" />
            Follow
          </button>
          <button
            type="button"
            onClick={() => setMinimap((open) => !open)}
            aria-pressed={minimap}
            aria-label="Toggle minimap"
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] font-medium transition-colors ${
              minimap
                ? 'border-sky-500 bg-sky-950/80 text-sky-200'
                : 'border-slate-700 bg-slate-900/90 text-slate-300 hover:border-slate-500'
            }`}
          >
            <MapIcon aria-hidden="true" className="h-3.5 w-3.5" />
            Minimap
          </button>
        </Panel>

        {minimap ? (
          <MiniMap
            pannable
            zoomable
            className="!bg-slate-900"
            nodeColor="#334155"
            maskColor="rgba(2, 6, 23, 0.75)"
          />
        ) : null}

        <Controls showInteractive={false} className="!bg-slate-900 !text-slate-200" />
      </ReactFlow>
    </div>
  );
}

/**
 * The task DAG ("zoom in" from the Sky). Props-only per ARCHITECTURE §8: the shell owns the store and
 * selection; this component never fetches, edits or writes anything.
 */
export function DagView(props: DagViewAllProps) {
  return (
    <ReactFlowProvider>
      <DagCanvas {...props} />
    </ReactFlowProvider>
  );
}
