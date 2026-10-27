import { describe, expect, test } from 'bun:test';
import {
  defaultPortFree,
  freeLoopbackPort,
  hasOllamaModel,
  measureAvailableMemGb,
  parseDfAvailableGb,
  parseFlashModelIds,
  parseLanAddress,
  parseOllamaModelNames,
  parseOpenFiles,
  parseRecommendation,
  parseVmStatAvailableGb,
  profileForRam,
} from './doctor-probes';

describe('parseFlashModelIds', () => {
  test('keeps every DeepSeek V4.1 Flash id with its provider and drops the rest', () => {
    const stdout = [
      'ollama/qwen3.8:27b-mlx',
      'deepseek/deepseek-v4.1-flash',
      'opencode-go/deepseek-v4.1-flash',
      'opencode-go/deepseek-v4.1-pro',
      'opencode-go/gpt-5.6-luna',
      '  opencode-go/deepseek_v4.1_flash  ',
      '',
    ].join('\n');
    expect(parseFlashModelIds(stdout)).toEqual([
      'deepseek/deepseek-v4.1-flash',
      'opencode-go/deepseek-v4.1-flash',
      'opencode-go/deepseek_v4.1_flash',
    ]);
  });

  test('finds nothing in an empty or unrelated listing', () => {
    expect(parseFlashModelIds('')).toEqual([]);
    expect(parseFlashModelIds('opencode-go/kimi-k3\n')).toEqual([]);
  });
});

describe('parseLanAddress', () => {
  test('prefers a real LAN interface over loopback and IPv6', () => {
    expect(
      parseLanAddress({
        lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
        utun3: [{ address: '100.64.0.2', family: 'IPv4', internal: false }],
        en1: [{ address: '10.0.0.9', family: 'IPv4', internal: false }],
        en0: [{ address: '192.168.1.23', family: 'IPv4', internal: false }],
      }),
    ).toBe('192.168.1.23');
  });

  test('accepts the numeric family and falls back to any non-internal IPv4', () => {
    expect(
      parseLanAddress({
        bridge0: [{ address: '172.16.4.2', family: 4, internal: false }],
      }),
    ).toBe('172.16.4.2');
  });

  test('returns undefined when the machine is offline', () => {
    expect(parseLanAddress({})).toBeUndefined();
    expect(
      parseLanAddress({ lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }] }),
    ).toBeUndefined();
  });
});

describe('parseDfAvailableGb', () => {
  test('reads the available column of the last row', () => {
    const stdout = [
      'Filesystem     1024-blocks     Used Available Capacity  iused    ifree %iused  Mounted on',
      '/dev/disk3s1s1   971350180 12345678  52428800     5%   123456 12345678    0%   /',
      '',
    ].join('\n');
    expect(parseDfAvailableGb(stdout)).toBeCloseTo(50, 5);
  });

  test('returns undefined for a header-only or broken table', () => {
    expect(parseDfAvailableGb('Filesystem 1024-blocks Used Available\n')).toBeUndefined();
    expect(parseDfAvailableGb('')).toBeUndefined();
    expect(parseDfAvailableGb('Filesystem x\n/dev/a b c d\n')).toBeUndefined();
  });
});

describe('parseOpenFiles', () => {
  test('reads a bare number and tolerates a chatty shell', () => {
    expect(parseOpenFiles('1048576\n')).toBe(1048576);
    expect(parseOpenFiles('  ulimit: 256\n')).toBe(256);
    expect(parseOpenFiles('unlimited')).toBeUndefined();
    expect(parseOpenFiles('')).toBeUndefined();
  });
});

