import { ZeroXIOWallet } from '../src/wallet';
import { ErrorCode, ZeroXIOWalletError } from '../src/types';
import type { RequestStatus } from '../src/types';
import { SDK_VERSION } from '../src/index';
import {
  RequestTracker,
  WALLET_CAPABILITIES,
  newRequestId,
  parseRequestStatus,
  parseWalletHello,
} from '../src/lifecycle';
import { ManualClock } from '../conformance/reference/clock';
import { ReferenceWallet } from '../conformance/reference/referenceWallet';
import { createLegacyWallet } from '../conformance/reference/legacyWallet';
import { BrowserPage, installBrowserPage } from '../conformance/reference/browserPage';

const CONTRACT = 'oct' + 'C'.repeat(44);
const TO = 'oct' + 'B'.repeat(44);
const call = { contract: CONTRACT, method: 'deposit', params: [1] };

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** sha256 resolves outside fake timers, so each step also yields to the real event loop. */
async function spin(): Promise<void> {
  await jest.advanceTimersByTimeAsync(1);
  await new Promise((r) => setImmediate(r));
}

async function settle<T>(p: Promise<T>, ms = 30_000): Promise<T> {
  let done = false;
  p.then(() => (done = true), () => (done = true));
  for (let t = 0; t < ms && !done; t += 100) {
    await jest.advanceTimersByTimeAsync(100);
    await new Promise((r) => setImmediate(r));
  }
  return p;
}

async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('condition not met');
    await tick(2);
  }
}

let pages: BrowserPage[] = [];
let wallets: ZeroXIOWallet[] = [];

afterEach(() => {
  jest.useRealTimers();
  wallets.forEach((w) => w.cleanup());
  pages.reverse().forEach((p) => p.uninstall());
  pages = [];
  wallets = [];
});

async function sdkFor(wallet: ReferenceWallet, connect = true): Promise<{ w: ZeroXIOWallet; page: BrowserPage }> {
  const page = installBrowserPage(wallet);
  pages.push(page);
  const w = new ZeroXIOWallet({ appName: 'Test', desktop: false, requiredPermissions: ['accounts'] });
  wallets.push(w);
  await w.initialize();
  if (connect) {
    const p = w.connect();
    await until(() => wallet.reviewOnScreen() !== null);
    await wallet.approve();
    await p;
  }
  return { w, page };
}

const sent = (wallet: ReferenceWallet, method: string) => wallet.received.filter((r) => r.request.method === method);

describe('version', () => {
  it('SDK_VERSION is the package.json version', () => {
    expect(SDK_VERSION).toBe(require('../package.json').version);
  });
});

