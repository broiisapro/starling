/**
 * LAN discovery for perches.
 *
 * The interfaces are tiny and browser-shaped on purpose: tests inject a fake browser and never open a
 * multicast socket (L23), while `createBonjourBrowser`/`createBonjourAdvertiser` wrap
 * `bonjour-service` for real runs. The manual `starling perch --hub ... --code ...` path never needs
 * mDNS, so multicast being blocked on a locked-down wifi degrades to typing a code, not failing.
 */
import Bonjour from 'bonjour-service';

/** The mDNS service type both sides agree on. */
export const STARLING_SERVICE_TYPE = 'starling';
export const STARLING_SERVICE_PROTOCOL = 'tcp';

export interface DiscoveredPerch {
  /** Advertised service name, e.g. "Moksh's MacBook Air". */
  name: string;
  /** Reachable host (IPv4 address when mDNS gave us one, otherwise the `.local` hostname). */
  host: string;
  port: number;
  /** TXT records as strings, e.g. `{ role: 'perch', node: '<ulid>' }`. */
  txt: Record<string, string>;
}

export interface MdnsBrowser {
  /** Start browsing; `onFound` fires for each advertised perch. Returns a stop function. */
  browse(onFound: (perch: DiscoveredPerch) => void): () => void;
  close(): void;
}

export interface MdnsAdvertiser {
  advertise(service: { name: string; port: number; txt?: Record<string, string> }): void;
  stop(): void;
}

/** `http://host:port`, with brackets for IPv6 literals. */
export function perchUrl(perch: Pick<DiscoveredPerch, 'host' | 'port'>): string {
  const host = perch.host.includes(':') ? `[${perch.host}]` : perch.host;
  return `http://${host}:${perch.port}`;
}

interface BonjourLikeService {
  name: string;
  host: string;
  port: number;
  txt?: Record<string, unknown>;
  addresses?: string[];
}

function toDiscoveredPerch(service: BonjourLikeService): DiscoveredPerch {
  const ipv4 = service.addresses?.find((address) => /^\d+\.\d+\.\d+\.\d+$/.test(address));
  const txt: Record<string, string> = {};
  for (const [key, value] of Object.entries(service.txt ?? {})) {
    if (value !== undefined && value !== null) txt[key] = String(value);
  }
  return {
    name: service.name,
    host: ipv4 ?? service.host,
    port: service.port,
    txt,
  };
}

/**
 * Browse for `_starling._tcp` services.
 *
 * bonjour-service's `find({type})` expects the bare service name; it appends `_tcp.local` itself.
 */
export function createBonjourBrowser(opts: { type?: string } = {}): MdnsBrowser {
  const bonjour = new Bonjour();
  const type = opts.type ?? STARLING_SERVICE_TYPE;
  let browser: ReturnType<Bonjour['find']> | undefined;

  return {
    browse(onFound) {
      browser = bonjour.find({ type, protocol: STARLING_SERVICE_PROTOCOL }, (service) => {
        onFound(toDiscoveredPerch(service as unknown as BonjourLikeService));
      });
      return () => {
        browser?.stop();
        browser = undefined;
      };
    },
    close() {
      browser?.stop();
      browser = undefined;
      bonjour.destroy();
    },
  };
}

/** Advertise this machine as a perch. `stop()` sends mDNS goodbyes. */
export function createBonjourAdvertiser(opts: { type?: string } = {}): MdnsAdvertiser {
  const bonjour = new Bonjour();
  const type = opts.type ?? STARLING_SERVICE_TYPE;
  let published: ReturnType<Bonjour['publish']> | undefined;

  return {
    advertise(service) {
      published?.stop();
      published = bonjour.publish({
        name: service.name,
        type,
        protocol: STARLING_SERVICE_PROTOCOL,
        port: service.port,
        txt: service.txt,
      });
    },
    stop() {
      published?.stop();
      published = undefined;
      bonjour.destroy();
    },
  };
}
