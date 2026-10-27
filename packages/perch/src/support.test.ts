import { describe, expect, test } from 'bun:test';
import type { networkInterfaces } from 'node:os';
import { StarlingError } from '@starling/core';
import { tokensMatch } from './auth';
import { randomJoinCode } from './join-code';
import { findLanIPv4, perchUrl } from './lan';
import { createBonjourAdvertiser, splitServiceType } from './mdns';

type Interfaces = ReturnType<typeof networkInterfaces>;

function interfaces(entries: Array<{ address: string; internal: boolean; family?: string | number }>) {
  const result: Record<string, unknown[]> = {};
  entries.forEach((entry, index) => {
    result[`if${index}`] = [
      {
        address: entry.address,
        netmask: '255.255.255.0',
        family: entry.family ?? 'IPv4',
        mac: '00:11:22:33:44:55',
        internal: entry.internal,
        cidr: `${entry.address}/24`,
      },
    ];
  });
  return result as unknown as Interfaces;
}

describe('tokensMatch', () => {
  test('accepts only the exact join code', () => {
    expect(tokensMatch('ABCD-EFGH', 'ABCD-EFGH')).toBe(true);
    expect(tokensMatch('ABCD-EFGI', 'ABCD-EFGH')).toBe(false);
    expect(tokensMatch('abcd-efgh', 'ABCD-EFGH')).toBe(false);
    expect(tokensMatch('ABCD-EFGH ', 'ABCD-EFGH')).toBe(false);
  });

  test('never matches a missing or empty token', () => {
    expect(tokensMatch(undefined, 'ABCD-EFGH')).toBe(false);
    expect(tokensMatch('', 'ABCD-EFGH')).toBe(false);
    expect(tokensMatch('ABCD-EFGH', '')).toBe(false);
  });
});

describe('randomJoinCode', () => {
  test('is XXXX-XXXX from the unambiguous alphabet', () => {
    for (let i = 0; i < 50; i += 1) {
      const code = randomJoinCode();
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    }
  });

  test('does not repeat', () => {
    const codes = new Set(Array.from({ length: 100 }, () => randomJoinCode()));
    expect(codes.size).toBe(100);
  });
});

describe('findLanIPv4', () => {
  test('skips internal and link-local addresses', () => {
    const found = findLanIPv4(
      interfaces([
        { address: '127.0.0.1', internal: true },
        { address: '169.254.10.1', internal: false },
        { address: '192.168.1.23', internal: false },
        { address: '10.0.0.9', internal: false },
      ]),
    );
    expect(found).toBe('192.168.1.23');
  });

  test('understands the numeric family form', () => {
    const found = findLanIPv4(
      interfaces([
        { address: '::1', internal: false, family: 'IPv6' },
        { address: '10.1.2.3', internal: false, family: 4 },
      ]),
    );
    expect(found).toBe('10.1.2.3');
  });

  test('falls back to loopback when offline, and builds the URL', () => {
    expect(findLanIPv4(interfaces([{ address: '127.0.0.1', internal: true }]))).toBe('127.0.0.1');
    expect(perchUrl('192.168.1.23', 7778)).toBe('http://192.168.1.23:7778');
  });
});

describe('mDNS advertiser', () => {
  test('translates full DNS-SD types for bonjour-service', () => {
    expect(splitServiceType('_starling._tcp')).toEqual({ name: 'starling', protocol: 'tcp' });
    expect(splitServiceType('_http._udp')).toEqual({ name: 'http', protocol: 'udp' });
    expect(splitServiceType('starling')).toEqual({ name: 'starling', protocol: 'tcp' });
  });

  test('refuses to publish after stop without opening a socket', async () => {
    const advertiser = createBonjourAdvertiser();
    await advertiser.stop();
    await expect(advertiser.advertise({ name: 'Air', port: 7778 })).rejects.toBeInstanceOf(StarlingError);
  });
});
