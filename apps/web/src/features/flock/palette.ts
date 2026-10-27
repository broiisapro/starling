import { HUB_BADGE, NODE_STATUS_COLORS, PERCH_BADGE, taskTone } from '../../lib/status';

/**
 * The flock panel's colour lookup.
 *
 * At C1 the local fallback palette was deleted. Node status (online/busy/offline) and task chips
 * both come from the dashboard's one shared palette (`src/lib/status.ts`), so a roost chip and a
 * queue card agree on what "running" looks like.
 *
 * This module stays as a thin alias so the panel's components keep a single import — the values are
 * the shell's, not a copy.
 */
export { HUB_BADGE, PERCH_BADGE, taskTone };

/** Local name used by the roost components; the values are the shared node palette. */
export const STATUS_PALETTE = NODE_STATUS_COLORS;

export type { NodeStatusPalette as StatusTone } from '../../lib/status';
