import { ErrorCode, ZeroXIOWalletError } from './types';
import { EventEmitter } from './events';
import { createLogger } from './utils';

/**
 * Direct link from a page to 0xio Desktop over its local socket, used when no 0xio extension
 * answers. The browser sets the Origin header and the desktop names the site from it, so no
 * frame here carries a site or origin field. Every request is reviewed in the desktop menu bar.
 */

export const DESKTOP_WS_URL = 'ws://127.0.0.1:19345';
export const DESKTOP_CONNECT_TIMEOUT_MS = 800;
export const DESKTOP_PROMPT_CONNECT_TIMEOUT_MS = 20_000;
export const DESKTOP_HELLO_TIMEOUT_MS = 2_000;
export const DESKTOP_READ_TIMEOUT_MS = 60_000;
export const DESKTOP_REVIEW_TIMEOUT_MS = 600_000;
export const DESKTOP_RETRY_BASE_MS = 1_000;
export const DESKTOP_RETRY_MAX_MS = 30_000;

/** Methods that wait for a review in the menu bar or run a long proof. */
const LONG_METHODS = new Set([
  'connect', 'switch_network',
  'send_transaction', 'sendTransaction', 'call_contract', 'callContract',
  'deploy_contract', 'deployContract', 'signMessage', 'sign_transaction', 'signTransaction',
  'broadcast_only', 'send_contract_transaction_sequence', 'register_private_view_key',
  'send_private_transfer', 'claim_private_transfer', 'encrypt_balance', 'decrypt_balance',
  'make_zero_proof', 'make_range_proof', 'decrypt_value', 'encrypt_value', 'get_private_balance',
]);

/** Methods that open a review: one at a time per page, as with the extension. */
const REVIEW_METHODS = new Set([
  'connect', 'switch_network',
  'send_transaction', 'sendTransaction', 'call_contract', 'callContract',
  'deploy_contract', 'deployContract', 'signMessage', 'sign_transaction', 'signTransaction',
  'broadcast_only', 'send_contract_transaction_sequence', 'register_private_view_key',
  'send_private_transfer', 'claim_private_transfer', 'encrypt_balance', 'decrypt_balance',
]);

const CODE_MAP: Record<string, ErrorCode> = {
  RATE_LIMITED: ErrorCode.RATE_LIMIT_EXCEEDED,
  AUTH_REQUIRED: ErrorCode.NETWORK_ERROR,
  PAIRING_REQUIRED: ErrorCode.NETWORK_ERROR,
  AUTH_FAILED: ErrorCode.NETWORK_ERROR,
};

/** The desktop's error code as the SDK reads it: A-Z and _ pass through, auth codes become NETWORK_ERROR. */
export function desktopErrorCode(code: unknown): ErrorCode {
  if (typeof code !== 'string' || !/^[A-Z_]{1,64}$/.test(code)) return ErrorCode.UNKNOWN_ERROR;
  return CODE_MAP[code] ?? (code as ErrorCode);
}

/** A desktop error reply as a ZeroXIOWalletError. */
export function desktopError(reply: any): ZeroXIOWalletError {
  const e = reply?.error;
  if (e && typeof e === 'object') {
    const message = typeof e.message === 'string' && e.message ? e.message.slice(0, 500) : 'Request failed on 0xio Desktop.';
    return new ZeroXIOWalletError(desktopErrorCode(e.code), message);
  }
  if (typeof e === 'string' && e) {
    return new ZeroXIOWalletError(desktopErrorCode(reply.code), e.slice(0, 500));
  }
  return new ZeroXIOWalletError(ErrorCode.UNKNOWN_ERROR, 'No answer from 0xio Desktop.');
}

/**
 * A desktop site event as the SDK event the extension would deliver, or null for an unknown kind.
 */
export function desktopSiteEvent(kind: unknown, data: any): { type: 'disconnect' | 'accountChanged' | 'networkChanged' | 'transactionConfirmed' | 'transactionFailed' | 'extensionLocked'; data: any } | null {
  switch (kind) {
    case 'accountsChanged': {
      const accounts = Array.isArray(data?.accounts)
        ? data.accounts.filter((a: unknown) => typeof a === 'string' && a)
        : [];
      if (!accounts.length) return { type: 'disconnect', data: { reason: 'user_action' } };
      return {
        type: 'accountChanged',
        data: {
          address: accounts[0],
          ...(typeof data?.publicKey === 'string' ? { publicKey: data.publicKey } : {}),
          ...(typeof data?.canSign === 'boolean' ? { canSign: data.canSign } : {}),
        },
      };
    }
    case 'networkChanged': {
      if (!data || typeof data !== 'object') return null;
      const networkInfo = data.networkInfo && typeof data.networkInfo === 'object' ? data.networkInfo : data;
      return { type: 'networkChanged', data: { networkInfo } };
    }
    case 'tx': {
      if (!data || typeof data !== 'object') return null;
      const txHash = typeof data.txHash === 'string' ? data.txHash : data.hash;
      const failed = data.status === 'failed' || data.status === 'rejected' || data.status === 'dropped';
      return { type: failed ? 'transactionFailed' : 'transactionConfirmed', data: { ...data, txHash } };
    }
    case 'lock':
      return { type: 'extensionLocked', data: {} };
    default:
      return null;
  }
}

