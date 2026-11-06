import type { RequestStatusValue, WalletKind } from '../../src/types';
import {
  LIFECYCLE_LIMITS,
  REQUEST_STATUS_TRANSITIONS,
  TRANSACTION_METHODS,
  WALLET_CAPABILITIES,
  boundedResult,
  isFinalStatus,
  isLifecycleMethod,
  isRequestId,
  requestDigest,
} from '../../src/lifecycle';
import type { WireEvent, WireReply, WireRequest } from '../harness';
import { Clock, realClock } from './clock';

export interface ReferenceWalletOptions {
  protocol?: 1 | 2;
  kind?: WalletKind;
  version?: string;
  clock?: Clock;
  network?: string;
  address?: string;
  /** The public scanner refuses `contract_receipt`. */
  refuseReceipts?: boolean;
  openRequestCap?: number;
  refuseRpc?: boolean;
  registered?: boolean;
  balanceRaw?: string;
  foreignKey?: boolean;
  pendingRegistration?: boolean;
}

const SIGNING_METHODS = new Set([...TRANSACTION_METHODS, 'signMessage', 'sign_transaction']);
const TX_METHODS = new Set(TRANSACTION_METHODS);

type Outcome = { ok: true; data: unknown } | { ok: false; code: string; message: string; status: RequestStatusValue };

interface Waiter {
  page: ReferencePage;
  id: string;
  resolve: (reply: WireReply) => void;
}

interface RequestRecord {
  origin: string;
  rid: string;
  anonymous: boolean;
  digest: string;
  method: string;
  params: any;
  network: string;
  address: string;
  status: RequestStatusValue;
  seq: number;
  createdAt: number;
  updatedAt: number;
  hash?: string;
  epoch?: number;
  receipt?: unknown;
  receiptUnavailable?: 'not_contract' | 'refused' | 'error';
  result?: unknown;
  error?: { code: string; message: string; stage: 'review' | 'submit' | 'execution' };
  watching?: boolean;
  senders: Set<ReferencePage>;
  waiters: Waiter[];
  outcome?: Outcome;
  reviewTimer?: unknown;
  watchTimer?: unknown;
}

interface ChainTx {
  status: 'pending' | 'confirmed' | 'rejected' | 'dropped';
  epoch?: number;
  reason?: string;
  method: string;
  params: any;
}

export class ReferencePage {
  closed = false;
  private listeners = new Set<(e: WireEvent) => void>();
  private hits: number[] = [];

  constructor(
    private readonly wallet: ReferenceWallet,
    readonly origin: string,
    readonly tab: string,
    readonly frame: string
  ) {}

  send(request: WireRequest): Promise<WireReply> {
    if (this.closed) return Promise.reject(new Error('page closed'));
    return this.wallet.handle(this, request);
  }

  onEvent(listener: (e: WireEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.wallet.pageClosed(this);
  }

  deliver(event: WireEvent): void {
    if (this.closed) return;
    for (const fn of Array.from(this.listeners)) fn(event);
  }

  overBudget(now: number): boolean {
    this.hits = this.hits.filter((t) => now - t < 1000);
    if (this.hits.length >= LIFECYCLE_LIMITS.requestsPerSecond) return true;
    this.hits.push(now);
    return false;
  }
}

function errorReply(id: string, code: string, message: string, rid?: string, status?: RequestStatusValue): WireReply {
  const details = { ...(rid ? { requestId: rid } : {}), ...(status ? { status } : {}) };
  return {
    id,
    success: false,
    error: { code, message, ...(Object.keys(details).length ? { details } : {}) },
    ...(rid ? { rid } : {}),
    ...(status ? { status } : {}),
  };
}

const PUBLIC_METHODS = new Set([
  'connect',
  'ping',
  'register_dapp',
  'disconnect',
  'getConnectionStatus',
  'get_network_info',
  'getNetworkInfo',
  'contract_call_view',
  'get_contract_storage',
  'rpc_call',
  'wallet_hello',
  'request_status',
  'cancel_request',
]);

const NETWORKS: Record<string, unknown> = {
  mainnet: { id: 'mainnet', name: 'Octra Mainnet', rpcUrl: 'https://octra.network', supportsPrivacy: true, color: '#000000', isTestnet: false },
  devnet: { id: 'devnet', name: 'Octra Devnet', rpcUrl: 'https://devnet.octrascan.io/rpc', supportsPrivacy: true, color: '#000000', isTestnet: true },
};

export class ReferenceWallet {
  readonly protocol: 1 | 2;
  readonly kind: WalletKind;
  readonly version: string;
  readonly clock: Clock;
  network: string;
  readonly address: string;
  locked = false;
  registered: boolean;
  balanceRaw: bigint;
  foreignKey: boolean;
  pendingRegistration: boolean;
  readonly keySwitchFeeRaw = 1_000_000n;
  readonly viewPubkey = 'dmlldy1wdWJrZXktb2YtdGhlLXJlZmVyZW5jZS13YWxsZXQ=';
  signatures = 0;
  reviewsOpened = 0;
  readonly received: Array<{ origin: string; request: WireRequest }> = [];