describe('protocol 2 wallet', () => {
  it('negotiates protocol 2 with wallet_hello and fills walletInfo', async () => {
    const wallet = new ReferenceWallet();
    const { w } = await sdkFor(wallet, false);
    expect(w.walletInfo).toEqual({ kind: 'extension', version: '3.0.6', protocol: 2, capabilities: [...WALLET_CAPABILITIES] });
    const hello = sent(wallet, 'wallet_hello');
    expect(hello).toHaveLength(1);
    expect(hello[0].request.params).toEqual({ sdk: SDK_VERSION, protocols: [1, 2] });
    for (const r of wallet.received) expect(r.request.v).toBe(2);
    expect(sent(wallet, 'ping')[0].request.rid).toBeUndefined();
  });

  it('gives a review call a 32 hex request id and reports each status', async () => {
    const wallet = new ReferenceWallet();
    const { w } = await sdkFor(wallet, false);
    const seen: RequestStatus[] = [];
    const events: RequestStatus[] = [];
    w.on('requestUpdate', (e) => events.push(e.data));
    const rid = w.newRequestId();
    const p = w.connect({ requestId: rid, onStatus: (s) => seen.push(s) });
    await until(() => wallet.reviewOnScreen() === rid);
    await wallet.approve();
    await p;
    expect(sent(wallet, 'connect')[0].request.rid).toBe(rid);
    expect(seen.map((s) => s.status)).toEqual(['pending', 'review_open', 'completed']);
    expect(events.every((e) => e.requestId === rid)).toBe(true);
    for (let i = 1; i < seen.length; i++) expect(seen[i].seq).toBeGreaterThan(seen[i - 1].seq);
    expect((await w.requestStatus(rid)).status).toBe('completed');
  });

  it("wait: 'confirmed' resolves when the wallet reports the chain's verdict, with the receipt", async () => {
    const wallet = new ReferenceWallet();
    const { w } = await sdkFor(wallet);
    const p = w.callContract(call, { wait: 'confirmed' });
    await until(() => wallet.reviewOnScreen() !== null);
    await wallet.approve();
    await until(() => !!w.pendingRequest() === false);
    await tick(5);
    const rid = sent(wallet, 'call_contract')[0].request.rid!;
    const status = await w.requestStatus(rid);
    expect(status.status).toBe('submitted');
    wallet.confirmOnChain(status.hash!);
    const res = await p;
    expect(res).toMatchObject({ requestId: rid, requestStatus: 'confirmed', hash: status.hash, epoch: expect.any(Number) });
    expect(res.receipt).toMatchObject({ success: true, method: 'deposit', events: [{ event: 'Called' }] });
    expect(sent(wallet, 'rpc_call')).toHaveLength(0);
  });

  it("wait: 'confirmed' rejects with EXECUTION_FAILED when the chain rejects it", async () => {
    const wallet = new ReferenceWallet();
    const { w } = await sdkFor(wallet);
    const p = w.sendTransaction({ to: TO, amount: '1000' }, { wait: 'confirmed' }).catch((e) => e);
    await until(() => wallet.reviewOnScreen() !== null);
    await wallet.approve();
    await tick(5);
    const rid = sent(wallet, 'send_transaction')[0].request.rid!;
    wallet.failOnChain((await w.requestStatus(rid)).hash!, 'nonce too low');
    const err = await p;
    expect(err).toBeInstanceOf(ZeroXIOWalletError);
    expect(err).toMatchObject({ code: ErrorCode.EXECUTION_FAILED, requestId: rid, details: { requestId: rid, reason: 'nonce too low' } });
  });

  it('without wait, a write resolves at submitted with the request id', async () => {
    const wallet = new ReferenceWallet();
    const { w } = await sdkFor(wallet);
    const p = w.sendTransaction({ to: TO, amount: '1000' });
    await until(() => wallet.reviewOnScreen() !== null);
    await wallet.approve();
    const res = await p;
    expect(res).toMatchObject({ requestStatus: 'submitted', requestId: expect.stringMatching(/^[0-9a-f]{32}$/), accepted: true });
  });

  it('registerPrivateViewKey is a reviewed transaction that waits for its confirmation', async () => {
    const wallet = new ReferenceWallet();
    const { w } = await sdkFor(wallet);
    const p = w.registerPrivateViewKey({ address: wallet.address }, { wait: 'confirmed' });
    await until(() => wallet.reviewOnScreen() !== null);
    await wallet.approve();
    await tick(5);
    const rid = sent(wallet, 'register_private_view_key')[0].request.rid!;
    wallet.confirmOnChain((await w.requestStatus(rid)).hash!);
    expect(await p).toMatchObject({ requestStatus: 'confirmed', hash: expect.any(String) });
    expect(wallet.signatures).toBe(1);
  });

  it('registerPrivateViewKey for a registered account completes at once with nothing signed', async () => {
    const wallet = new ReferenceWallet({ registered: true });
    const { w } = await sdkFor(wallet);
    const res = await w.registerPrivateViewKey({ address: wallet.address }, { wait: 'confirmed' });
    expect(res).toMatchObject({ status: 'registered', view_pubkey: wallet.viewPubkey, pvac: true, requestStatus: 'completed' });
    expect(wallet.reviewsOpened).toBe(1);
    expect(wallet.signatures).toBe(0);
  });

  it('refuses registerPrivateViewKey below the fee with INSUFFICIENT_BALANCE before any review', async () => {
    const wallet = new ReferenceWallet({ balanceRaw: '0' });
    const { w } = await sdkFor(wallet);
    await expect(w.registerPrivateViewKey({ address: wallet.address })).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_BALANCE });
    expect(wallet.reviewsOpened).toBe(1);
  });

  it('keeps PVAC_KEY_MISMATCH and REGISTRATION_PENDING as the wallet sent them', async () => {
    const foreign = new ReferenceWallet({ foreignKey: true });
    const a = await sdkFor(foreign);
    await expect(a.w.registerPrivateViewKey({ address: foreign.address })).rejects.toMatchObject({ code: ErrorCode.PVAC_KEY_MISMATCH });
    a.w.cleanup();
    a.page.uninstall();
    const pending = new ReferenceWallet({ pendingRegistration: true });
    const b = await sdkFor(pending);
    await expect(b.w.registerPrivateViewKey({ address: pending.address })).rejects.toMatchObject({ code: ErrorCode.REGISTRATION_PENDING });
    expect(foreign.reviewsOpened + pending.reviewsOpened).toBe(2);
  });

  it('refuses registerPrivateViewKey for another address before any review', async () => {
    const wallet = new ReferenceWallet();
    const { w } = await sdkFor(wallet);
    await expect(w.registerPrivateViewKey({ address: TO })).rejects.toMatchObject({ code: ErrorCode.INVALID_PARAMS });
    expect(wallet.reviewsOpened).toBe(1);
  });

  it('a second call with the same id joins: one message, one review, one signature', async () => {
    const wallet = new ReferenceWallet();
    const { w } = await sdkFor(wallet);
    const rid = newRequestId();
    const a = w.callContract(call, { requestId: rid });
    const b = w.callContract(call, { requestId: rid });
    await until(() => wallet.reviewOnScreen() === rid);
    await wallet.approve();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.hash).toBe(rb.hash);
    expect(sent(wallet, 'call_contract')).toHaveLength(1);
    expect(wallet.signatures).toBe(1);
    const again = await w.callContract(call, { requestId: rid });
    expect(again.hash).toBe(ra.hash);
    expect(sent(wallet, 'call_contract')).toHaveLength(1);
  });

  it('refuses an id in use with other params before sending anything', async () => {
    const wallet = new ReferenceWallet();
    const { w } = await sdkFor(wallet);
    const rid = newRequestId();
    const a = w.callContract(call, { requestId: rid });
    await until(() => wallet.reviewOnScreen() === rid);
    await expect(w.callContract({ ...call, method: 'withdraw' }, { requestId: rid })).rejects.toMatchObject({
      code: ErrorCode.REQUEST_ID_REUSED,
      details: { requestId: rid },
    });
    await wallet.reject();
    await expect(a).rejects.toMatchObject({ code: ErrorCode.USER_REJECTED, details: { requestId: rid, status: 'rejected' } });
  });

  it('refuses a malformed request id', async () => {
    const wallet = new ReferenceWallet();
    const { w } = await sdkFor(wallet);
    await expect(w.signMessage('x', { requestId: 'NOT-AN-ID' })).rejects.toMatchObject({ code: ErrorCode.INVALID_PARAMS });
    await expect(w.requestStatus('nope')).rejects.toMatchObject({ code: ErrorCode.INVALID_PARAMS });
  });

  it('a timeout ends only the SDK wait: STATUS_UNKNOWN with the id, the review stays, nothing is resent', async () => {
    const wallet = new ReferenceWallet();
    const { w } = await sdkFor(wallet);
    const rid = newRequestId();
    const err = await w.callContract(call, { requestId: rid, timeoutMs: 40 }).catch((e) => e);
    expect(err).toMatchObject({ code: ErrorCode.STATUS_UNKNOWN, requestId: rid, details: { requestId: rid, lastStatus: 'review_open' } });
    expect(wallet.reviewOnScreen()).toBe(rid);
    await wallet.approve();
    await tick(5);
    expect((await w.requestStatus(rid)).status).toBe('submitted');
    const again = await w.callContract(call, { requestId: rid });
    expect(again.hash).toBeDefined();
    expect(wallet.signatures).toBe(1);
    expect(wallet.reviewsOpened).toBe(2);
  });

  it('every status change restarts the SDK wait', async () => {
    const wallet = new ReferenceWallet();
    const { w } = await sdkFor(wallet);
    wallet.lock();
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    const p = w.signMessage('slow', { timeoutMs: 1_000 });
    const settled = jest.fn();
    p.then(settled, settled);
    while (wallet.reviewOnScreen() === null) await spin();
    await jest.advanceTimersByTimeAsync(800);
    wallet.unlock();
    await spin();
    await jest.advanceTimersByTimeAsync(800);
    expect(settled).not.toHaveBeenCalled();
    await wallet.approve();
    await expect(settle(p)).resolves.toBe('c2lnbmF0dXJl');
  });

  it('a review that ran out its window rejects USER_REJECTED with status expired', async () => {
    const clock = new ManualClock();
    const wallet = new ReferenceWallet({ clock });
    const { w } = await sdkFor(wallet);
    const p = w.sendTransaction({ to: TO, amount: '1' }).catch((e) => e);
    await until(() => wallet.reviewOnScreen() !== null);
    clock.advance(5 * 60_000 + 1);
    const err = await p;
    expect(err).toMatchObject({ code: ErrorCode.USER_REJECTED, details: { status: 'expired' } });
    expect((await w.requestStatus(err.requestId)).status).toBe('expired');
  });

  it('a reloaded page reads the outcome by id and waits for the chain', async () => {
    const wallet = new ReferenceWallet();
    const first = await sdkFor(wallet);
    const rid = newRequestId();
    const p = first.w.callContract(call, { requestId: rid });
    await until(() => wallet.reviewOnScreen() === rid);
    await wallet.approve();
    await p;
    first.w.cleanup();

    const { w } = await sdkFor(wallet, false);
    const status = await w.requestStatus(rid);
    expect(status).toMatchObject({ requestId: rid, status: 'submitted', hash: expect.any(String) });
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    const done = w.waitForRequest(rid);
    const settled = jest.fn();
    done.then(settled, settled);
    wallet.confirmOnChain(status.hash!);
    await spin();
    expect(settled).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(5_000);
    for (let i = 0; i < 5; i++) await spin();
    await expect(done).resolves.toMatchObject({ status: 'confirmed' });
    jest.useRealTimers();
    expect(wallet.signatures).toBe(1);
    expect((await w.requestStatus(newRequestId())).status).toBe('unknown');
  });

  it('switchNetwork waits for a pending review and names it; pendingRequest() shows it', async () => {
    const wallet = new ReferenceWallet();
    const { w } = await sdkFor(wallet);
    const rid = newRequestId();
    const p = w.signMessage('first', { requestId: rid });
    await until(() => w.pendingRequest()?.status === 'review_open');
    expect(w.pendingRequest()).toEqual({ requestId: rid, method: 'signMessage', status: 'review_open' });
    await expect(w.switchNetwork('devnet')).rejects.toMatchObject({
      code: ErrorCode.RATE_LIMIT_EXCEEDED,
      details: { reason: 'review_pending', requestId: rid, status: 'review_open' },
    });
    await wallet.approve();
    await p;
    expect(w.pendingRequest()).toBeNull();
  });

  it('cancelRequest closes a review that was not approved', async () => {
    const wallet = new ReferenceWallet();
    const { w } = await sdkFor(wallet);
    const rid = newRequestId();
    const p = w.sendTransaction({ to: TO, amount: '1' }, { requestId: rid }).catch((e) => e);
    await until(() => wallet.reviewOnScreen() === rid);
    expect((await w.cancelRequest(rid)).status).toBe('rejected');
    expect(await p).toMatchObject({ code: ErrorCode.USER_REJECTED });
    expect(wallet.signatures).toBe(0);
  });

  it.each([
    ['extension', (data: unknown) => ({ source: '0xio-sdk-bridge', event: { type: 'requestUpdate', data, timestamp: Date.now() }, sessionNonce: 'reference-session-nonce' })],
    ['app', (data: unknown) => ({ source: '0xio-sdk-bridge', sessionNonce: 'reference-session-nonce', event: { type: 'requestUpdate', data } })],
  ])('delivers the %s wire shape to wallet.on(\'requestUpdate\') as event.data', async (_name, frame) => {
    const wallet = new ReferenceWallet();
    const { w, page } = await sdkFor(wallet);
    const heard: Array<{ type: string; data: RequestStatus }> = [];
    w.on('requestUpdate', (event) => heard.push(event));
    const rid = newRequestId();
    const p = w.signMessage('shape', { requestId: rid });
    await until(() => w.pendingRequest()?.status === 'review_open');
    const ev = Object.assign(new Event('message'), {
      data: frame({ requestId: rid, status: 'signing', seq: 50, createdAt: 1, updatedAt: 2 }),
      origin: page.window.location.origin,
      source: page.window,
    });
    page.window.dispatchEvent(ev);
    await until(() => heard.some((e) => e.data.status === 'signing'));
    const last = heard[heard.length - 1];
    expect(last.type).toBe('requestUpdate');
    expect(last.data).toMatchObject({ requestId: rid, status: 'signing' });
    expect((last as any).requestId).toBeUndefined();
    await wallet.approve();
    await p;
  });

  it('drops requestUpdate events for ids this page did not send', async () => {
    const wallet = new ReferenceWallet();
    const { w, page } = await sdkFor(wallet);
    const seen: unknown[] = [];
    w.on('requestUpdate', (e) => seen.push(e.data));
    const stranger = newRequestId();
    page.page.deliver({ type: 'requestUpdate', data: { requestId: stranger, status: 'submitted', seq: 9, hash: 'f'.repeat(64) } });
    await tick(5);
    expect(seen).toHaveLength(0);
    expect((await w.requestStatus(stranger)).status).toBe('unknown');
  });

  it('maps the wire RATE_LIMITED to RATE_LIMIT_EXCEEDED', async () => {
    const wallet = new ReferenceWallet();
    const { w, page } = await sdkFor(wallet);
    for (let i = 0; i < 25; i++) page.page.overBudget(wallet.clock.now());
    await expect(w.signMessage('burst')).rejects.toMatchObject({
      code: ErrorCode.RATE_LIMIT_EXCEEDED,
      details: { reason: 'requests_per_second' },
    });
  });
});