/**
 * Whether this page may try 0xio Desktop: a browser page with WebSocket, on https in a secure
 * context, or on plain http only for localhost development.
 */
export function canUseDesktopTransport(win: any = typeof window !== 'undefined' ? window : undefined): boolean {
  if (!win || typeof (globalThis as any).WebSocket !== 'function') return false;
  const loc = win.location;
  if (!loc || typeof loc.protocol !== 'string') return false;
  if (loc.protocol === 'https:') return win.isSecureContext === true;
  if (loc.protocol === 'http:') {
    const host = String(loc.hostname || '');
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  }
  return false;
}

export type LocalNetworkState = 'granted' | 'denied' | 'prompt' | 'unknown';

/** Chrome's local network permission for this page; `unknown` when the browser does not report one. */
export async function localNetworkPermission(): Promise<LocalNetworkState> {
  const perms = (globalThis as any).navigator?.permissions;
  if (!perms || typeof perms.query !== 'function') return 'unknown';
  for (const name of ['loopback-network', 'local-network-access']) {
    try {
      const status = await perms.query({ name });
      const state = status?.state;
      if (state === 'granted' || state === 'denied' || state === 'prompt') return state;
    } catch {
      // name not known to this browser
    }
  }
  return 'unknown';
}

function wireId(): string {
  const c = (globalThis as any).crypto;
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  throw new ZeroXIOWalletError(
    ErrorCode.UNKNOWN_ERROR,
    'Cryptographic random number generation is not available in this environment'
  );
}

const validNetworkId = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-z0-9_-]{1,32}$/.test(v);

export interface DesktopTransportOptions {
  debug?: boolean;
  /** The network the site asked for in SDKConfig; the desktop's answer replaces it. */
  networkId?: string;
  /** For tests. */
  url?: string;
  /** For tests. */
  connectTimeoutMs?: number;
}

interface Pending {
  id: string;
  method: string;
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * The same request and event surface as the extension transport, over the desktop's socket.
 * The socket opens lazily: after a drop the next request reopens it, with a growing pause after
 * failed attempts so a closed desktop is never hammered.
 */
export class DesktopTransport extends EventEmitter {
  private ws: WebSocket | null = null;
  private opening: Promise<boolean> | null = null;
  private seq = 0;
  private replies = new Map<number, Pending>();
  private failures = 0;
  private retryAt = 0;
  private ready = false;
  private closed = false;
  private interactiveInFlight = false;
  private network: string;
  private version: string | undefined;
  private logger: ReturnType<typeof createLogger>;
  private readonly url: string;
  private readonly connectTimeoutMs: number | undefined;
  private pageHide: (() => void) | null = null;

  constructor(options: DesktopTransportOptions = {}) {
    super(options.debug);
    this.logger = createLogger('DesktopTransport', !!options.debug);
    this.network = validNetworkId(options.networkId) ? options.networkId : 'mainnet';
    this.url = options.url ?? DESKTOP_WS_URL;
    this.connectTimeoutMs = options.connectTimeoutMs;
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      this.pageHide = () => this.drop('The page closed before 0xio Desktop answered.', true);
      window.addEventListener('pagehide', this.pageHide);
    }
  }

  /** Opens the socket and checks the desktop says hello. False when it is not there. */
  async initialize(): Promise<boolean> {
    if (this.closed) return false;
    const ok = await this.ensureOpen(true);
    if (ok) this.ready = true;
    return ok;
  }

  isExtensionAvailable(): boolean {
    return this.ready && !this.closed;
  }

  get desktopVersion(): string | undefined {
    return this.version;
  }

  get networkId(): string {
    return this.network;
  }

