import {
  ContractReceipt,
  ErrorCode,
  RequestStatus,
  RequestStatusValue,
  WalletInfo,
  WalletKind,
  WalletProtocolVersion,
  ZeroXIOWalletError,
} from './types';

export const WALLET_PROTOCOL = 2 as const;
export const SUPPORTED_PROTOCOLS: readonly WalletProtocolVersion[] = [1, 2];

export const WALLET_CAPABILITIES = [
  'announce',
  'request_id',
  'request_status',
  'request_events',
  'idempotent',
  'wait_confirmed',
  'receipt',
  'can_sign',
  'kind',
] as const;
export type WalletCapability = (typeof WALLET_CAPABILITIES)[number];

export const WALLET_KINDS: readonly WalletKind[] = ['extension', 'desktop', 'app-ios', 'app-android', 'app-expo'];

export const ANNOUNCE_REQUEST_EVENT = '0xio:requestWallet';
/** Detail is `{ protocol, kind, version, name }`, never user state. */
export const ANNOUNCE_EVENT = '0xio:announceWallet';

export const LIFECYCLE_METHODS: readonly string[] = [
  'connect',
  'switch_network',
  'send_transaction',
  'call_contract',
  'deploy_contract',
  'signMessage',
  'sign_transaction',
  'broadcast_only',
  'send_contract_transaction_sequence',
  'register_private_view_key',
  'send_private_transfer',
  'claim_private_transfer',
  'encrypt_balance',
  'decrypt_balance',
];
const LIFECYCLE_SET = new Set(LIFECYCLE_METHODS);

export const TRANSACTION_METHODS: readonly string[] = [
  'send_transaction',
  'call_contract',
  'deploy_contract',
  'broadcast_only',
  'send_contract_transaction_sequence',
  'register_private_view_key',
  'send_private_transfer',
  'claim_private_transfer',
  'encrypt_balance',
  'decrypt_balance',
];

export const REQUEST_STATUSES: readonly RequestStatusValue[] = [
  'pending',
  'review_open',
  'locked',
  'signing',
  'submitted',
  'confirmed',
  'completed',
  'failed',
  'rejected',
  'expired',
  'unknown',
];
const STATUS_SET = new Set<string>(REQUEST_STATUSES);

export const FINAL_REQUEST_STATUSES: readonly RequestStatusValue[] = ['confirmed', 'completed', 'failed', 'rejected', 'expired'];
const FINAL_SET = new Set<string>(FINAL_REQUEST_STATUSES);

/**
 * `pending -> submitted` is `broadcast_only`, reviewed when it was signed; `pending -> completed`
 * is a request with nothing to review. `unknown` is an answer, never a stored state.
 */
export const REQUEST_STATUS_TRANSITIONS: Readonly<Record<RequestStatusValue, readonly RequestStatusValue[]>> = {
  pending: ['locked', 'review_open', 'submitted', 'completed', 'failed', 'rejected'],
  locked: ['review_open', 'rejected', 'expired', 'failed'],
  review_open: ['signing', 'completed', 'rejected', 'expired', 'failed'],
  signing: ['submitted', 'failed'],
  submitted: ['confirmed', 'failed'],
  confirmed: [],
  completed: [],
  failed: [],
  rejected: [],
  expired: [],
  unknown: [],
};

/** `RATE_LIMITED` reaches sites as `RATE_LIMIT_EXCEEDED`. */
export const WIRE_ERROR_CODES = {
  RATE_LIMITED: 'RATE_LIMITED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  REQUEST_ID_REUSED: 'REQUEST_ID_REUSED',
  STATUS_UNKNOWN: 'STATUS_UNKNOWN',
  EXECUTION_FAILED: 'EXECUTION_FAILED',
  INVALID_PARAMS: 'INVALID_PARAMS',
  USER_REJECTED: 'USER_REJECTED',
  NOT_CONNECTED: 'NOT_CONNECTED',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  PVAC_KEY_MISMATCH: 'PVAC_KEY_MISMATCH',
  REGISTRATION_PENDING: 'REGISTRATION_PENDING',
} as const;

export const LIFECYCLE_LIMITS = {
  recordsPerOrigin: 64,
  openPerOrigin: 8,
  recordsGlobal: 1024,
  recordTtlMs: 24 * 60 * 60 * 1000,
  resultMaxBytes: 4096,
  reviewWindowMs: 5 * 60 * 1000,
  watchFastEveryMs: 2_500,
  watchFastForMs: 60_000,
  watchSlowEveryMs: 10_000,
  watchForMs: 10 * 60 * 1000,
  watchedPerWallet: 32,
  watchedPerOrigin: 8,
  chainCheckCacheMs: 5_000,
  requestsPerSecond: 20,
  statusQueriesPerSecond: 2,
} as const;