describe('protocol 1 wallet (fallbacks)', () => {
  it('reads a failed wallet_hello as protocol 1 and sends the id anyway', async () => {
    const wallet = createLegacyWallet();
    const { w } = await sdkFor(wallet);
    expect(w.walletInfo).toMatchObject({ kind: 'extension', protocol: 1, capabilities: [] });
    expect(sent(wallet, 'connect')[0].request.rid).toMatch(/^[0-9a-f]{32}$/);
  });

  it('joins a repeated id in the SDK, since the wallet would open a second review', async () => {
    const wallet = createLegacyWallet();
    const { w } = await sdkFor(wallet);
    const rid = newRequestId();
    const a = w.signMessage('one', { requestId: rid });
    const b = w.signMessage('one', { requestId: rid });
    await until(() => wallet.reviewOnScreen() !== null);
    await wallet.approve();
    expect(await a).toBe(await b);
    expect(await w.signMessage('one', { requestId: rid })).toBe(await a);
    expect(sent(wallet, 'signMessage')).toHaveLength(1);
    expect(wallet.reviewsOpened).toBe(2);
  });

  it('answers requestStatus from SDK memory, never asking the wallet', async () => {
    const wallet = createLegacyWallet();
    const { w } = await sdkFor(wallet);
    const rid = newRequestId();
    const p = w.sendTransaction({ to: TO, amount: '5' }, { requestId: rid });
    await until(() => wallet.reviewOnScreen() !== null);
    expect((await w.requestStatus(rid)).status).toBe('pending');
    await wallet.approve();
    const res = await p;
    expect(await w.requestStatus(rid)).toMatchObject({ status: 'submitted', hash: res.hash });
    expect((await w.requestStatus(newRequestId())).status).toBe('unknown');
    expect(sent(wallet, 'request_status')).toHaveLength(0);
  });

  it('after a timeout never sends the same id again: STATUS_UNKNOWN, no second review', async () => {
    const wallet = createLegacyWallet();
    const { w } = await sdkFor(wallet);
    const rid = newRequestId();
    await expect(w.sendTransaction({ to: TO, amount: '5' }, { requestId: rid, timeoutMs: 30 })).rejects.toMatchObject({
      code: ErrorCode.STATUS_UNKNOWN,
      details: { requestId: rid, lastStatus: 'pending' },
    });
    await expect(w.sendTransaction({ to: TO, amount: '5' }, { requestId: rid })).rejects.toMatchObject({
      code: ErrorCode.STATUS_UNKNOWN,
    });
    expect(sent(wallet, 'send_transaction')).toHaveLength(1);
    expect(wallet.reviewsOpened).toBe(2);
  });

  it("wait: 'confirmed' reads octra_transaction and the receipt through rpc_call", async () => {
    const wallet = createLegacyWallet();
    const { w } = await sdkFor(wallet);
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    const p = w.callContract(call, { wait: 'confirmed' });
    while (wallet.reviewOnScreen() === null) await spin();
    await wallet.approve();
    await jest.advanceTimersByTimeAsync(4_000);
    expect(sent(wallet, 'rpc_call')).toHaveLength(1);
    const hash = (sent(wallet, 'rpc_call')[0].request.params as any).params[0];
    wallet.confirmOnChain(hash);
    const res = await settle(p);
    expect(res).toMatchObject({ requestStatus: 'confirmed', epoch: expect.any(Number), receipt: { success: true } });
    expect(sent(wallet, 'rpc_call').map((r) => (r.request.params as any).method)).toEqual([
      'octra_transaction',
      'octra_transaction',
      'contract_receipt',
    ]);
    expect(wallet.signatures).toBe(1);
  });

  it("wait: 'confirmed' reports a receipt the node refuses as refused, not as a failure", async () => {
    const wallet = createLegacyWallet({ refuseReceipts: true });
    const { w } = await sdkFor(wallet);
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    const p = w.callContract(call, { wait: 'confirmed' });
    while (wallet.reviewOnScreen() === null) await spin();
    await wallet.approve();
    await jest.advanceTimersByTimeAsync(10);
    const rid = sent(wallet, 'call_contract')[0].request.rid!;
    wallet.confirmOnChain((await settle(w.requestStatus(rid))).hash!);
    expect(await settle(p)).toMatchObject({ requestStatus: 'confirmed', receipt: null, receiptUnavailable: 'refused' });
  });

  it('reports EXECUTION_FAILED for a dropped transaction', async () => {
    const wallet = createLegacyWallet();
    const { w } = await sdkFor(wallet);
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    const p = w.sendTransaction({ to: TO, amount: '5' }, { wait: 'confirmed' }).catch((e) => e);
    while (wallet.reviewOnScreen() === null) await spin();
    await wallet.approve();
    await jest.advanceTimersByTimeAsync(10);
    const rid = sent(wallet, 'send_transaction')[0].request.rid!;
    wallet.dropOnChain((await w.requestStatus(rid)).hash!);
    await jest.advanceTimersByTimeAsync(4_000);
    expect(await p).toMatchObject({ code: ErrorCode.EXECUTION_FAILED, details: { reason: 'dropped' } });
  });

  it("wait: 'confirmed' rejects UNSUPPORTED_METHOD with the hash when rpc_call is refused", async () => {
    const wallet = createLegacyWallet({ refuseRpc: true });
    const { w } = await sdkFor(wallet);
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    const p = w.sendTransaction({ to: TO, amount: '5' }, { wait: 'confirmed' }).catch((e) => e);
    while (wallet.reviewOnScreen() === null) await spin();
    await wallet.approve();
    const err = await settle(p);
    expect(err).toMatchObject({ code: ErrorCode.UNSUPPORTED_METHOD, details: { hash: expect.any(String), status: 'submitted' } });
    expect(wallet.signatures).toBe(1);
  });
});

