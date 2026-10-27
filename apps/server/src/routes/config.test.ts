import { describe, expect, test } from 'bun:test';
import { defaultModelsFor, modelLabel, OPENCODE_MODEL } from '../public-config';
import { makeHarness } from '../test-support';

describe('GET /api/config/public', () => {
  test('publishes version, profile, one model per role and flock mode', async () => {
    const { app } = makeHarness({ publicConfig: { profile: 'opencode' } });
    const res = await app.request('/api/config/public');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      version: string;
      profile: string;
      models: Record<string, string>;
      flockEnabled: boolean;
    };
    expect(body.version).toBe('9.9.9');
    expect(body.profile).toBe('opencode');
    expect(body.flockEnabled).toBe(true);
    expect(Object.keys(body.models).sort()).toEqual([
      'auditor',
      'planner',
      'resolver',
      'summarizer',
      'worker',
      'writer',
    ]);
    expect(body.models.auditor).toBe(OPENCODE_MODEL);
    expect(modelLabel(body, 'auditor')).toBe(`auditor: ${OPENCODE_MODEL} (opencode)`);
  });

  test('reports flockEnabled false without a hub', async () => {
    const { app } = makeHarness({ flock: null, publicConfig: { profile: 'opencode' } });
    const res = await app.request('/api/config/public');
    expect(((await res.json()) as { flockEnabled: boolean }).flockEnabled).toBe(false);
  });

  test('accepts model ids and ModelRefs per role', async () => {
    const { app } = makeHarness({
      publicConfig: {
        profile: 'default',
        models: {
          auditor: { provider: 'ollama', model: 'qwen3.8:27b-mlx' },
          writer: 'local-small',
        },
      },
    });
    const body = (await (await app.request('/api/config/public')).json()) as {
      models: Record<string, string>;
    };
    expect(body.models.auditor).toBe('qwen3.8:27b-mlx');
    expect(body.models.writer).toBe('local-small');
    // Unspecified roles keep the §5 defaults for this profile.
    expect(body.models.planner).toBe('deepseek-v4.1-flash');
  });

  test('an explicit profile beats STARLING_LLM_PROFILE', async () => {
    const previous = process.env.STARLING_LLM_PROFILE;
    process.env.STARLING_LLM_PROFILE = 'ollama';
    try {
      const { app } = makeHarness({ publicConfig: { profile: 'opencode' } });
      const body = (await (await app.request('/api/config/public')).json()) as { profile: string };
      expect(body.profile).toBe('opencode');
    } finally {
      if (previous === undefined) delete process.env.STARLING_LLM_PROFILE;
      else process.env.STARLING_LLM_PROFILE = previous;
    }
  });

  test('defaultModelsFor keeps the opencode story to one model', () => {
    const models = defaultModelsFor('opencode');
    expect(new Set(Object.values(models))).toEqual(new Set([OPENCODE_MODEL]));
    expect(defaultModelsFor('deepseek').auditor).not.toBe(OPENCODE_MODEL);
  });
});
