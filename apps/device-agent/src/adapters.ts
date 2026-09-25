/**
 * Hardware adapters for the Device Agent.
 *
 * Every adapter implements one interface, so adding a printer or reader later never
 * touches the POS, the API or any other adapter. This is the only layer in the system
 * that knows a byte ever leaves the machine.
 *
 * The physical make and model of the restaurant's printers and NFC reader are not yet
 * known, and neither is their command set. Rather than guess a protocol, the adapters
 * that need one refuse and say exactly what is missing, following the same discipline as
 * the fiscal provider boundary: an adapter that cannot really deliver must never report
 * success, because a silently discarded kitchen ticket is far worse than a visible
 * failure. `NetworkPrinterAdapter` is the exception: raw TCP is protocol-independent at
 * the transport level, so it can honestly open the socket and report what happened.
 */
import { connect } from 'node:net';

export interface DeliveryResult {
  delivered: boolean;
  /** Distinguishes a printer that is switched off from one that will never work. */
  retryable: boolean;
  error?: string;
}

/** The address the API supplied for a device. Never assembled from client input. */
export interface DeviceTarget {
  kind: string;
  connection: string;
  port: string | null;
  baudRate: number | null;
  host: string | null;
  tcpPort: number | null;
  windowsPrinterName: string | null;
}

export interface DeviceAdapter {
  readonly name: string;
  /** True when this adapter can really drive hardware on this machine. */
  readonly ready: boolean;
  /** Render and deliver one document. Must be safe to call again for the same document. */
  deliver(target: DeviceTarget, document: unknown): Promise<DeliveryResult>;
}

/** Shared wording so every unimplemented transport reports the same missing information. */
const NEEDS_MODEL =
  'requires the printer make, model and command set (for example ESC/POS), the character ' +
  'encoding for Albanian text and the paper width before it can render a document';

/**
 * A serial or USB-serial printer on a COM port.
 *
 * Opening the port is straightforward; what is missing is what to write to it. Without
 * the command set this adapter cannot produce a readable ticket, so it declines.
 */
export class SerialPrinterAdapter implements DeviceAdapter {
  readonly name = 'serial-printer';
  readonly ready = false;
  deliver(target: DeviceTarget): Promise<DeliveryResult> {
    return Promise.resolve({
      delivered: false,
      // Permanent: no amount of retrying supplies a missing specification.
      retryable: false,
      error: `The serial printer adapter for ${target.port ?? 'this port'} ${NEEDS_MODEL}.`,
    });
  }
}

/** A printer presented through the Windows spooler. */
export class WindowsPrinterAdapter implements DeviceAdapter {
  readonly name = 'windows-printer';
  readonly ready = false;
  deliver(target: DeviceTarget): Promise<DeliveryResult> {
    return Promise.resolve({
      delivered: false,
      retryable: false,
      error:
        `The Windows printer adapter for ${target.windowsPrinterName ?? 'this queue'} ${NEEDS_MODEL}. ` +
        'It also needs to know whether the queue accepts raw pass-through printing.',
    });
  }
}

/**
 * A kitchen or bar printer on the LAN.
 *
 * The transport is honest even without the model: a TCP connection either opens or it
 * does not, and that is exactly the difference between a printer that is plugged in and
 * one that is switched off. The document body still needs the command set, so this
 * adapter reports reachability truthfully and declines to claim a print it cannot
 * render. `probe` is what the Test button uses.
 */
export class NetworkPrinterAdapter implements DeviceAdapter {
  readonly name = 'network-printer';
  readonly ready = true;
  constructor(private readonly timeoutMs = 4000) {}

  /** Open and immediately close a socket, to learn whether the device answers. */
  probe(host: string, port: number): Promise<DeliveryResult> {
    return new Promise((resolve) => {
      const socket = connect({ host, port });
      const finish = (result: DeliveryResult) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(result);
      };
      socket.setTimeout(this.timeoutMs);
      socket.once('connect', () => finish({ delivered: true, retryable: false }));
      // A refused or timed-out connection is the normal "printer is off" case, and is
      // always worth retrying once someone switches it on.
      socket.once('timeout', () =>
        finish({ delivered: false, retryable: true, error: `${host}:${port} did not answer` }),
      );
      socket.once('error', (error: NodeJS.ErrnoException) =>
        finish({
          delivered: false,
          retryable: true,
          error: `${host}:${port} is unreachable (${error.code ?? 'error'})`,
        }),
      );
    });
  }

  async deliver(target: DeviceTarget): Promise<DeliveryResult> {
    if (!target.host || !target.tcpPort)
      return { delivered: false, retryable: false, error: 'This printer has no saved address' };
    const reachable = await this.probe(target.host, target.tcpPort);
    if (!reachable.delivered) return reachable;
    return {
      delivered: false,
      retryable: false,
      error: `${target.host}:${target.tcpPort} answered, but the network printer adapter ${NEEDS_MODEL}.`,
    };
  }
}

/** The NFC reader. */
export class NfcReaderAdapter implements DeviceAdapter {
  readonly name = 'nfc-reader';
  readonly ready = false;
  deliver(): Promise<DeliveryResult> {
    return Promise.resolve({
      delivered: false,
      retryable: false,
      error: 'A card reader cannot print',
    });
  }
  /** Wait for a card and return its credential. */
  read(): Promise<{ credential: string | null; error?: string }> {
    return Promise.resolve({
      credential: null,
      error:
        'The NFC adapter requires the reader make and model and its interface: a keyboard-wedge ' +
        'reader types the card id, a serial reader needs its port and protocol, and a PC/SC ' +
        'reader needs the card technology and UID length.',
    });
  }
}

/** Choose the adapter for a saved device. Selection is by configuration, never by input. */
export function adapterFor(target: DeviceTarget): DeviceAdapter {
  if (target.kind === 'NFC_READER') return new NfcReaderAdapter();
  switch (target.connection) {
    case 'NETWORK':
      return new NetworkPrinterAdapter();
    case 'WINDOWS_PRINTER':
      return new WindowsPrinterAdapter();
    case 'USB':
      return target.windowsPrinterName ? new WindowsPrinterAdapter() : new SerialPrinterAdapter();
    default:
      return new SerialPrinterAdapter();
  }
}