export const STATUS_POLL_MS = 5_000;
export const CONFIRM_WAIT_MS = 10 * 60 * 1000;
export const FALLBACK_POLL = { fastEveryMs: 4_000, fastForMs: 60_000, slowEveryMs: 10_000 } as const;
export const DEFAULT_DETECT_TIMEOUT_MS = 300;
export const HELLO_TIMEOUT_MS = 3_000;

export const OPEN_IN_APP_URL = 'https://0xio.xyz/open';
export const OPEN_IN_APP_SCHEME_URL = 'oxio://open';
const OPEN_IN_APP_MAX_URL = 2048;

const REQUEST_ID_RE = /^[0-9a-f]{32}$/;

export function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_RE.test(value);
}

/** 128 random bits as 32 lowercase hex characters. */
export function newRequestId(): string {
  const c = (globalThis as any).crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new ZeroXIOWalletError(
      ErrorCode.UNKNOWN_ERROR,
      'Cryptographic random number generation is not available in this environment'
    );
  }
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function isLifecycleMethod(method: string): boolean {
  return LIFECYCLE_SET.has(method);
}

export function isRequestStatusValue(value: unknown): value is RequestStatusValue {
  return typeof value === 'string' && STATUS_SET.has(value);
}

export function isFinalStatus(status: RequestStatusValue): boolean {
  return FINAL_SET.has(status);
}

