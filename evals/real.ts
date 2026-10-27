import { type Auditor, type Planner, StarlingError } from './lib/core';

/**
 * Wave 2 adapters for `--impl real`.
 *
 * Wave 1 ships placeholder packages (`export const PACKAGE` only), so these loaders are documented
 * as Wave 2-only. They look for the conventional factory/default exports and fail with a *useful*
 * message when the package is still a stub. Contract frozen here:
 *
 *   @starling/planner: `createPlanner(opts)` or `planner` exporting the core `Planner` port
 *   @starling/auditor: `createAuditor(opts)` or `auditor` exporting the core `Auditor` port
 *
 * If Epic 48 picks different names, only this file changes.
 */
export async function loadRealPlanner(): Promise<Planner> {
  const mod = await importFirst(['@starling/planner', '../packages/planner/src/index.ts']);
  const candidate = pick(mod, ['createPlanner', 'planner', 'default']);
  const instance = instantiate(candidate);
  if (!isPlanner(instance)) {
    throw new StarlingError(
      'NOT_IMPLEMENTED',
      '[planner] @starling/planner does not export createPlanner()/planner yet. `--impl real` is Wave 2 (Epic 48); see docs/epic-29-evals.md.',
    );
  }
  return instance;
}

export async function loadRealAuditor(): Promise<Auditor> {
  const mod = await importFirst(['@starling/auditor', '../packages/auditor/src/index.ts']);
  const candidate = pick(mod, ['createAuditor', 'auditor', 'default']);
  const instance = instantiate(candidate);
  if (!isAuditor(instance)) {
    throw new StarlingError(
      'NOT_IMPLEMENTED',
      '[auditor] @starling/auditor does not export createAuditor()/auditor yet. `--impl real` is Wave 2 (Epic 48); see docs/epic-29-evals.md.',
    );
  }
  return instance;
}

type UnknownModule = Record<string, unknown>;

async function importFirst(specifiers: string[]): Promise<UnknownModule> {
  const failures: string[] = [];
  for (const specifier of specifiers) {
    try {
      return (await import(specifier)) as UnknownModule;
    } catch (err) {
      failures.push(`${specifier}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new StarlingError(
    'NOT_IMPLEMENTED',
    `Could not load the real implementation (${failures.join('; ')}). ` +
      'Real mode needs the Wave 2 packages and a configured model.',
  );
}

function pick(mod: UnknownModule, names: string[]): unknown {
  for (const name of names) {
    const value = mod[name];
    if (value !== undefined) return value;
  }
  return undefined;
}

function instantiate(candidate: unknown): unknown {
  if (typeof candidate !== 'function') return candidate;
  try {
    return (candidate as (options?: unknown) => unknown)({});
  } catch (err) {
    // A factory that needs a model/config is still the right shape; report the missing wiring.
    throw new StarlingError('NOT_IMPLEMENTED', 'The real factory could not be constructed without options.', {
      cause: err,
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isPlanner(value: unknown): value is Planner {
  return isRecord(value) && typeof value.plan === 'function' && typeof value.validate === 'function';
}

export function isAuditor(value: unknown): value is Auditor {
  return isRecord(value) && typeof value.audit === 'function';
}