  private readonly options: ReferenceWalletOptions;
  private records = new Map<string, RequestRecord>();
  private connected = new Set<string>();
  private queue: RequestRecord[] = [];
  private current: RequestRecord | null = null;
  private chain = new Map<string, ChainTx>();
  private epoch = 1000;
  private hashSeq = 0;
  private tabSeq = 0;

  constructor(options: ReferenceWalletOptions = {}) {
    this.options = options;
    this.protocol = options.protocol ?? 2;
    this.kind = options.kind ?? 'extension';
    this.version = options.version ?? (this.protocol === 2 ? '3.0.6' : '3.0.5');
    this.clock = options.clock ?? realClock;
    this.network = options.network ?? 'mainnet';
    this.address = options.address ?? 'oct' + 'R'.repeat(44);
    this.registered = options.registered ?? false;
    this.balanceRaw = BigInt(options.balanceRaw ?? '1000000000');
    this.foreignKey = options.foreignKey ?? false;
    this.pendingRegistration = options.pendingRegistration ?? false;
  }

  openPage(origin: string, options: { tab?: ReferencePage; frame?: string } = {}): ReferencePage {
    const tab = options.tab?.tab ?? `tab-${++this.tabSeq}`;
    return new ReferencePage(this, origin, tab, options.frame ?? 'main');
  }

  announceDetail(): { protocol: 2; kind: WalletKind; version: string; name: string } | null {
    return this.protocol === 2 ? { protocol: 2, kind: this.kind, version: this.version, name: '0xio Wallet' } : null;
  }

  reviewOnScreen(): string | null {
    return this.current ? this.current.rid : null;
  }

  isConnected(origin: string): boolean {
    return this.connected.has(origin);
  }

  async handle(page: ReferencePage, req: WireRequest): Promise<WireReply> {
    this.received.push({ origin: page.origin, request: req });
    const rid = this.protocol === 2 && req.v === 2 && req.rid !== undefined ? req.rid : undefined;
    if (page.overBudget(this.clock.now())) {
      return this.fail(req, 'RATE_LIMITED', 'Too many requests from this page', rid);
    }
    if (!PUBLIC_METHODS.has(req.method) && !this.connected.has(page.origin)) {
      return this.fail(req, 'NOT_CONNECTED', 'Connect the wallet first', rid);
    }
    switch (req.method) {
      case 'wallet_hello':
        if (this.protocol !== 2) return this.fail(req, 'METHOD_NOT_ALLOWED', 'Unknown method: wallet_hello');
        return this.ok(req, {
          protocol: 2,
          kind: this.kind,
          version: this.version,
          capabilities: [...WALLET_CAPABILITIES],
        });
      case 'ping':
        return this.ok(req, { pong: true });
      case 'register_dapp':
        return this.ok(req, { registered: true });
      case 'getConnectionStatus':
        return this.ok(req, this.connected.has(page.origin)
          ? { isConnected: true, address: this.address, networkInfo: NETWORKS[this.network], permissions: ['accounts'], canSign: true }
          : { isConnected: false });
      case 'get_network_info':
      case 'getNetworkInfo':
        return this.ok(req, NETWORKS[this.network]);
      case 'disconnect':
        this.connected.delete(page.origin);
        return this.ok(req, { disconnected: true });
      case 'contract_call_view':
      case 'get_contract_storage':
        return this.ok(req, { result: null });
      case 'getBalance':
      case 'get_balance':
        return this.ok(req, { balance: '10', privateBalance: '0' });
      case 'getAddress':
      case 'getWalletInfo':
        return this.ok(req, { address: this.address });
      case 'rpc_call':
        return this.rpc(req);
      case 'request_status':
        return this.requestStatus(page, req);
      case 'cancel_request':
        return this.cancelRequest(page, req);
      default:
        if (isLifecycleMethod(req.method)) return this.lifecycle(page, req, rid);
        return this.fail(req, 'METHOD_NOT_ALLOWED', `Unknown method: ${req.method}`);
    }
  }