describe('parseRecommendation', () => {
  const text = JSON.stringify({
    mbp: { auditor: 'qwen3.8:27b-mlx', summarizer: 'qwen3.8:27b-mlx' },
    air: { auditor: 'qwen3.6:8b', summarizer: 'qwen3.6:8b' },
  });

  test('reads the profile the machine falls into', () => {
    expect(parseRecommendation(text, 'mbp')).toEqual({
      auditor: 'qwen3.8:27b-mlx',
      summarizer: 'qwen3.8:27b-mlx',
    });
    expect(parseRecommendation(text, 'air')?.auditor).toBe('qwen3.6:8b');
  });

  test('never throws on a broken or partial file', () => {
    expect(parseRecommendation('{not json', 'mbp')).toBeUndefined();
    expect(parseRecommendation('[]', 'mbp')).toBeUndefined();
    expect(parseRecommendation('{"mbp":{}}', 'mbp')).toBeUndefined();
    expect(parseRecommendation('{"mbp":{"auditor":"a"}}', 'mbp')).toBeUndefined();
  });

  test('splits the two bench profiles by RAM', () => {
    expect(profileForRam(32)).toBe('mbp');
    expect(profileForRam(24)).toBe('mbp');
    expect(profileForRam(16)).toBe('air');
  });
});

describe('parseOllamaModelNames', () => {
  test('reads the names out of an /api/tags body', () => {
    expect(parseOllamaModelNames({ models: [{ name: 'a:1' }, { name: 'b:2' }, { size: 3 }] })).toEqual([
      'a:1',
      'b:2',
    ]);
    expect(parseOllamaModelNames({ models: 'nope' })).toEqual([]);
    expect(parseOllamaModelNames(null)).toEqual([]);
  });
});

describe('hasOllamaModel', () => {
  test('matches with and without the :latest tag', () => {
    expect(hasOllamaModel(['qwen3.8:27b-mlx'], 'qwen3.8:27b-mlx')).toBe(true);
    expect(hasOllamaModel(['llama3:latest'], 'llama3')).toBe(true);
    expect(hasOllamaModel(['llama3'], 'llama3:latest')).toBe(true);
    expect(hasOllamaModel(['llama3:8b'], 'llama3:70b')).toBe(false);
  });
});

describe('measureAvailableMemGb', () => {
  const VM_STAT = [
    'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
    'Pages free:                               12345.',
    'Pages active:                            123456.',
    'Pages inactive:                          234567.',
    'Pages speculative:                        12345.',
    'Pages wired down:                         98765.',
  ].join('\n');

  test('sums free, inactive and speculative pages on macOS', async () => {
    const gb = await measureAvailableMemGb({
      cwd: '/repo',
      platform: 'darwin',
      execFn: async () => ({ code: 0, stdout: VM_STAT }),
    });
    expect(gb).toBeCloseTo((259257 * 16384) / 1024 ** 3, 5);
  });

  test('uses the injected free-memory override first', async () => {
    const gb = await measureAvailableMemGb({
      cwd: '/repo',
      platform: 'darwin',
      freeMemGb: () => 7.5,
      execFn: async () => ({ code: 0, stdout: VM_STAT }),
    });
    expect(gb).toBe(7.5);
  });

  test('ignores vm_stat outside macOS and when it fails', async () => {
    const linux = await measureAvailableMemGb({
      cwd: '/repo',
      platform: 'linux',
      execFn: async () => ({ code: 0, stdout: VM_STAT }),
    });
    expect(linux).toBeGreaterThan(0);
    const broken = await measureAvailableMemGb({
      cwd: '/repo',
      platform: 'darwin',
      execFn: async () => {
        throw new Error('vm_stat ENOENT');
      },
    });
    expect(broken).toBeGreaterThan(0);
  });

  test('returns undefined for a vm_stat blob with no pages', () => {
    expect(
      parseVmStatAvailableGb('Mach Virtual Memory Statistics: (page size of 16384 bytes)'),
    ).toBeUndefined();
    expect(parseVmStatAvailableGb('nonsense')).toBeUndefined();
  });
});

describe('port helpers', () => {
  test('reserves a free loopback port', () => {
    const port = freeLoopbackPort();
    expect(port).toBeGreaterThan(0);
  });

  test('reports a freshly reserved port as free', async () => {
    expect(await defaultPortFree(freeLoopbackPort())).toBe(true);
  });
});