describe('RequestTracker', () => {
  const rid = '0123456789abcdef0123456789abcdef';
  const update = (status: string, seq: number, extra: object = {}) =>
    parseRequestStatus({ requestId: rid, status, seq, ...extra })!;

  it('drops stale, backwards and post-final wallet updates', () => {
    const seen: string[] = [];
    const t = new RequestTracker((s) => seen.push(s.status));
    t.begin(rid, 'call_contract', 'k');
    expect(t.wallet(update('review_open', 2))).toBe(true);
    expect(t.wallet(update('pending', 3))).toBe(false);
    expect(t.wallet(update('signing', 2))).toBe(false);
    expect(t.wallet(update('submitted', 4, { hash: 'a'.repeat(64) }))).toBe(true);
    expect(t.wallet(update('confirmed', 5))).toBe(true);
    expect(t.wallet(update('failed', 6))).toBe(false);
    expect(t.local(rid, { status: 'failed' })).toBe(false);
    expect(seen).toEqual(['pending', 'review_open', 'submitted', 'confirmed']);
  });

  it('ignores events for ids it does not hold unless asked to keep them', () => {
    const t = new RequestTracker();
    expect(t.wallet(update('submitted', 3))).toBe(false);
    expect(t.wallet(update('submitted', 3), true)).toBe(true);
    expect(t.snapshot(rid)?.status).toBe('submitted');
  });

  it('keeps at most its limit, evicting finished records first', () => {
    const t = new RequestTracker(() => {}, 2);
    const ids = [newRequestId(), newRequestId(), newRequestId()];
    t.begin(ids[0], 'signMessage', null);
    t.local(ids[0], { status: 'completed' });
    t.begin(ids[1], 'signMessage', null);
    t.begin(ids[2], 'signMessage', null);
    expect(t.get(ids[0])).toBeUndefined();
    expect(t.get(ids[2])).toBeDefined();
  });
});