  private ok(req: WireRequest, data: unknown, rid?: string): WireReply {
    return { id: req.id, success: true, data, ...(rid ? { rid } : {}) };
  }

  private fail(req: WireRequest, code: string, message: string, rid?: string, status?: RequestStatusValue): WireReply {
    return errorReply(req.id, code, message, rid, status);
  }

  private rpc(req: WireRequest): WireReply {
    if (this.options.refuseRpc) return this.fail(req, 'METHOD_NOT_ALLOWED', 'rpc_call is not available');
    const { method, params } = (req.params ?? {}) as { method?: string; params?: unknown[] };
    const hash = Array.isArray(params) ? String(params[0]) : '';
    const tx = this.chain.get(hash);
    if (method === 'octra_transaction') {
      if (!tx) return this.fail(req, 'NOT_FOUND', 'Transaction not found');
      return this.ok(req, {
        status: tx.status,
        tx_hash: hash,
        ...(tx.epoch !== undefined ? { epoch: tx.epoch } : {}),
        op_type: tx.method === 'call_contract' ? 'call' : tx.method === 'deploy_contract' ? 'deploy' : 'standard',
        ...(tx.reason ? { error: { type: tx.status, reason: tx.reason } } : {}),
      });
    }
    if (method === 'contract_receipt') {
      if (this.options.refuseReceipts) return this.fail(req, 'UNKNOWN_ERROR', 'single scanner read required');
      if (!tx || tx.status !== 'confirmed') return this.fail(req, 'NOT_FOUND', 'No receipt');
      return this.ok(req, this.receiptFor(tx));
    }
    return this.fail(req, 'METHOD_NOT_ALLOWED', `RPC method not allowed: ${method}`);
  }

  private receiptFor(tx: ChainTx): unknown {
    return {
      contract: tx.params?.contract ?? 'oct' + 'C'.repeat(44),
      method: tx.params?.method ?? 'deploy',
      success: true,
      effort: 1200,
      events: [{ event: 'Called', values: [tx.params?.method ?? 'deploy'] }],
      error: null,
      epoch: tx.epoch,
      ts: 0,
    };
  }

  private key(origin: string, rid: string): string {
    return `${origin}\n${rid}`;
  }

  private lookup(origin: string, rid: string): RequestRecord | undefined {
    const rec = this.records.get(this.key(origin, rid));
    if (rec && isFinalStatus(rec.status) && this.clock.now() - rec.updatedAt > LIFECYCLE_LIMITS.recordTtlMs) {
      this.records.delete(this.key(origin, rid));
      return undefined;
    }
    return rec;
  }

  /** An unconnected site sees `review_open` for `locked`, and no address or network. */
  view(rec: RequestRecord): Record<string, unknown> {
    const connected = this.connected.has(rec.origin);
    return {
      requestId: rec.rid,
      status: rec.status === 'locked' && !connected ? 'review_open' : rec.status,
      method: rec.method,
      ...(connected ? { network: rec.network, address: rec.address } : {}),
      ...(rec.hash ? { hash: rec.hash } : {}),
      ...(rec.epoch !== undefined ? { epoch: rec.epoch } : {}),
      ...(rec.receipt !== undefined ? { receipt: rec.receipt } : {}),
      ...(rec.receiptUnavailable ? { receiptUnavailable: rec.receiptUnavailable } : {}),
      ...(rec.result !== undefined ? { result: rec.result } : {}),
      ...(rec.error ? { error: rec.error } : {}),
      ...(rec.watching !== undefined ? { watching: rec.watching } : {}),
      seq: rec.seq,
      createdAt: rec.createdAt,
      updatedAt: rec.updatedAt,
    };
  }

  private requestStatus(page: ReferencePage, req: WireRequest): WireReply {
    if (this.protocol !== 2) return this.fail(req, 'METHOD_NOT_ALLOWED', 'Unknown method: request_status');
    const rid = (req.params as any)?.rid;
    if (!isRequestId(rid)) return this.fail(req, 'INVALID_PARAMS', 'rid must be 32 lowercase hex characters');
    const rec = this.lookup(page.origin, rid);
    if (!rec) {
      const now = this.clock.now();
      return this.ok(req, { requestId: rid, status: 'unknown', seq: 0, createdAt: now, updatedAt: now });
    }
    return this.ok(req, this.view(rec));
  }

