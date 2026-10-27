// MIRROR of ARCHITECTURE §8. Moved into @starling/core at checkpoint C1.
//
// The perch implements the *server* side of the flock handshake. Everything the Perch API carries
// (StartTaskOptions, TaskHandle, TaskResult, NodeInfo, AgentEvent) is already frozen in
// `@starling/core`, so the only shape mirrored here is the mDNS advertiser that Epic 30 declares in
// `packages/flock/src/mdns.ts`. It is declared locally (never imported from the sibling package) so
// Wave 1 packages stay independent; at C1 both copies move into core and this file is deleted.

/** One service to publish on the LAN. `type` defaults to `_starling._tcp`. */
export interface MdnsAdvertiseOptions {
  /** Human-readable service name, e.g. "Moksh's MacBook Air". */
  name: string;
  /** Bonjour service type. Defaults to `_starling._tcp`. */
  type?: string;
  /** TCP port the Perch API listens on. */
  port: number;
  /** TXT records. The perch publishes its join code and node name here. */
  txt?: Record<string, string>;
}

/**
 * Advertise this perch over mDNS (ARCHITECTURE L19). Implementations must be safe to call once and
 * to stop twice; `stop()` unpublishes the service and releases the socket.
 */
export interface MdnsAdvertiser {
  advertise(opts: MdnsAdvertiseOptions): void | Promise<void>;
  stop(): void | Promise<void>;
}