describe('wire parsing', () => {
  it('parseRequestStatus checks and bounds every field', () => {
    expect(parseRequestStatus({ requestId: 'x', status: 'pending' })).toBeNull();
    expect(parseRequestStatus({ requestId: '0'.repeat(32), status: 'weird' })).toBeNull();
    const s = parseRequestStatus({
      requestId: '0'.repeat(32),
      status: 'failed',
      seq: 3,
      network: 'Bad Network',
      error: { code: 'EXECUTION_FAILED', message: 'x'.repeat(900), stage: 'nowhere' },
      result: { big: 'y'.repeat(5000) },
      secret: 'dropped',
    })!;
    expect(s.network).toBeUndefined();
    expect(s.result).toBeUndefined();
    expect(s.error).toEqual({ code: 'EXECUTION_FAILED', message: 'x'.repeat(500), stage: 'review' });
    expect((s as any).secret).toBeUndefined();
    expect(Object.isFrozen(s)).toBe(true);
  });

  it('parseWalletHello reads protocol 1 from anything that is not a protocol 2 answer', () => {
    expect(parseWalletHello({}, 'extension')).toEqual({ kind: 'extension', protocol: 1, capabilities: [] });
    expect(parseWalletHello({ protocol: 2, kind: 'nope', capabilities: ['ok', 'BAD', 7] }, 'app-expo')).toEqual({
      kind: 'app-expo',
      protocol: 2,
      capabilities: ['ok'],
    });
  });
});