  private cancelRequest(page: ReferencePage, req: WireRequest): WireReply {
    if (this.protocol !== 2) return this.fail(req, 'METHOD_NOT_ALLOWED', 'Unknown method: cancel_request');
    const rid = (req.params as any)?.rid;
    if (!isRequestId(rid)) return this.fail(req, 'INVALID_PARAMS', 'rid must be 32 lowercase hex characters');
    const rec = this.lookup(page.origin, rid);
    if (!rec) {
      const now = this.clock.now();
      return this.ok(req, { requestId: rid, status: 'unknown', seq: 0, createdAt: now, updatedAt: now });
    }
    if (rec.status === 'pending' || rec.status === 'locked' || rec.status === 'review_open') {
      this.finish(rec, 'rejected', 'USER_REJECTED', 'Cancelled by the site');
    }
    return this.ok(req, this.view(rec));
  }

  private async lifecycle(page: ReferencePage, req: WireRequest, rid: string | undefined): Promise<WireReply> {
    if (rid !== undefined && !isRequestId(rid)) {
      return this.fail(req, 'INVALID_PARAMS', 'rid must be 32 lowercase hex characters');
    }
    const params = (req.params ?? {}) as any;
    const network = req.network ?? null;
    const digest = await requestDigest(req.method, req.params, network);

    if (rid) {
      const known = this.lookup(page.origin, rid);
      if (known) {
        if (known.digest !== digest) {
          return this.fail(req, 'REQUEST_ID_REUSED', 'This request id belongs to another request', rid);
        }
        known.senders.add(page);
        if (known.outcome) return this.answer(req.id, rid, known.outcome);
        return new Promise((resolve) => known.waiters.push({ page, id: req.id, resolve }));
      }
    }
    if (req.method !== 'connect' && !this.connected.has(page.origin)) {
      return this.fail(req, 'NOT_CONNECTED', 'Connect the wallet first', rid);
    }
    const foreign = this.foreignSigner(req.method, params);
    if (foreign) return this.fail(req, 'INVALID_PARAMS', foreign, rid);
    if (req.method === 'register_private_view_key' && !this.registered) {
      if (this.foreignKey) return this.fail(req, 'PVAC_KEY_MISMATCH', 'Another private key is registered for this account', rid);
      if (this.pendingRegistration) return this.fail(req, 'REGISTRATION_PENDING', 'The registration is waiting for confirmation', rid);
      if (this.balanceRaw < this.keySwitchFeeRaw) {
        return this.fail(req, 'INSUFFICIENT_BALANCE', 'The balance does not cover the registration fee', rid);
      }
    }
    const open = [...this.records.values()].filter((r) => r.origin === page.origin && !isFinalStatus(r.status)).length;
    if (rid && open >= (this.options.openRequestCap ?? LIFECYCLE_LIMITS.openPerOrigin)) {
      return this.fail(req, 'RATE_LIMIT_EXCEEDED', 'Too many requests from this site are waiting', rid);
    }

    const now = this.clock.now();
    const rec: RequestRecord = {
      origin: page.origin,
      rid: rid ?? `anon-${now}-${Math.random()}`,
      anonymous: !rid,
      digest,
      method: req.method,
      params,
      network: req.method === 'connect' && typeof params.networkId === 'string' ? params.networkId : this.network,
      address: this.address,
      status: 'pending',
      seq: 1,
      createdAt: now,
      updatedAt: now,
      senders: new Set([page]),
      waiters: [],
    };
    const reply = new Promise<WireReply>((resolve) => rec.waiters.push({ page, id: req.id, resolve }));
    if (rid) {
      this.store(rec);
      this.emit(rec);
    }
    if (req.method === 'broadcast_only') {
      this.submit(rec);
    } else if (this.nothingToReview(rec)) {
      this.complete(rec);
    } else {
      this.queue.push(rec);
      this.showNext();
    }
    return reply;
  }

  private foreignSigner(method: string, params: any): string | null {
    if (method === 'broadcast_only' && params?.signedTx?.from !== this.address) {
      return 'The signed transaction is not from the connected wallet';
    }
    if (method === 'register_private_view_key' && params?.address !== this.address) {
      return 'Only the connected wallet can register its own key';
    }
    return null;
  }