  async sendRequest<T = any>(method: string, params: any = {}, timeout = 30000): Promise<T> {
    if (this.closed) {
      throw new ZeroXIOWalletError(ErrorCode.NETWORK_ERROR, 'The 0xio Desktop link was closed');
    }
    const review = REVIEW_METHODS.has(method);
    if (review && this.interactiveInFlight) {
      throw new ZeroXIOWalletError(
        ErrorCode.RATE_LIMIT_EXCEEDED,
        'Another request is already waiting for review in 0xio Desktop. Please wait for it to complete.'
      );
    }
    if (review) this.interactiveInFlight = true;
    try {
      if (!(await this.ensureOpen(false)) || !this.ws) {
        throw new ZeroXIOWalletError(ErrorCode.NETWORK_ERROR, '0xio Desktop is not reachable.');
      }
      const network = method === 'connect' && validNetworkId(params?.networkId) ? params.networkId : this.network;
      const wait = LONG_METHODS.has(method)
        ? DESKTOP_REVIEW_TIMEOUT_MS
        : Math.max(timeout, DESKTOP_READ_TIMEOUT_MS);
      const id = wireId();
      const reply = await this.call(
        'site_request',
        { id, network, request: { method, params: params ?? {} } },
        wait,
        { id, method }
      );
      if (reply && typeof reply === 'object' && 'result' in reply) {
        this.learnNetwork(method, params, reply.result);
        return reply.result as T;
      }
      throw desktopError(reply);
    } finally {
      if (review) this.interactiveInFlight = false;
    }
  }

