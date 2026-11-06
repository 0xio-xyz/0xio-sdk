import { ErrorCode, RequestStatusValue, WalletInfo, WalletProtocolVersion, ZeroXIOWalletError } from './types';
import { EventEmitter } from './events';
import { createLogger } from './utils';
import { RequestMeta, isRequestId, isRequestStatusValue, parseRequestStatus, parseWalletHello, statusRank } from './lifecycle';

// Any local program can send an Origin header, so the page also proves itself with its site token.

export const DESKTOP_WS_URL = 'ws://127.0.0.1:19345';
export const DESKTOP_CONNECT_TIMEOUT_MS = 800;
export const DESKTOP_PROMPT_CONNECT_TIMEOUT_MS = 20_000;
export const DESKTOP_HELLO_TIMEOUT_MS = 2_000;
export const DESKTOP_READ_TIMEOUT_MS = 60_000;
export const DESKTOP_REVIEW_TIMEOUT_MS = 600_000;
export const DESKTOP_RETRY_BASE_MS = 1_000;
export const DESKTOP_RETRY_MAX_MS = 30_000;
export const DESKTOP_SITE_TOKEN_KEY = '0xio:desktop-site-token';

const SITE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function pageStorage(): Storage | undefined {
  try {
    return typeof window !== 'undefined' ? (window.localStorage ?? undefined) : undefined;
  } catch {
    return undefined;
  }
}

export function readSiteToken(): string | null {
  try {
    const t = pageStorage()?.getItem(DESKTOP_SITE_TOKEN_KEY);
    return typeof t === 'string' && SITE_TOKEN_RE.test(t) ? t : null;
  } catch {
    return null;
  }
}

function writeSiteToken(token: string): void {
  try {
    pageStorage()?.setItem(DESKTOP_SITE_TOKEN_KEY, token);
  } catch {
    // storage blocked: the next connection needs a connect review again
  }
}

export function clearSiteToken(): void {
  try {
    pageStorage()?.removeItem(DESKTOP_SITE_TOKEN_KEY);
  } catch {
    // storage blocked: nothing kept
  }
}

const LONG_METHODS = new Set([
  'connect', 'switch_network',
  'send_transaction', 'sendTransaction', 'call_contract', 'callContract',
  'deploy_contract', 'deployContract', 'signMessage', 'sign_transaction', 'signTransaction',
  'broadcast_only', 'send_contract_transaction_sequence', 'register_private_view_key',
  'send_private_transfer', 'claim_private_transfer', 'encrypt_balance', 'decrypt_balance',
  'make_zero_proof', 'make_range_proof', 'decrypt_value', 'encrypt_value', 'get_private_balance',
]);

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

/** A-Z and _ pass through; auth codes become NETWORK_ERROR. */
export function desktopErrorCode(code: unknown): ErrorCode {
  if (typeof code !== 'string' || !/^[A-Z_]{1,64}$/.test(code)) return ErrorCode.UNKNOWN_ERROR;
  return CODE_MAP[code] ?? (code as ErrorCode);
}

export function desktopError(reply: any): ZeroXIOWalletError {
  const e = reply?.error;
  if (e && typeof e === 'object') {
    const message = typeof e.message === 'string' && e.message ? e.message.slice(0, 500) : 'Request failed on 0xio Desktop.';
    const status = e.status ?? e.details?.status ?? reply.status;
    const reason = e.code === 'RATE_LIMITED' ? 'requests_per_second' : e.code === 'RATE_LIMIT_EXCEEDED' ? 'open_requests' : undefined;
    const details = {
      ...(isRequestStatusValue(status) ? { status } : {}),
      ...(reason ? { reason } : {}),
    };
    return new ZeroXIOWalletError(desktopErrorCode(e.code), message, Object.keys(details).length ? details : undefined);
  }
  if (typeof e === 'string' && e) {
    return new ZeroXIOWalletError(desktopErrorCode(reply.code), e.slice(0, 500));
  }
  return new ZeroXIOWalletError(ErrorCode.UNKNOWN_ERROR, 'No answer from 0xio Desktop.');
}