  private nothingToReview(rec: RequestRecord): boolean {
    if (rec.method === 'connect') return this.connected.has(rec.origin);
    if (rec.method === 'switch_network') return rec.params?.networkId === this.network;
    if (rec.method === 'register_private_view_key') return this.registered;
    return false;
  }

  private store(rec: RequestRecord): void {
    const ofOrigin = [...this.records.values()].filter((r) => r.origin === rec.origin);
    if (ofOrigin.length >= LIFECYCLE_LIMITS.recordsPerOrigin) {
      const oldest = ofOrigin.filter((r) => isFinalStatus(r.status)).sort((a, b) => a.updatedAt - b.updatedAt)[0];
      if (oldest) this.records.delete(this.key(oldest.origin, oldest.rid));
    }
    if (this.records.size >= LIFECYCLE_LIMITS.recordsGlobal) {
      const oldest = [...this.records.values()].filter((r) => isFinalStatus(r.status)).sort((a, b) => a.updatedAt - b.updatedAt)[0];
      if (oldest) this.records.delete(this.key(oldest.origin, oldest.rid));
    }
    this.records.set(this.key(rec.origin, rec.rid), rec);
  }

  private answer(id: string, rid: string | undefined, outcome: Outcome): WireReply {
    const withRid = rid ? { rid } : {};
    if (outcome.ok) return { id, success: true, data: outcome.data, ...withRid };
    return errorReply(id, outcome.code, outcome.message, rid, outcome.status);
  }

  private settle(rec: RequestRecord, outcome: Outcome): void {
    rec.outcome = outcome;
    const rid = rec.anonymous ? undefined : rec.rid;
    for (const w of rec.waiters.splice(0)) w.resolve(this.answer(w.id, rid, outcome));
  }

  private move(rec: RequestRecord, status: RequestStatusValue, patch: Partial<RequestRecord> = {}): void {
    if (!REQUEST_STATUS_TRANSITIONS[rec.status].includes(status) && rec.status !== status) {
      throw new Error(`reference wallet: illegal move ${rec.status} -> ${status}`);
    }
    Object.assign(rec, patch);
    rec.status = status;
    rec.seq += 1;
    rec.updatedAt = this.clock.now();
    this.emit(rec);
  }

  private emit(rec: RequestRecord): void {
    if (this.protocol !== 2 || rec.anonymous) return;
    const data = this.view(rec);
    for (const page of rec.senders) page.deliver({ type: 'requestUpdate', data });
  }

  private showNext(): void {
    if (this.current) return;
    const next = this.queue.shift();
    if (!next) return;
    this.current = next;
    this.reviewsOpened += 1;
    this.move(next, this.locked && this.connected.has(next.origin) ? 'locked' : 'review_open');
    next.reviewTimer = this.clock.setTimeout(() => {
      this.finish(next, 'expired', 'USER_REJECTED', 'The review window closed');
    }, LIFECYCLE_LIMITS.reviewWindowMs);
  }

  private pick(rid?: string): RequestRecord {
    const rec = this.current;
    if (!rec || (rid && rec.rid !== rid)) throw new Error('reference wallet: no such review on screen');
    if (this.locked) throw new Error('reference wallet: unlock first');
    return rec;
  }

  async approve(rid?: string): Promise<void> {
    const rec = this.pick(rid);
    this.clock.clearTimeout(rec.reviewTimer);
    this.current = null;
    if (TX_METHODS.has(rec.method)) {
      this.move(rec, 'signing');
      await Promise.resolve();
      this.signatures += 1;
      this.submit(rec);
    } else {
      if (SIGNING_METHODS.has(rec.method)) this.signatures += 1;
      this.complete(rec);
    }
    this.showNext();
  }

  private submit(rec: RequestRecord): void {
    const hash = (++this.hashSeq).toString(16).padStart(64, 'a');
    this.chain.set(hash, { status: 'pending', method: rec.method, params: rec.params });
    if (rec.method === 'register_private_view_key') this.pendingRegistration = true;
    this.move(rec, 'submitted', { hash, watching: true });
    rec.watchTimer = this.clock.setTimeout(() => {
      if (rec.status === 'submitted') this.move(rec, 'submitted', { watching: false });
    }, LIFECYCLE_LIMITS.watchForMs);
    const data = rec.method === 'deploy_contract'
      ? { txHash: hash, hash, contractAddress: 'oct' + 'D'.repeat(44), requestId: rec.rid }
      : { hash, txHash: hash, accepted: true, success: true, requestId: rec.rid };
    this.settle(rec, { ok: true, data });
  }

