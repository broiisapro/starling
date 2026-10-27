/**
 * Which local open-weight model to use, and why.
 *
 * Epic 28's benchmark writes `tools/local-models/results/recommendation.json`:
 *
 * ```json
 * { "mbp": { "auditor": "qwen3.8:27b-mlx", "summarizer": "qwen3.8:27b-mlx" },
 *   "air": { "auditor": "qwen3.8:4b-mlx",  "summarizer": "qwen3.8:4b-mlx" } }
 * ```
 *
 * Two rules keep this honest:
 * 1. a measured recommendation beats the compiled-in default, but never an explicit
 *    `STARLING_LOCAL_MODEL`, which the user typed on purpose;
 * 2. a missing or malformed file is a warning, not an error — `--fully-open` must still run on a
 *    fresh clone before anyone has benchmarked a laptop.
 */

import { readFileSync } from 'node:fs';
import { totalmem } from 'node:os';
import { resolve } from 'node:path';
import { z } from 'zod';
import { LOCAL_DEFAULT_MODEL } from './profiles';

/** Relative to the repo root; matches `tools/local-models/recommend.ts`'s default `--out`. */
export const RECOMMENDATION_RELATIVE_PATH = 'tools/local-models/results/recommendation.json';

export type LocalHostProfile = 'mbp' | 'air';

/** RAM of the two laptops in ARCHITECTURE §1; also the split point for auto-detection. */
export const HOST_RAM_GB: Record<LocalHostProfile, number> = { mbp: 32, air: 16 };
/** At or above this much RAM a host gets the `mbp` pick. */
export const MBP_MIN_RAM_GB = 24;

const ProfilePickSchema = z.object({
  auditor: z.string().min(1),
  summarizer: z.string().min(1),
});
const RecommendationSchema = z.object({ mbp: ProfilePickSchema, air: ProfilePickSchema });
/** Future-proofing: accept a `{ profiles: … }` wrapper too. */
const WrappedSchema = z.object({ profiles: RecommendationSchema });

export type LocalRecommendation = z.infer<typeof RecommendationSchema>;

export interface LocalModelChoice {
  /** The reasoning model: planner, auditor, workers and the resolver. */
  model: string;
  /** The prose model: summarizer and writer. */
  smallModel: string;
  host: LocalHostProfile;
  source: 'env' | 'recommendation' | 'default';
  /** Human-readable notes (missing file, ignored recommendation) for logs. */
  warnings: string[];
}

export interface ChooseLocalModelOptions {
  /** Repo root used to find the recommendation file; defaults to `process.cwd()`. */
  cwd?: string;
  /** Explicit recommendation path (tests, monorepo layouts). */
  recommendationPath?: string;
  /** Force the host profile instead of deriving it from RAM. */
  host?: LocalHostProfile;
  /** Env source; `STARLING_LOCAL_MODEL` / `STARLING_LOCAL_PROFILE` are read from it. */
  env?: Record<string, string | undefined>;
  /** Total RAM in GB; defaults to `os.totalmem()`. */
  memGb?: number;
  /** Skip the file read entirely. */
  skipRecommendation?: boolean;
}

/** Parse whatever is in the file, tolerating the wrapper shape. `undefined` means "not usable". */
export function parseRecommendation(raw: unknown): LocalRecommendation | undefined {
  const direct = RecommendationSchema.safeParse(raw);
  if (direct.success) return direct.data;
  const wrapped = WrappedSchema.safeParse(raw);
  return wrapped.success ? wrapped.data.profiles : undefined;
}

export interface ReadRecommendationResult {
  recommendation?: LocalRecommendation;
  path: string;
  warning?: string;
}

/** Read and validate the recommendation; never throws. */
export function readRecommendation(options: { cwd?: string; path?: string } = {}): ReadRecommendationResult {
  const path = options.path ?? resolve(options.cwd ?? process.cwd(), RECOMMENDATION_RELATIVE_PATH);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return {
      path,
      warning: `no local benchmark recommendation at ${path}; using the built-in default`,
    };
  }
  try {
    const recommendation = parseRecommendation(JSON.parse(text) as unknown);
    if (recommendation === undefined) {
      return { path, warning: `${path} has no mbp/air picks; using the built-in default` };
    }
    return { path, recommendation };
  } catch {
    return { path, warning: `${path} is not valid JSON; using the built-in default` };
  }
}

/** `STARLING_LOCAL_PROFILE` wins, then RAM: 32 GB laptops are `mbp`, 16 GB ones are `air`. */
export function hostProfile(
  options: { env?: Record<string, string | undefined>; memGb?: number } = {},
): LocalHostProfile {
  const forced = options.env?.STARLING_LOCAL_PROFILE?.trim().toLowerCase();
  if (forced === 'mbp' || forced === 'air') return forced;
  const memGb = options.memGb ?? defaultMemGb();
  return memGb >= MBP_MIN_RAM_GB ? 'mbp' : 'air';
}

/** RAM in GB, rounded; the LLM package is Node/Bun-only, so `node:os` is safe here. */
export function defaultMemGb(): number {
  return Math.round(totalmem() / 1024 ** 3);
}

/**
 * The local model for this host. Precedence: `STARLING_LOCAL_MODEL` → recommendation → default.
 *
 * The recommendation's `auditor` pick is used for reasoning, its `summarizer` pick for prose. That
 * is the point of benchmarking two roles: judging a diff is harder than writing a PR body.
 */
export function chooseLocalModel(options: ChooseLocalModelOptions = {}): LocalModelChoice {
  const env = options.env ?? process.env;
  const host =
    options.host ?? hostProfile({ env, ...(options.memGb === undefined ? {} : { memGb: options.memGb }) });
  const forced = env.STARLING_LOCAL_MODEL?.trim();
  if (forced !== undefined && forced !== '') {
    return { model: forced, smallModel: forced, host, source: 'env', warnings: [] };
  }

  if (options.skipRecommendation === true) {
    return {
      model: LOCAL_DEFAULT_MODEL,
      smallModel: LOCAL_DEFAULT_MODEL,
      host,
      source: 'default',
      warnings: [],
    };
  }

  const read = readRecommendation({
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.recommendationPath === undefined ? {} : { path: options.recommendationPath }),
  });
  if (read.recommendation === undefined) {
    return {
      model: LOCAL_DEFAULT_MODEL,
      smallModel: LOCAL_DEFAULT_MODEL,
      host,
      source: 'default',
      warnings: read.warning === undefined ? [] : [read.warning],
    };
  }

  const pick = read.recommendation[host];
  return {
    model: pick.auditor,
    smallModel: pick.summarizer,
    host,
    source: 'recommendation',
    warnings: [],
  };
}