export function desktopSiteEvent(kind: unknown, data: any): { type: 'disconnect' | 'accountChanged' | 'networkChanged' | 'transactionConfirmed' | 'transactionFailed' | 'extensionLocked' | 'requestUpdate'; data: any } | null {
  switch (kind) {
    case 'request': {
      const status = parseRequestStatus(data);
      return status ? { type: 'requestUpdate', data: status } : null;
    }
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

/** https in a secure context, or plain http only on localhost. */
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

export async function localNetworkPermissionStatus(): Promise<{ state: LocalNetworkState; status: any }> {
  const perms = (globalThis as any).navigator?.permissions;
  if (!perms || typeof perms.query !== 'function') return { state: 'unknown', status: null };
  for (const name of ['loopback-network', 'local-network-access']) {
    try {
      const status = await perms.query({ name });
      const state = status?.state;
      if (state === 'granted' || state === 'denied' || state === 'prompt') return { state, status };
    } catch {
      // name not known to this browser
    }
  }
  return { state: 'unknown', status: null };
}

/** `unknown` when the browser has no such permission. */
export async function localNetworkPermission(): Promise<LocalNetworkState> {
  return (await localNetworkPermissionStatus()).state;
}

function watchPermission(status: any, fn: (state: unknown) => void): () => void {
  if (!status) return () => {};
  const handler = () => fn(status.state);
  if (typeof status.addEventListener === 'function') {
    status.addEventListener('change', handler);
    return () => status.removeEventListener?.('change', handler);
  }
  if ('onchange' in status) {
    const previous = status.onchange;
    status.onchange = handler;
    return () => {
      if (status.onchange === handler) status.onchange = previous ?? null;
    };
  }
  return () => {};
}

export type DesktopFailure = 'blocked' | 'not-running' | 'unknown-until-connect';

/** Only when the browser would not prompt: the probe itself would show the prompt. */
export async function probeDesktop(
  url: string = DESKTOP_WS_URL,
  timeoutMs: number = DESKTOP_CONNECT_TIMEOUT_MS
): Promise<{ running: boolean; version?: string; protocol?: WalletProtocolVersion }> {
  const Ctor = (globalThis as any).WebSocket;
  if (typeof Ctor !== 'function') return { running: false };
  return new Promise((resolve) => {
    let sock: WebSocket;
    let done = false;
    const finish = (out: { running: boolean; version?: string; protocol?: WalletProtocolVersion }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.onopen = sock.onmessage = sock.onerror = sock.onclose = null;
      try { sock.close(); } catch { /* not open */ }
      resolve(out);
    };
    try {
      sock = new Ctor(url);
    } catch {
      resolve({ running: false });
      return;
    }
    const timer = setTimeout(() => finish({ running: false }), timeoutMs * 2);
    sock.onopen = () => {
      try {
        sock.send(JSON.stringify({ v: 1, _id: 1, method: 'site_hello' }));
      } catch {
        finish({ running: false });
      }
    };
    sock.onmessage = (ev: MessageEvent) => {
      let msg: any;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg?._id !== 1) return;
      if (msg.v !== 1 || msg.wallet !== '0xio-desktop') {
        finish({ running: false });
        return;
      }
      const info = parseWalletHello({ ...msg, kind: 'desktop' }, 'desktop');
      finish({ running: true, ...(info.version ? { version: info.version } : {}), protocol: info.protocol });
    };
    sock.onerror = sock.onclose = () => finish({ running: false });
  });
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
  /** The desktop's answer replaces it. */
  networkId?: string;
  /** For tests. */
  url?: string;
  /** For tests. */
  connectTimeoutMs?: number;
}

interface Pending {
  id: string;
  method: string;
  rid?: string;
  status?: RequestStatusValue;
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  restart?: () => void;
}

/** Reopens lazily after a drop, pausing longer after each failure so a closed desktop is not hammered. */
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
  private interactiveRid: string | null = null;
  private network: string;
  private version: string | undefined;
  private protocol: WalletProtocolVersion = 1;
  private capabilities: readonly string[] = [];
  private failure: DesktopFailure | null = null;
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

  get lastFailure(): DesktopFailure | null {
    return this.failure;
  }

  async walletHello(): Promise<WalletInfo> {
    return Object.freeze({
      kind: 'desktop' as const,
      ...(this.version ? { version: this.version } : {}),
      protocol: this.protocol,
      capabilities: this.capabilities,
    });
  }

  get walletInfo(): WalletInfo | null {
    if (!this.ready) return null;
    return {
      kind: 'desktop',
      ...(this.version ? { version: this.version } : {}),
      protocol: this.protocol,
      capabilities: this.capabilities,
    };
  }

  touchRequest(rid: string): void {
    for (const p of this.replies.values()) {
      if (p.rid === rid) p.restart?.();
    }
  }

  async queryRequestStatus(rid: string): Promise<unknown> {
    if (this.protocol !== 2) {
      throw new ZeroXIOWalletError(ErrorCode.UNSUPPORTED_METHOD, 'This 0xio Desktop keeps no request status');
    }
    if (!(await this.ensureOpen(false)) || !this.ws) {
      throw new ZeroXIOWalletError(ErrorCode.NETWORK_ERROR, '0xio Desktop is not reachable.');
    }
    const reply = await this.call('site_status', { rid }, DESKTOP_HELLO_TIMEOUT_MS * 5);
    if (reply && typeof reply === 'object' && 'result' in reply) return reply.result;
    throw desktopError(reply);
  }

  /** A protocol 1 desktop can only drop a request this page is still waiting for. */
  async cancelRequestOnWallet(rid: string): Promise<unknown> {
    const waiting = [...this.replies.values()].find((p) => p.rid === rid);
    if (this.protocol !== 2) {
      if (!waiting) {
        throw new ZeroXIOWalletError(ErrorCode.UNSUPPORTED_METHOD, 'This 0xio Desktop cannot cancel a request it is not waiting on');
      }
      this.cancel(waiting.id);
      return null;
    }
    if (!(await this.ensureOpen(false)) || !this.ws) {
      throw new ZeroXIOWalletError(ErrorCode.NETWORK_ERROR, '0xio Desktop is not reachable.');
    }
    const reply = await this.call('site_cancel', { ...(waiting ? { id: waiting.id } : {}), rid }, DESKTOP_HELLO_TIMEOUT_MS * 5);
    if (reply && typeof reply === 'object' && 'result' in reply) return reply.result;
    if (reply?.error) throw desktopError(reply);
    return null;
  }

  get networkId(): string {
    return this.network;
  }

  async sendRequest<T = any>(method: string, params: any = {}, timeout = 30000, meta?: RequestMeta): Promise<T> {
    if (this.closed) {
      throw new ZeroXIOWalletError(ErrorCode.NETWORK_ERROR, 'The 0xio Desktop link was closed');
    }
    const rid = meta && isRequestId(meta.rid) ? meta.rid : undefined;
    const review = REVIEW_METHODS.has(method);
    const reattach = review && this.interactiveInFlight && !!rid && rid === this.interactiveRid;
    const ownsLock = review && !reattach;
    if (ownsLock && this.interactiveInFlight) {
      throw new ZeroXIOWalletError(
        ErrorCode.RATE_LIMIT_EXCEEDED,
        'Another request is already waiting for review in 0xio Desktop. Please wait for it to complete.',
        this.interactiveRid ? { reason: 'review_pending', requestId: this.interactiveRid } : undefined
      );
    }
    if (ownsLock) {
      this.interactiveInFlight = true;
      this.interactiveRid = rid ?? null;
    }
    try {
      if (!(await this.ensureOpen(false)) || !this.ws) {
        throw new ZeroXIOWalletError(ErrorCode.NETWORK_ERROR, '0xio Desktop is not reachable.');
      }
      const network = method === 'connect' && validNetworkId(params?.networkId) ? params.networkId : this.network;
      const wait = meta?.timeoutMs ?? (LONG_METHODS.has(method)
        ? DESKTOP_REVIEW_TIMEOUT_MS
        : Math.max(timeout, DESKTOP_READ_TIMEOUT_MS));
      const id = wireId();
      const reply = await this.call(
        'site_request',
        { id, network, ...(rid ? { rid } : {}), request: { method, params: params ?? {} } },
        wait,
        { id, method, rid }
      );
      if (reply && typeof reply === 'object' && 'result' in reply) {
        const result = method === 'connect' ? this.takeSiteToken(reply.result) : reply.result;
        this.learnNetwork(method, params, result);
        return result as T;
      }
      throw desktopError(reply);
    } finally {
      if (ownsLock) {
        this.interactiveInFlight = false;
        this.interactiveRid = null;
      }
      if (method === 'disconnect') clearSiteToken();
    }
  }

  /** The token never reaches the dapp. */
  private takeSiteToken(result: any): any {
    if (!result || typeof result !== 'object' || !('siteToken' in result)) return result;
    const { siteToken, ...rest } = result;
    if (typeof siteToken === 'string' && SITE_TOKEN_RE.test(siteToken)) writeSiteToken(siteToken);
    return rest;
  }

  private call(
    method: string,
    args: Record<string, unknown>,
    timeoutMs: number,
    site?: { id: string; method: string; rid?: string }
  ): Promise<any> {
    const ws = this.ws;
    if (!ws) return Promise.reject(new ZeroXIOWalletError(ErrorCode.NETWORK_ERROR, '0xio Desktop is not reachable.'));
    const _id = ++this.seq;
    return new Promise((resolve, reject) => {
      // A protocol 1 desktop would hold the slot, so only it still gets site_cancel.
      const onTimeout = () => {
        const p = this.replies.get(_id);
        if (!p) return;
        this.replies.delete(_id);
        if (site && !(site.rid && this.protocol === 2)) this.cancel(site.id);
        reject(site?.rid
          ? new ZeroXIOWalletError(
            ErrorCode.STATUS_UNKNOWN,
            `No answer from 0xio Desktop after ${timeoutMs}ms; the request may still finish`,
            { method: site.method, requestId: site.rid }
          )
          : new ZeroXIOWalletError(
            ErrorCode.NETWORK_ERROR,
            `0xio Desktop did not answer in time (${timeoutMs}ms)`,
            { method: site?.method ?? method }
          ));
      };
      const entry: Pending = {
        id: site?.id ?? '',
        method: site?.method ?? method,
        ...(site?.rid ? { rid: site.rid } : {}),
        resolve,
        reject,
        timer: setTimeout(onTimeout, timeoutMs),
      };
      entry.restart = () => {
        clearTimeout(entry.timer);
        entry.timer = setTimeout(onTimeout, timeoutMs);
      };
      this.replies.set(_id, entry);
      let frame: string;
      try {
        frame = JSON.stringify({ v: 1, _id, method, ...args });
      } catch {
        clearTimeout(entry.timer);
        this.replies.delete(_id);
        reject(new ZeroXIOWalletError(ErrorCode.UNKNOWN_ERROR, 'Request params are not serializable', { method }));
        return;
      }
      try {
        ws.send(frame);
      } catch {
        clearTimeout(entry.timer);
        this.replies.delete(_id);
        reject(new ZeroXIOWalletError(ErrorCode.NETWORK_ERROR, '0xio Desktop is not reachable.'));
      }
    });
  }

  private cancel(id: string): void {
    if (!id || !this.ws) return;
    try {
      this.ws.send(JSON.stringify({ v: 1, _id: ++this.seq, method: 'site_cancel', id }));
    } catch {
      // socket already gone: the desktop drops the request with the connection
    }
  }

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
    this.failure = null;
    const { state: permission, status: permissionStatus } = await localNetworkPermissionStatus();
    if (permission === 'denied') {
      this.failure = 'blocked';
      this.logger.log('Local network access is denied for this page; not trying 0xio Desktop');
      return false;
    }
    const connectMs = this.connectTimeoutMs
      ?? (permission === 'prompt' ? DESKTOP_PROMPT_CONNECT_TIMEOUT_MS : DESKTOP_CONNECT_TIMEOUT_MS);
    if (permission === 'prompt') this.emit('connectProgress', { phase: 'local-network-prompt' });

    const ws: WebSocket | null = await new Promise((resolve) => {
      let sock: WebSocket;
      try {
        sock = new Ctor(this.url);
      } catch {
        this.failure = 'not-running';
        resolve(null);
        return;
      }
      let stopWatch: () => void = () => {};
      const fail = (why: DesktopFailure) => {
        clearTimeout(timer);
        stopWatch();
        sock.onopen = sock.onerror = sock.onclose = null;
        try { sock.close(); } catch { /* not open */ }
        this.failure = why;
        resolve(null);
      };
      const timer = setTimeout(
        () => fail(permission === 'prompt' ? 'unknown-until-connect' : 'not-running'),
        connectMs
      );
      if (permission === 'prompt') {
        stopWatch = watchPermission(permissionStatus, (state) => {
          if (state === 'denied') fail('blocked');
        });
      }
      sock.onopen = () => {
        clearTimeout(timer);
        stopWatch();
        resolve(sock);
      };
      sock.onerror = sock.onclose = () => fail('not-running');
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
      const token = readSiteToken();
      const hello = await this.call('site_hello', token ? { site_token: token } : {}, DESKTOP_HELLO_TIMEOUT_MS);
      if (hello?.v !== 1 || hello?.wallet !== '0xio-desktop') {
        throw new Error('not 0xio Desktop');
      }
      if (hello.token_status === 'invalid') clearSiteToken();
      if (typeof hello.version === 'string') this.version = hello.version.slice(0, 32);
      const info = parseWalletHello({ ...hello, kind: 'desktop' }, 'desktop');
      this.protocol = info.protocol;
      this.capabilities = info.capabilities;
      if (validNetworkId(hello.network)) this.network = hello.network;
      const sub = await this.call('sites_subscribe', {}, DESKTOP_HELLO_TIMEOUT_MS);
      if (sub?.error) this.logger.warn('0xio Desktop refused the event subscription:', sub.error);
      this.logger.log('Connected to 0xio Desktop', { version: this.version, network: this.network });
      return true;
    } catch (e) {
      this.logger.log('0xio Desktop hello failed:', e);
      this.failure = 'not-running';
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
    if (ev.type === 'requestUpdate') {
      for (const p of this.replies.values()) {
        if (p.rid && p.rid === ev.data.requestId) p.status = ev.data.status;
      }
    }
    if (ev.type === 'disconnect') clearSiteToken();
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
      const details = p.rid ? { method: p.method, requestId: p.rid, status: 'unknown' } : { method: p.method };
      p.reject(new ZeroXIOWalletError(ErrorCode.NETWORK_ERROR, message, details));
    }
  }

  /** Cancels waiting requests and closes the socket; a protocol 2 desktop finishes approved ones. */
  private drop(message: string, cancelPending: boolean): void {
    const ws = this.ws;
    if (!ws) return;
    if (cancelPending) {
      for (const p of this.replies.values()) {
        const approved = this.protocol === 2 && p.status !== undefined && statusRank(p.status) >= statusRank('signing');
        if (!approved) this.cancel(p.id);
      }
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

  /** Terminal. */
  cleanup(): void {
    this.drop('SDK cleanup called', true);
    this.closed = true;
    this.ready = false;
    this.interactiveInFlight = false;
    this.interactiveRid = null;
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