export function canTransition(from: RequestStatusValue, to: RequestStatusValue): boolean {
  return REQUEST_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export function statusRank(status: RequestStatusValue): number {
  switch (status) {
    case 'pending':
      return 0;
    case 'locked':
    case 'review_open':
      return 1;
    case 'signing':
      return 2;
    case 'submitted':
      return 3;
    case 'unknown':
      return -1;
    default:
      return 4;
  }
}

function compareCodePoints(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const d = x[i].codePointAt(0)! - y[i].codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

function encodeCanonical(value: unknown, depth: number): string {
  if (depth > 64) throw new ZeroXIOWalletError(ErrorCode.INVALID_PARAMS, 'Request params are nested too deep');
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new ZeroXIOWalletError(ErrorCode.INVALID_PARAMS, 'Request params hold a number that is not finite');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value
          .map((v) => (v === undefined || typeof v === 'function' ? 'null' : encodeCanonical(v, depth + 1)))
          .join(',')}]`;
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined && typeof obj[k] !== 'function')
        .sort(compareCodePoints);
      return `{${keys.map((k) => `${JSON.stringify(k)}:${encodeCanonical(obj[k], depth + 1)}`).join(',')}}`;
    }
    default:
      throw new ZeroXIOWalletError(ErrorCode.INVALID_PARAMS, 'Request params are not JSON');
  }
}

/** Keys sorted by code point, no whitespace, `undefined` dropped (null inside arrays). */
export function canonicalJson(value: unknown): string {
  return encodeCanonical(value, 0);
}

/** The bytes a wallet hashes to decide that two requests are the same. */
export function requestDigestInput(method: string, params: unknown, network?: string | null): string {
  return canonicalJson({ method, network: network ?? null, params: params === undefined ? {} : params });
}

export async function requestDigest(method: string, params: unknown, network?: string | null): Promise<string> {
  const subtle = (globalThis as any).crypto?.subtle;
  if (!subtle) {
    throw new ZeroXIOWalletError(ErrorCode.UNKNOWN_ERROR, 'SHA-256 is not available in this environment');
  }
  const bytes = new TextEncoder().encode(requestDigestInput(method, params, network));
  const hash = new Uint8Array(await subtle.digest('SHA-256', bytes));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function boundedResult(value: unknown, maxBytes: number = LIFECYCLE_LIMITS.resultMaxBytes): unknown {
  if (value === undefined) return undefined;
  try {
    const json = JSON.stringify(value);
    if (json === undefined || new TextEncoder().encode(json).length > maxBytes) return undefined;
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

const shortString = (v: unknown, max: number, re?: RegExp): string | undefined =>
  typeof v === 'string' && v.length > 0 && v.length <= max && (!re || re.test(v)) ? v : undefined;
const finiteInt = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined;

export function parseContractReceipt(raw: unknown): ContractReceipt | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.success !== 'boolean') return null;
  const events = Array.isArray(r.events)
    ? r.events
        .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && typeof (e as any).event === 'string')
        .slice(0, 256)
        .map((e) => ({ event: String(e.event).slice(0, 200), values: boundedResult(e.values, 16384) ?? null }))
    : [];
  return {
    contract: shortString(r.contract, 128) ?? '',
    method: shortString(r.method, 200) ?? '',
    success: r.success,
    ...(typeof r.effort === 'number' && Number.isFinite(r.effort) ? { effort: r.effort } : {}),
    events,
    ...(r.error != null ? { error: boundedResult(r.error, 4096) ?? String(r.error).slice(0, 500) } : {}),
  };
}

const RECEIPT_UNAVAILABLE = new Set(['not_contract', 'refused', 'error']);
const STAGES = new Set(['review', 'submit', 'execution']);
const NETWORK_RE = /^[a-z0-9_-]{1,32}$/;
const HASH_RE = /^[0-9A-Za-z]{8,128}$/;
const CODE_RE = /^[A-Z_]{1,64}$/;

/** Wallet data is untrusted: every field is checked and bounded, unknown fields dropped. */
export function parseRequestStatus(raw: unknown): RequestStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const requestId = r.requestId ?? r.rid;
  if (!isRequestId(requestId) || !isRequestStatusValue(r.status)) return null;
  const now = Date.now();
  const out: Record<string, unknown> = {
    requestId,
    status: r.status,
    seq: finiteInt(r.seq) ?? 0,
    createdAt: finiteInt(r.createdAt) ?? now,
    updatedAt: finiteInt(r.updatedAt) ?? now,
  };
  const method = shortString(r.method, 64, /^[A-Za-z_]+$/);
  if (method) out.method = method;
  const network = shortString(r.network, 32, NETWORK_RE);
  if (network) out.network = network;
  const address = shortString(r.address, 64, /^[0-9A-Za-z]+$/);
  if (address) out.address = address;
  const hash = shortString(r.hash, 128, HASH_RE);
  if (hash) out.hash = hash;
  const epoch = finiteInt(r.epoch);
  if (epoch !== undefined) out.epoch = epoch;
  if (r.receipt === null) out.receipt = null;
  else if (r.receipt !== undefined) {
    const receipt = parseContractReceipt(r.receipt);
    if (receipt) out.receipt = receipt;
  }
  if (typeof r.receiptUnavailable === 'string' && RECEIPT_UNAVAILABLE.has(r.receiptUnavailable)) {
    out.receiptUnavailable = r.receiptUnavailable;
  }
  const result = boundedResult(r.result);
  if (result !== undefined) out.result = result;
  if (r.error && typeof r.error === 'object') {
    const e = r.error as Record<string, unknown>;
    const code = shortString(e.code, 64, CODE_RE);
    const stage = typeof e.stage === 'string' && STAGES.has(e.stage) ? e.stage : 'review';
    if (code) {
      out.error = {
        code,
        message: typeof e.message === 'string' ? e.message.slice(0, 500) : code,
        stage,
      };
    }
  }
  if (typeof r.watching === 'boolean') out.watching = r.watching;
  return Object.freeze(out) as unknown as RequestStatus;
}

export function unknownRequestStatus(requestId: string): RequestStatus {
  const now = Date.now();
  return Object.freeze({ requestId, status: 'unknown' as const, seq: 0, createdAt: now, updatedAt: now });
}

const VERSION_RE = /^[0-9A-Za-z.+_-]{1,32}$/;
const CAPABILITY_RE = /^[a-z0-9_]{1,32}$/;

export function guessWalletKind(transport: 'extension' | 'desktop'): WalletKind {
  if (transport === 'desktop') return 'desktop';
  const win = typeof window !== 'undefined' ? (window as any) : undefined;
  return win?.ReactNativeWebView ? 'app-expo' : 'extension';
}

/** Anything but a protocol 2 answer reads as protocol 1 with no capabilities. */
export function parseWalletHello(raw: unknown, fallbackKind: WalletKind): WalletInfo {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const protocol: WalletProtocolVersion = typeof r.protocol === 'number' && r.protocol >= 2 ? 2 : 1;
  const kind = WALLET_KINDS.includes(r.kind as WalletKind) ? (r.kind as WalletKind) : fallbackKind;
  const version = shortString(r.version, 32, VERSION_RE);
  const capabilities =
    protocol === 2 && Array.isArray(r.capabilities)
      ? Array.from(new Set(r.capabilities.filter((c): c is string => typeof c === 'string' && CAPABILITY_RE.test(c)))).slice(0, 64)
      : [];
  return Object.freeze({
    kind,
    ...(version ? { version } : {}),
    protocol,
    capabilities: Object.freeze(capabilities),
  });
}

export interface AnnounceDetail {
  readonly kind: WalletKind;
  readonly version?: string;
  readonly protocol: WalletProtocolVersion;
  readonly name?: string;
}

export function parseAnnounce(detail: unknown): AnnounceDetail | null {
  if (!detail || typeof detail !== 'object') return null;
  const d = detail as Record<string, unknown>;
  if (!WALLET_KINDS.includes(d.kind as WalletKind)) return null;
  if (typeof d.protocol !== 'number' || d.protocol < 1) return null;
  const version = shortString(d.version, 32, VERSION_RE);
  const name = shortString(d.name, 64);
  return Object.freeze({
    kind: d.kind as WalletKind,
    ...(version ? { version } : {}),
    protocol: d.protocol >= 2 ? 2 : 1,
    ...(name ? { name } : {}),
  });
}

interface PageSignals {
  announce: AnnounceDetail | null;
  readyVersion?: string;
  listeners: Set<() => void>;
}
const pageSignals = new WeakMap<object, PageSignals>();

export function watchWalletSignals(): PageSignals | null {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return null;
  const win = window as unknown as object;
  const known = pageSignals.get(win);
  if (known) return known;
  const state: PageSignals = { announce: null, listeners: new Set() };
  pageSignals.set(win, state);
  const notify = () => state.listeners.forEach((fn) => fn());
  window.addEventListener(ANNOUNCE_EVENT, (e: Event) => {
    const a = parseAnnounce((e as CustomEvent).detail);
    if (!a) return;
    state.announce = a;
    notify();
  });
  const onReady = (e: Event) => {
    const version = shortString((e as CustomEvent).detail?.version, 32, VERSION_RE);
    if (version) state.readyVersion = version;
    notify();
  };
  window.addEventListener('0xioWalletReady', onReady);
  window.addEventListener('wallet0xioReady', onReady);
  return state;
}

export function requestWalletAnnounce(): void {
  if (typeof window === 'undefined' || typeof (window as any).dispatchEvent !== 'function') return;
  if (typeof Event !== 'function') return;
  try {
    window.dispatchEvent(new Event(ANNOUNCE_REQUEST_EVENT));
  } catch {
    // a page that cannot dispatch events has no wallet to answer
  }
}

export function walletSignals(): { announce: AnnounceDetail | null; readyVersion?: string } {
  const s = watchWalletSignals();
  return { announce: s?.announce ?? null, readyVersion: s?.readyVersion };
}

export function onWalletSignal(fn: () => void): () => void {
  const s = watchWalletSignals();
  if (!s) return () => {};
  s.listeners.add(fn);
  return () => s.listeners.delete(fn);
}

/** Null for anything but an https URL without credentials of at most 2048 characters. */
export function openInAppUrl(url?: string, options: { scheme?: boolean } = {}): string | null {
  const target =
    url ?? (typeof window !== 'undefined' && typeof window.location?.href === 'string' ? window.location.href : undefined);
  if (typeof target !== 'string' || target.length > OPEN_IN_APP_MAX_URL) return null;
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
  if (parsed.href.length > OPEN_IN_APP_MAX_URL) return null;
  return `${options.scheme ? OPEN_IN_APP_SCHEME_URL : OPEN_IN_APP_URL}?url=${encodeURIComponent(parsed.href)}`;
}

export interface RequestMeta {
  readonly rid: string;
  readonly timeoutMs?: number;
}

export function resultHash(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const d = data as Record<string, unknown>;
  const h = d.hash ?? d.txHash ?? d.tx_hash;
  return typeof h === 'string' && HASH_RE.test(h) ? h : undefined;
}

export function resultHashes(data: unknown): string[] {
  const one = resultHash(data);
  const out = one ? [one] : [];
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    const lists = [d.hashes, d.txHashes, d.transactions, d.results];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const item of list.slice(0, 64)) {
        const h = typeof item === 'string' ? (HASH_RE.test(item) ? item : undefined) : resultHash(item);
        if (h && !out.includes(h)) out.push(h);
      }
    }
  }
  return out;
}

export interface TrackedRequest {
  status: RequestStatus;
  key: string | null;
  walletSeq: number;
  promise?: Promise<{ data: any; requestId: string }>;
  outcome?: { ok: true; value: any } | { ok: false; error: ZeroXIOWalletError };
  listeners: Set<(s: RequestStatus) => void>;
}

function sameState(a: RequestStatus, b: RequestStatus): boolean {
  return (
    a.status === b.status &&
    a.hash === b.hash &&
    a.epoch === b.epoch &&
    a.watching === b.watching &&
    a.address === b.address &&
    a.error?.code === b.error?.code &&
    (a.receipt === undefined) === (b.receipt === undefined) &&
    a.receiptUnavailable === b.receiptUnavailable
  );
}

/** `seq` is the SDK's change counter; stale wallet events are dropped by the wallet's own seq. */
export class RequestTracker {
  private records = new Map<string, TrackedRequest>();

  constructor(
    private readonly onChange: (status: RequestStatus) => void = () => {},
    private readonly limit = LIFECYCLE_LIMITS.recordsPerOrigin
  ) {}

  get(rid: string): TrackedRequest | undefined {
    return this.records.get(rid);
  }

  snapshot(rid: string): RequestStatus | null {
    return this.records.get(rid)?.status ?? null;
  }

  begin(rid: string, method: string, key: string | null, network?: string): TrackedRequest {
    const known = this.records.get(rid);
    if (known) {
      if (known.key === null) known.key = key;
      return known;
    }
    const now = Date.now();
    const rec: TrackedRequest = {
      status: Object.freeze({
        requestId: rid,
        status: 'pending' as const,
        method,
        ...(network ? { network } : {}),
        seq: 1,
        createdAt: now,
        updatedAt: now,
      }),
      key,
      walletSeq: 0,
      listeners: new Set(),
    };
    this.records.set(rid, rec);
    this.evict();
    this.notify(rec);
    return rec;
  }

  local(rid: string, patch: Partial<RequestStatus> & { status: RequestStatusValue }): boolean {
    const rec = this.records.get(rid);
    if (!rec || isFinalStatus(rec.status.status)) return false;
    if (statusRank(patch.status) < statusRank(rec.status.status)) return false;
    const next = { ...rec.status, ...patch, requestId: rid } as RequestStatus;
    if (sameState(rec.status, next) && patch.result === undefined) return false;
    rec.status = Object.freeze({ ...next, seq: rec.status.seq + 1, updatedAt: Date.now() });
    this.notify(rec);
    return true;
  }

  wallet(update: RequestStatus, create = false): boolean {
    if (update.status === 'unknown') return false;
    let rec = this.records.get(update.requestId);
    if (!rec) {
      if (!create) return false;
      rec = { status: Object.freeze({ ...update, seq: 1 }), key: null, walletSeq: update.seq, listeners: new Set() };
      this.records.set(update.requestId, rec);
      this.evict();
      this.notify(rec);
      return true;
    }
    if (isFinalStatus(rec.status.status)) return false;
    if (update.seq <= rec.walletSeq) return false;
    if (statusRank(update.status) < statusRank(rec.status.status)) return false;
    rec.walletSeq = update.seq;
    const merged = { ...rec.status, ...update } as RequestStatus;
    if (sameState(rec.status, merged)) return false;
    rec.status = Object.freeze({ ...merged, seq: rec.status.seq + 1, createdAt: rec.status.createdAt });
    this.notify(rec);
    return true;
  }

  subscribe(rid: string, fn: (s: RequestStatus) => void): () => void {
    const rec = this.records.get(rid);
    if (!rec) return () => {};
    rec.listeners.add(fn);
    return () => rec.listeners.delete(fn);
  }

  inReview(except?: string): TrackedRequest | undefined {
    for (const [rid, rec] of this.records) {
      if (rid === except || !rec.promise) continue;
      if (statusRank(rec.status.status) < statusRank('submitted') && rec.status.status !== 'unknown') return rec;
    }
    return undefined;
  }

  clear(): void {
    this.records.clear();
  }

  private notify(rec: TrackedRequest): void {
    const s = rec.status;
    for (const fn of Array.from(rec.listeners)) {
      try {
        fn(s);
      } catch {
        // a site callback must not break the lifecycle
      }
    }
    this.onChange(s);
  }

  private evict(): void {
    if (this.records.size <= this.limit) return;
    for (const [rid, rec] of this.records) {
      if (this.records.size <= this.limit) return;
      if (isFinalStatus(rec.status.status) && !rec.promise) this.records.delete(rid);
    }
  }
}