  private complete(rec: RequestRecord): void {
    let data: unknown;
    if (rec.method === 'connect') {
      this.connected.add(rec.origin);
      data = { address: this.address, networkInfo: NETWORKS[rec.network] ?? NETWORKS.mainnet, permissions: ['accounts'], canSign: true };
    } else if (rec.method === 'switch_network') {
      const switched = this.network !== String(rec.params.networkId);
      this.network = String(rec.params.networkId);
      data = { network: this.network, switched };
    } else if (rec.method === 'register_private_view_key') {
      data = { status: 'registered', view_pubkey: this.viewPubkey, pvac: true, requestId: rec.rid };
    } else {
      data = { signature: 'c2lnbmF0dXJl', requestId: rec.rid };
    }
    this.move(rec, 'completed', { result: boundedResult(data) });
    this.settle(rec, { ok: true, data });
  }

  async reject(rid?: string): Promise<void> {
    const rec = this.current;
    if (!rec || (rid && rec.rid !== rid)) throw new Error('reference wallet: no such review on screen');
    this.finish(rec, 'rejected', 'USER_REJECTED', 'Rejected in the wallet');
  }

  private finish(rec: RequestRecord, status: 'rejected' | 'expired' | 'failed', code: string, message: string, stage: 'review' | 'submit' | 'execution' = 'review'): void {
    if (isFinalStatus(rec.status)) return;
    this.clock.clearTimeout(rec.reviewTimer);
    this.clock.clearTimeout(rec.watchTimer);
    this.queue = this.queue.filter((r) => r !== rec);
    if (status === 'failed') this.move(rec, 'failed', { error: { code, message, stage }, watching: undefined });
    else this.move(rec, status);
    this.settle(rec, { ok: false, code, message, status });
    if (this.current === rec) {
      this.current = null;
      this.showNext();
    }
  }

  lock(): void {
    this.locked = true;
  }

  unlock(): void {
    this.locked = false;
    if (this.current?.status === 'locked') this.move(this.current, 'review_open');
  }

  private byHash(hash: string): RequestRecord | undefined {
    return [...this.records.values()].find((r) => r.hash === hash);
  }

  confirmOnChain(hash: string): void {
    const tx = this.chain.get(hash);
    if (!tx) throw new Error('reference wallet: unknown hash');
    tx.status = 'confirmed';
    tx.epoch = ++this.epoch;
    const rec = this.byHash(hash);
    if (!rec || rec.status !== 'submitted') return;
    this.clock.clearTimeout(rec.watchTimer);
    if (rec.method === 'register_private_view_key') {
      this.registered = true;
      this.pendingRegistration = false;
    }
    const contract = rec.method === 'call_contract' || rec.method === 'deploy_contract';
    this.move(rec, 'confirmed', {
      epoch: tx.epoch,
      watching: false,
      ...(contract
        ? this.options.refuseReceipts
          ? { receipt: null, receiptUnavailable: 'refused' as const }
          : { receipt: this.receiptFor(tx) }
        : {}),
    });
  }

  failOnChain(hash: string, reason: string, status: 'rejected' | 'dropped' = 'rejected'): void {
    const tx = this.chain.get(hash);
    if (!tx) throw new Error('reference wallet: unknown hash');
    tx.status = status;
    tx.reason = reason;
    const rec = this.byHash(hash);
    if (!rec || rec.status !== 'submitted') return;
    if (rec.method === 'register_private_view_key') this.pendingRegistration = false;
    this.finish(rec, 'failed', 'EXECUTION_FAILED', reason, 'execution');
  }

  dropOnChain(hash: string): void {
    this.failOnChain(hash, 'dropped', 'dropped');
  }

  pageClosed(page: ReferencePage): void {
    for (const rec of [...this.records.values(), ...this.queue, ...(this.current ? [this.current] : [])]) {
      if (!rec.senders.has(page)) continue;
      rec.senders.delete(page);
      rec.waiters = rec.waiters.filter((w) => w.page !== page);
      const live = [...rec.senders].some((p) => !p.closed);
      const unanswered = rec.status === 'pending' || rec.status === 'locked' || rec.status === 'review_open';
      if (!live && unanswered) this.finish(rec, 'rejected', 'USER_REJECTED', 'The page closed');
    }
  }
}
