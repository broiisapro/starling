import type { NodeInfo } from '@starling/core';
import { useEffect, useRef, useState } from 'react';

/** Matches the `duration-300` transition on a leaving card. */
export const EXIT_MS = 320;

export interface PresenceEntry {
  node: NodeInfo;
  /** True while the card plays its exit transition; it is rendered but no longer live. */
  leaving: boolean;
}

/**
 * Keep departed roosts mounted long enough to fade out, while live roosts render immediately.
 * Departed nodes only ever come from the props we saw before, never from a store. With
 * `reducedMotion` the exit transition is skipped entirely (WCAG 2.3.3 / the SkyView contract).
 */
export function usePresence(
  items: readonly NodeInfo[],
  reducedMotion: boolean,
): { entries: PresenceEntry[] } {
  const [leaving, setLeaving] = useState<readonly NodeInfo[]>([]);
  const previous = useRef<readonly NodeInfo[]>(items);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const previousNodes = previous.current;
    previous.current = items;

    if (reducedMotion) {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
      return;
    }

    const live = new Set(items.map((node) => node.id));
    const gone = previousNodes.filter((node) => !live.has(node.id));
    if (gone.length === 0) return;

    setLeaving((current) => [
      ...current.filter((node) => !live.has(node.id) && !gone.some((departed) => departed.id === node.id)),
      ...gone,
    ]);

    for (const node of gone) {
      const pending = timers.current.get(node.id);
      if (pending) clearTimeout(pending);
      timers.current.set(
        node.id,
        setTimeout(() => {
          timers.current.delete(node.id);
          setLeaving((current) => current.filter((entry) => entry.id !== node.id));
        }, EXIT_MS),
      );
    }
  }, [items, reducedMotion]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const liveIds = new Set(items.map((node) => node.id));
  const entries: PresenceEntry[] = items.map((node) => ({ node, leaving: false }));
  if (!reducedMotion) {
    for (const node of leaving) {
      if (!liveIds.has(node.id)) entries.push({ node, leaving: true });
    }
  }
  return { entries };
}
