import { StarlingError } from '@starling/core';
import type { MdnsAdvertiseOptions, MdnsAdvertiser } from './handshake';

/** The DNS-SD service type every Starling perch advertises (ARCHITECTURE L19). */
export const STARLING_SERVICE_TYPE = '_starling._tcp';

/** The slice of `bonjour-service` we use, so the dependency stays lazily loaded and typed. */
interface BonjourServiceHandle {
  stop(): void;
}

interface BonjourInstance {
  publish(opts: {
    name: string;
    type: string;
    port: number;
    protocol?: 'tcp' | 'udp';
    txt?: Record<string, string>;
  }): BonjourServiceHandle;
  destroy(): void;
}

type BonjourCtor = new (opts?: unknown, onError?: (err: unknown) => void) => BonjourInstance;

export interface BonjourAdvertiserOptions {
  /** Full DNS-SD type, e.g. `_starling._tcp`. */
  serviceType?: string;
  /** mDNS is best-effort; a socket error must not take the perch down. */
  onError?: (err: unknown) => void;
}

/**
 * Publish this perch with `bonjour-service`.
 *
 * `bonjour-service` is imported dynamically: unit tests never construct it (it opens a multicast
 * socket, which ARCHITECTURE L23 forbids in build waves), and `bun test` should not pay its load
 * cost. The advertised type is the full `_starling._tcp`; Bonjour wants the bare name and protocol,
 * so we translate (passing `_starling._tcp` straight through would advertise `__starling._tcp._tcp`).
 */
export function createBonjourAdvertiser(opts: BonjourAdvertiserOptions = {}): MdnsAdvertiser {
  const defaultType = opts.serviceType ?? STARLING_SERVICE_TYPE;
  const onError = opts.onError ?? (() => undefined);
  let instance: BonjourInstance | undefined;
  let service: BonjourServiceHandle | undefined;
  let stopped = false;

  const load = async (): Promise<BonjourCtor> => {
    const mod = (await import('bonjour-service')) as unknown as { default?: BonjourCtor } & BonjourCtor;
    const ctor = mod.default ?? mod;
    if (typeof ctor !== 'function') {
      throw new StarlingError('UNKNOWN', 'bonjour-service did not export a Bonjour constructor');
    }
    return ctor;
  };

  return {
    async advertise(advertise: MdnsAdvertiseOptions): Promise<void> {
      if (stopped) {
        throw new StarlingError('INVALID_ARGUMENT', 'mDNS advertiser has already stopped');
      }
      const Ctor = await load();
      instance ??= new Ctor(undefined, onError);
      service?.stop();

      const { name, protocol } = splitServiceType(advertise.type ?? defaultType);
      service = instance.publish({
        name: advertise.name,
        type: name,
        port: advertise.port,
        protocol,
        txt: advertise.txt,
      });
    },

    async stop(): Promise<void> {
      stopped = true;
      service?.stop();
      service = undefined;
      instance?.destroy();
      instance = undefined;
    },
  };
}

/** `_starling._tcp` → `{ name: 'starling', protocol: 'tcp' }`. */
export function splitServiceType(serviceType: string): { name: string; protocol: 'tcp' | 'udp' } {
  const match = /^_([^.]+)\._(tcp|udp)$/.exec(serviceType);
  if (match !== null) {
    return {
      name: match[1] ?? serviceType.replace(/^_/, ''),
      protocol: match[2] === 'udp' ? 'udp' : 'tcp',
    };
  }
  return { name: serviceType.replace(/^_/, ''), protocol: 'tcp' };
}
