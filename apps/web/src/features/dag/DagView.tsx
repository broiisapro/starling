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
import { Map as MapIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DagViewProps } from './handshake';
import { type Direction, firstKey, layoutFor, NODE_HEIGHT, NODE_WIDTH, pickNeighbour } from './layout';
import { edgeAnimates, isLive } from './status';
import { TaskNode, type TaskNodeType } from './TaskNode';
import { useNow } from './use-now';

const nodeTypes = { task: TaskNode } satisfies NodeTypes;

const ARROW_KEY_DIRECTIONS: Record<string, Direction> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

function DagCanvas({ plan, tasks, selectedTask, onSelectTask }: DagViewProps) {
  const layout = useMemo(() => layoutFor(plan), [plan]);
  const anyLive = useMemo(() => Object.values(tasks).some((task) => isLive(task.status)), [tasks]);
  const now = useNow(anyLive);
  const [minimap, setMinimap] = useState(false);
  const { fitView } = useReactFlow();

  const nodes = useMemo<TaskNodeType[]>(() => {
    if (!plan) return [];
    return plan.tasks.map((spec) => ({
      id: spec.key,
      type: 'task',
      position: layout.positions[spec.key] ?? { x: 0, y: 0 },
      data: { spec, run: tasks[spec.key], now },
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
  }, [plan, tasks, layout, now, selectedTask]);

  const edges = useMemo<Edge[]>(() => {
    if (!plan) return [];
    const known = new Set(plan.tasks.map((task) => task.key));
    const result: Edge[] = [];
    for (const spec of plan.tasks) {
      const downstream = tasks[spec.key]?.status;
      for (const dep of spec.dependsOn) {
        if (!known.has(dep)) continue;
        const animated = edgeAnimates(tasks[dep]?.status, downstream);
        result.push({
          id: `${dep}->${spec.key}`,
          source: dep,
          target: spec.key,
          animated,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 14,
            height: 14,
            color: animated ? '#38bdf8' : '#475569',
          },
          style: { stroke: animated ? '#38bdf8' : '#475569', strokeWidth: animated ? 2 : 1.5 },
        });
      }
    }
    return result;
  }, [plan, tasks]);

  // Re-fit whenever the plan identity changes (`plan.created` → a whole new graph), not on every
  // status tick, so the viewport does not jump while the flock is working.
  const planId = plan?.id;
  useEffect(() => {
    if (!planId) return;
    void fitView({ padding: 0.18, duration: 0 });
  }, [planId, fitView]);

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
      data-testid="dag-canvas"
      data-plan-id={plan.id}
      // One tab stop for the whole graph; arrow keys move the selection between task cards.
      // biome-ignore lint/a11y/noNoninteractiveTabindex: role=application makes this a keyboard-navigable graph
      tabIndex={0}
      role="application"
      aria-label="Task dependency graph"
      onKeyDown={handleKeyDown}
    >
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
        <Controls showInteractive={false} className="!bg-slate-900 !text-slate-200" />
        <Panel position="top-right">
          <button
            type="button"
            onClick={() => setMinimap((open) => !open)}
            aria-pressed={minimap}
            aria-label="Toggle minimap"
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
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
      </ReactFlow>
    </div>
  );
}

/**
 * The task DAG ("zoom in" from the Sky). Props-only per ARCHITECTURE §8: the shell owns the store and
 * selection; this component never fetches, edits or writes anything.
 */
export function DagView(props: DagViewProps) {
  return (
    <ReactFlowProvider>
      <DagCanvas {...props} />
    </ReactFlowProvider>
  );
}