  /** Sends one frame and waits for the reply with the same `_id`. */
  private call(
    method: string,
    args: Record<string, unknown>,
    timeoutMs: number,
    site?: { id: string; method: string }
  ): Promise<any> {
    const ws = this.ws;
    if (!ws) return Promise.reject(new ZeroXIOWalletError(ErrorCode.NETWORK_ERROR, '0xio Desktop is not reachable.'));
    const _id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const p = this.replies.get(_id);
        if (!p) return;
        this.replies.delete(_id);
        if (site) this.cancel(site.id);
        reject(new ZeroXIOWalletError(
          ErrorCode.NETWORK_ERROR,
          `0xio Desktop did not answer in time (${timeoutMs}ms)`,
          { method: site?.method ?? method }
        ));
      }, timeoutMs);
      this.replies.set(_id, { id: site?.id ?? '', method: site?.method ?? method, resolve, reject, timer });
      let frame: string;
      try {
        frame = JSON.stringify({ v: 1, _id, method, ...args });
      } catch {
        clearTimeout(timer);
        this.replies.delete(_id);
        reject(new ZeroXIOWalletError(ErrorCode.UNKNOWN_ERROR, 'Request params are not serializable', { method }));
        return;
      }
      try {
        ws.send(frame);
      } catch {
        clearTimeout(timer);
        this.replies.delete(_id);
        reject(new ZeroXIOWalletError(ErrorCode.NETWORK_ERROR, '0xio Desktop is not reachable.'));
      }
    });
  }

  /** Asks the desktop to drop one waiting request. Best effort; no reply is awaited. */
  private cancel(id: string): void {
    if (!id || !this.ws) return;
    try {
      this.ws.send(JSON.stringify({ v: 1, _id: ++this.seq, method: 'site_cancel', id }));
    } catch {
      // socket already gone: the desktop drops the request with the connection
    }
  }

  /** A live socket, opening one when needed. Without `force`, waits out the pause after failures. */
  private async ensureOpen(force: boolean): Promise<boolean> {
    if (this.ws) return true;
    if (this.closed) return false;
    if (!force && Date.now() < this.retryAt) return false;
    if (!this.opening) {
      this.opening = this.open().finally(() => {
        this.opening = null;
      });
    }
    const ok = await this.opening;
    if (ok) {
      this.failures = 0;
      this.retryAt = 0;
    } else {
      this.failures += 1;
      this.retryAt = Date.now() + Math.min(DESKTOP_RETRY_BASE_MS * 2 ** (this.failures - 1), DESKTOP_RETRY_MAX_MS);
    }
    return ok;
  }

  private async open(): Promise<boolean> {
    const Ctor = (globalThis as any).WebSocket;
    if (typeof Ctor !== 'function') return false;
    const permission = await localNetworkPermission();
    if (permission === 'denied') {
      this.logger.log('Local network access is denied for this page; not trying 0xio Desktop');
      return false;
    }
    const connectMs = this.connectTimeoutMs
      ?? (permission === 'prompt' ? DESKTOP_PROMPT_CONNECT_TIMEOUT_MS : DESKTOP_CONNECT_TIMEOUT_MS);

    const ws: WebSocket | null = await new Promise((resolve) => {
      let sock: WebSocket;
      try {
        sock = new Ctor(this.url);
      } catch {
        resolve(null);
        return;
      }
      const timer = setTimeout(() => {
        sock.onopen = sock.onerror = sock.onclose = null;
        try { sock.close(); } catch { /* not open */ }
        resolve(null);
      }, connectMs);
      sock.onopen = () => {
        clearTimeout(timer);
        resolve(sock);
      };
      sock.onerror = sock.onclose = () => {
        clearTimeout(timer);
        sock.onopen = sock.onerror = sock.onclose = null;
        resolve(null);
      };
    });
    if (!ws) return false;
    if (this.closed) {
      try { ws.close(); } catch { /* closing */ }
      return false;
    }

    ws.onmessage = (ev: MessageEvent) => this.onMessage(ws, ev);
    ws.onclose = () => this.onClose(ws);
    ws.onerror = null;
    this.ws = ws;

    try {
      const hello = await this.call('site_hello', {}, DESKTOP_HELLO_TIMEOUT_MS);
      if (hello?.v !== 1 || hello?.wallet !== '0xio-desktop') {
        throw new Error('not 0xio Desktop');
      }
      if (typeof hello.version === 'string') this.version = hello.version.slice(0, 32);
      if (validNetworkId(hello.network)) this.network = hello.network;
      const sub = await this.call('sites_subscribe', {}, DESKTOP_HELLO_TIMEOUT_MS);
      if (sub?.error) this.logger.warn('0xio Desktop refused the event subscription:', sub.error);
      this.logger.log('Connected to 0xio Desktop', { version: this.version, network: this.network });
      return true;
    } catch (e) {
      this.logger.log('0xio Desktop hello failed:', e);
      if (this.ws === ws) this.ws = null;
      ws.onmessage = ws.onclose = null;
      this.failAll('0xio Desktop is not reachable.');
      try { ws.close(); } catch { /* closing */ }
      return false;
    }
  }

  private onMessage(ws: WebSocket, ev: MessageEvent): void {
    if (this.ws !== ws) return;
    let msg: any;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (typeof msg._id === 'number') {
      const p = this.replies.get(msg._id);
      if (!p) return;
      if (p.id && typeof msg.id === 'string' && msg.id.toLowerCase() !== p.id) return;
      this.replies.delete(msg._id);
      clearTimeout(p.timer);
      p.resolve(msg);
      return;
    }
    if (msg.event === 'site_event') this.onSiteEvent(msg);
  }

  private onSiteEvent(msg: any): void {
    const own = typeof window !== 'undefined' ? window.location?.origin : undefined;
    if (typeof msg.origin === 'string' && own && msg.origin !== own) return;
    const ev = desktopSiteEvent(msg.kind, msg.data);
    if (!ev) return;
    if (ev.type === 'networkChanged' && validNetworkId(ev.data.networkInfo?.id)) {
      this.network = ev.data.networkInfo.id;
    }
    this.emit(ev.type, ev.data);
  }

  private onClose(ws: WebSocket): void {
    if (this.ws !== ws) return;
    this.ws = null;
    this.failAll('0xio Desktop disconnected before it answered.');
    this.logger.warn('0xio Desktop link closed');
    if (!this.closed) this.emit('disconnect', { reason: 'network_error' });
  }

  private failAll(message: string): void {
    const all = [...this.replies.values()];
    this.replies.clear();
    for (const p of all) {
      clearTimeout(p.timer);
      p.reject(new ZeroXIOWalletError(ErrorCode.NETWORK_ERROR, message, { method: p.method }));
    }
  }

  /** Cancels every waiting request on the desktop and closes the socket. */
  private drop(message: string, cancelPending: boolean): void {
    const ws = this.ws;
    if (!ws) return;
    if (cancelPending) {
      for (const p of this.replies.values()) this.cancel(p.id);
    }
    this.ws = null;
    ws.onmessage = ws.onclose = null;
    this.failAll(message);
    try { ws.close(); } catch { /* closing */ }
  }

  private learnNetwork(method: string, params: any, result: any): void {
    let next: unknown;
    if (method === 'connect' || method === 'getConnectionStatus') {
      next = result?.networkInfo?.id ?? result?.networkId;
    } else if (method === 'get_network_info' || method === 'getNetworkInfo') {
      next = result?.id;
    } else if (method === 'switch_network' && result?.switched) {
      next = result.network ?? params?.networkId ?? params?.network;
    }
    if (validNetworkId(next)) this.network = next;
  }

  /** Terminal: cancels waiting requests on the desktop, closes the socket and stops listening. */
  cleanup(): void {
    this.drop('SDK cleanup called', true);
    this.closed = true;
    this.ready = false;
    this.interactiveInFlight = false;
    if (this.pageHide && typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.pageHide);
    }
    this.pageHide = null;
    this.removeAllListeners();
  }

  getDebugInfo(): { transport: 'desktop'; connected: boolean; pendingRequests: number; desktopVersion?: string; network: string } {
    return {
      transport: 'desktop',
      connected: !!this.ws,
      pendingRequests: this.replies.size,
      desktopVersion: this.version,
      network: this.network,
    };
  }
}
