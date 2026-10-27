import { networkInterfaces } from 'node:os';

/** A non-internal IPv4 address in the shape `os.networkInterfaces()` returns. */
interface InterfaceAddress {
  address: string;
  family: string | number;
  internal: boolean;
}

/**
 * The first non-internal IPv4 address, in OS enumeration order.
 *
 * ARCHITECTURE §6 says a perch binds `0.0.0.0` and tells the hub a LAN URL, so this is the address
 * the hub will dial. Link-local (169.254/16) addresses are skipped: they mean DHCP failed and are
 * not routable from the other laptop. When the machine is offline (or only has IPv6) we fall back
 * to loopback so a single-laptop demo still works.
 */
export function findLanIPv4(interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces()): string {
  for (const addresses of Object.values(interfaces)) {
    for (const entry of (addresses ?? []) as InterfaceAddress[]) {
      const isV4 = entry.family === 'IPv4' || entry.family === 4;
      if (!isV4 || entry.internal) continue;
      if (entry.address.startsWith('169.254.')) continue;
      return entry.address;
    }
  }
  return '127.0.0.1';
}

/** The URL a hub should use to reach this perch. */
export function perchUrl(host: string, port: number): string {
  return `http://${host}:${port}`;
}
