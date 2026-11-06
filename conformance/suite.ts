import type { RequestStatusValue } from '../src/types';
import {
  LIFECYCLE_LIMITS,
  REQUEST_STATUS_TRANSITIONS,
  WALLET_CAPABILITIES,
  isFinalStatus,
  isLifecycleMethod,
  newRequestId,
} from '../src/lifecycle';
import { CONFORMANCE_KINDS, ConformanceAdapter, ConformanceFeatures, PageTransport, WireEvent, WireReply, WireRequest } from './harness';

export interface ConformanceTarget {
  readonly name: string;
  readonly features: ConformanceFeatures;
  /** Called for each test. */
  create(): ConformanceAdapter | Promise<ConformanceAdapter>;
  /** Real ms to wait for a wallet state. Default 10000. */
  readonly settleTimeoutMs?: number;
  /** Real ms between `request_status` polls; the extension allows 2 a second per origin. Default 500. */
  readonly statusPollMs?: number;
}

const SITE = 'https://site.example';
const OTHER = 'https://other.example';
const CONTRACT = 'oct' + 'C'.repeat(44);
const RECIPIENT = 'oct' + 'B'.repeat(44);

let seq = 0;
function wire(method: string, params: unknown, extra: Partial<WireRequest> = {}): WireRequest {
  return { id: `conformance-${++seq}`, method, params, timestamp: Date.now(), v: 2, ...extra };
}

const callParams = (method = 'deposit') => ({ contract: CONTRACT, method, params: [1], amount: '0', ou: '10000' });
const sendParams = (amount = '1000') => ({ to: RECIPIENT, amount });

function events(page: PageTransport): WireEvent[] {
  const seen: WireEvent[] = [];
  page.onEvent((e) => seen.push(e));
  return seen;
}

const updatesFor = (seen: WireEvent[], rid: string) =>
  seen.filter((e) => e.type === 'requestUpdate' && (e.data as any)?.requestId === rid).map((e) => e.data as any);

export function defineConformanceSuite(target: ConformanceTarget): void {
  const f = target.features;
  const settleMs = target.settleTimeoutMs ?? 10_000;
  const statusPollMs = target.statusPollMs ?? 500;
  const localPollMs = 20;
  const when = (ok: boolean | undefined) => (ok ? it : it.skip);
  let w: ConformanceAdapter;

  const until = async (cond: () => boolean | Promise<boolean>, what: string, everyMs = localPollMs) => {
    const end = Date.now() + settleMs;
    for (;;) {
      if (await cond()) return;
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, everyMs));
    }
  };
  const status = async (page: PageTransport, rid: string): Promise<any> => {
    const reply = await page.send(wire('request_status', { rid }));
    expect(reply.success).toBe(true);
    return reply.data;
  };
  const onScreen = (rid: string) => until(async () => (await w.reviewOnScreen()) === rid, `review ${rid} on screen`);
  const statusIs = (page: PageTransport, rid: string, s: RequestStatusValue) =>
    until(async () => (await status(page, rid)).status === s, `${rid} to be ${s}`, statusPollMs);
  const connect = async (page: PageTransport): Promise<string> => {
    const rid = newRequestId();
    const reply = page.send(wire('connect', { permissions: ['accounts'] }, { rid }));
    await onScreen(rid);
    await w.approve(rid);
    const answer = await reply;
    expect(answer.success).toBe(true);
    return (answer.data as any).address as string;
  };
  const refusedWithoutReview = async (page: PageTransport, method: string, params: unknown, code = 'INVALID_PARAMS') => {
    const before = await w.stats();
    const rid = newRequestId();
    const reply = await page.send(wire(method, params, { rid }));
    expect(reply.success).toBe(false);
    expect(reply.error?.code).toBe(code);
    expect(await w.reviewOnScreen()).toBeNull();
    expect(await w.stats()).toEqual(before);
  };
  const reviewedToConfirmed = async (page: PageTransport, method: string, params: unknown) => {
    const rid = newRequestId();
    const reply = page.send(wire(method, params, { rid }));
    await onScreen(rid);
    await w.approve(rid);
    expect((await reply).success).toBe(true);
    const s = await status(page, rid);
    expect(s.status).toBe('submitted');
    expect(typeof s.hash).toBe('string');
    await w.confirmOnChain!(s.hash);
    await statusIs(page, rid, 'confirmed');
  };
  const submitted = async (page: PageTransport, method = 'call_contract', params: unknown = callParams()) => {
    const rid = newRequestId();
    const reply = page.send(wire(method, params, { rid }));
    await onScreen(rid);
    await w.approve(rid);
    const answer = await reply;
    expect(answer.success).toBe(true);
    const hash = (await status(page, rid)).hash as string;
    return { rid, answer, hash };
  };

  describe(`wallet protocol 2: ${target.name}`, () => {
    beforeEach(async () => {
      w = await target.create();
    });
    afterEach(async () => {
      await w.dispose();
    });

    describe('wallet_hello', () => {
      it('answers protocol 2, a known kind and the capabilities, to a page that is not connected', async () => {
        const page = await w.openPage(SITE);
        const reply = await page.send(wire('wallet_hello', { sdk: '2.12.0', protocols: [1, 2] }));
        expect(reply.success).toBe(true);
        const hello = reply.data as any;
        expect(hello.protocol).toBe(2);
        expect(CONFORMANCE_KINDS).toContain(hello.kind);
        const required = WALLET_CAPABILITIES.filter((c) => c !== 'announce' || hello.kind !== 'desktop');
        for (const c of required) expect(hello.capabilities).toContain(c);
      });

      it('carries no user state', async () => {
        const page = await w.openPage(SITE);
        await connect(page);
        const hello = (await page.send(wire('wallet_hello', { sdk: '2.12.0', protocols: [1, 2] }))).data as any;
        for (const key of Object.keys(hello)) {
          expect(['protocol', 'kind', 'version', 'capabilities', 'name']).toContain(key);
        }
        expect(JSON.stringify(hello)).not.toMatch(/oct[0-9A-Za-z]{44}/);
      });
    });

    describe('request ids', () => {
      it('puts the id on every answer of a request that carried one', async () => {
        const page = await w.openPage(SITE);
        const rid = newRequestId();
        const reply = page.send(wire('connect', {}, { rid }));
        await onScreen(rid);
        await w.reject(rid);
        expect((await reply).rid).toBe(rid);
      });

      it('puts rid and status at the top of an error answer and again in error.details', async () => {
        const page = await w.openPage(SITE);
        const rid = newRequestId();
        const reply = page.send(wire('connect', {}, { rid }));
        await onScreen(rid);
        await w.reject(rid);
        const answer = await reply;
        expect(answer.success).toBe(false);
        expect(answer.error?.code).toBe('USER_REJECTED');
        expect(answer.rid).toBe(rid);
        expect(answer.status).toBe('rejected');
        expect(answer.error?.details).toEqual({ requestId: rid, status: 'rejected' });
      });

      it('puts the id on a success answer too', async () => {
        const page = await w.openPage(SITE);
        const rid = newRequestId();
        const reply = page.send(wire('connect', {}, { rid }));
        await onScreen(rid);
        await w.approve(rid);
        const answer = await reply;
        expect(answer.success).toBe(true);
        expect(answer.rid).toBe(rid);
      });

      it.each(['ABCDEF0123456789ABCDEF0123456789', 'short', '0'.repeat(33), 'g'.repeat(32)])(
        'refuses the malformed id %s with INVALID_PARAMS and opens no review',
        async (bad) => {
          const page = await w.openPage(SITE);
          const before = await w.stats();
          const reply = await page.send(wire('connect', {}, { rid: bad }));
          expect(reply.success).toBe(false);
          expect(reply.error?.code).toBe('INVALID_PARAMS');
          expect((await w.stats()).reviewsOpened).toBe(before.reviewsOpened);
        }
      );

      it('answers unknown for an id it never saw, and INVALID_PARAMS for a malformed one', async () => {
        const page = await w.openPage(SITE);
        expect((await status(page, newRequestId())).status).toBe('unknown');
        const bad = await page.send(wire('request_status', { rid: 'nope' }));
        expect(bad.error?.code).toBe('INVALID_PARAMS');
      });
    });

    describe('idempotency', () => {
      it('joins a repeat of the same request in review: one review, one signature, the same answer', async () => {
        const page = await w.openPage(SITE);
        await connect(page);
        const before = await w.stats();
        const rid = newRequestId();
        const first = page.send(wire('call_contract', callParams(), { rid }));
        await onScreen(rid);
        const second = page.send(wire('call_contract', callParams(), { rid }));
        await w.approve(rid);
        const [a, b] = await Promise.all([first, second]);
        expect(a.success && b.success).toBe(true);
        expect((a.data as any).hash).toBe((b.data as any).hash);
        const after = await w.stats();
        expect(after.reviewsOpened - before.reviewsOpened).toBe(1);
        expect(after.signatures - before.signatures).toBe(1);
      });

      it('joins from another tab of the same origin', async () => {
        const tab1 = await w.openPage(SITE);
        await connect(tab1);
        const tab2 = await w.openPage(SITE);
        const before = await w.stats();
        const rid = newRequestId();
        const first = tab1.send(wire('send_transaction', sendParams(), { rid }));
        await onScreen(rid);
        const second = tab2.send(wire('send_transaction', sendParams(), { rid }));
        await w.approve(rid);
        expect((await first).success && (await second).success).toBe(true);
        expect((await w.stats()).signatures - before.signatures).toBe(1);
      });

      it('refuses the same id with other params, method or network: REQUEST_ID_REUSED, no review', async () => {
        const page = await w.openPage(SITE);
        await connect(page);
        const rid = newRequestId();
        const first = page.send(wire('call_contract', callParams(), { rid }));
        await onScreen(rid);
        const before = await w.stats();
        for (const other of [
          wire('call_contract', callParams('withdraw'), { rid }),
          wire('send_transaction', sendParams(), { rid }),
          wire('call_contract', callParams(), { rid, network: 'devnet' }),
        ]) {
          const reply = await page.send(other);
          expect(reply.success).toBe(false);
          expect(reply.error?.code).toBe('REQUEST_ID_REUSED');
        }
        expect((await w.stats()).reviewsOpened).toBe(before.reviewsOpened);
        await w.approve(rid);
        await first;
      });

      it('answers a repeat after submitted with the stored hash, without signing again', async () => {
        const page = await w.openPage(SITE);
        await connect(page);
        const { rid, answer } = await submitted(page);
        const before = await w.stats();
        const again = await page.send(wire('call_contract', callParams(), { rid }));
        expect(again.success).toBe(true);
        expect((again.data as any).hash).toBe((answer.data as any).hash);
        expect(await w.stats()).toEqual(before);
      });

      it('answers a repeat after completed with the stored result', async () => {
        const page = await w.openPage(SITE);
        await connect(page);
        const rid = newRequestId();
        const first = page.send(wire('signMessage', { message: 'hello' }, { rid }));
        await onScreen(rid);
        await w.approve(rid);
        const a = await first;
        const before = await w.stats();
        const b = await page.send(wire('signMessage', { message: 'hello' }, { rid }));
        expect(b.data).toEqual(a.data);
        expect(await w.stats()).toEqual(before);
      });

      it('never runs a rejected request again: the stored error, no new review', async () => {
        const page = await w.openPage(SITE);
        await connect(page);
        const rid = newRequestId();
        const first = page.send(wire('send_transaction', sendParams(), { rid }));
        await onScreen(rid);
        await w.reject(rid);
        expect((await first).error?.code).toBe('USER_REJECTED');
        const before = await w.stats();
        const again = await page.send(wire('send_transaction', sendParams(), { rid }));
        expect(again.success).toBe(false);
        expect(again.error?.code).toBe('USER_REJECTED');
        expect(await w.stats()).toEqual(before);
        expect(await w.reviewOnScreen()).toBeNull();
      });

      when(f.chain)('never runs a request that failed on chain again', async () => {
        const page = await w.openPage(SITE);
        await connect(page);
        const { rid, hash } = await submitted(page);
        await w.failOnChain!(hash, 'out of effort');
        await statusIs(page, rid, 'failed');
        const before = await w.stats();
        const again = await page.send(wire('call_contract', callParams(), { rid }));
        expect(again.success).toBe(false);
        expect(again.error?.code).toBe('EXECUTION_FAILED');
        expect(await w.stats()).toEqual(before);
      });

      it('refuses the id of a final request for a different request', async () => {
        const page = await w.openPage(SITE);
        await connect(page);
        const { rid } = await submitted(page);
        const reply = await page.send(wire('call_contract', callParams('withdraw'), { rid }));
        expect(reply.error?.code).toBe('REQUEST_ID_REUSED');
      });

      it('keeps ids per origin: another origin with the same id is a new request', async () => {
        const site = await w.openPage(SITE);
        const other = await w.openPage(OTHER);
        const rid = newRequestId();
        const a = site.send(wire('connect', {}, { rid }));
        await onScreen(rid);
        await w.approve(rid);
        await a;
        expect((await status(other, rid)).status).toBe('unknown');
        const b = other.send(wire('connect', { permissions: ['accounts'] }, { rid }));
        await onScreen(rid);
        expect((await status(other, rid)).status).toBe('review_open');
        await w.reject(rid);
        expect((await b).error?.code).toBe('USER_REJECTED');
        expect((await status(site, rid)).status).toBe('completed');
      });
    });

    describe('status transitions', () => {
      it('connect: pending, review_open, completed; seq grows; only allowed moves', async () => {
        const page = await w.openPage(SITE);
        const seen = events(page);
        const rid = newRequestId();
        const reply = page.send(wire('connect', {}, { rid }));
        await onScreen(rid);
        await w.approve(rid);
        await reply;
        await until(() => updatesFor(seen, rid).some((u) => u.status === 'completed'), 'completed event');
        const ups = updatesFor(seen, rid);
        expect(ups[ups.length - 1].status).toBe('completed');
        for (let i = 1; i < ups.length; i++) {
          expect(ups[i].seq).toBeGreaterThan(ups[i - 1].seq);
          if (ups[i].status !== ups[i - 1].status) {
            expect(REQUEST_STATUS_TRANSITIONS[ups[i - 1].status as RequestStatusValue]).toContain(ups[i].status);
          }
        }
      });

      when(f.chain)('contract call: signing, submitted with the hash, confirmed with epoch and receipt', async () => {
        const page = await w.openPage(SITE);
        await connect(page);
        const seen = events(page);
        const { rid, hash } = await submitted(page);
        expect(hash).toMatch(/^[0-9a-zA-Z]{8,128}$/);
        await w.confirmOnChain!(hash);
        await statusIs(page, rid, 'confirmed');
        const s = await status(page, rid);
        expect(typeof s.epoch).toBe('number');
        expect(s.receipt === null || typeof s.receipt.success === 'boolean').toBe(true);
        if (s.receipt === null) expect(['refused', 'error']).toContain(s.receiptUnavailable);
        await until(() => updatesFor(seen, rid).some((u) => u.status === 'confirmed'), 'confirmed event');
        const order = updatesFor(seen, rid).map((u) => u.status);
        expect(order.indexOf('signing')).toBeLessThan(order.indexOf('submitted'));
        expect(order.indexOf('submitted')).toBeLessThan(order.indexOf('confirmed'));
      });

      when(f.chain)('a dropped transaction ends failed at stage execution', async () => {
        const page = await w.openPage(SITE);
        await connect(page);
        const { rid, hash } = await submitted(page, 'send_transaction', sendParams());
        await w.dropOnChain!(hash);
        await statusIs(page, rid, 'failed');
        expect((await status(page, rid)).error.stage).toBe('execution');
      });

      when(f.chain)('a final state never changes', async () => {
        const page = await w.openPage(SITE);
        await connect(page);
        const { rid, hash } = await submitted(page);
        await w.confirmOnChain!(hash);
        await statusIs(page, rid, 'confirmed');
        const s = await status(page, rid);
        await w.failOnChain!(hash, 'late');
        const t = await status(page, rid);
        expect(t.status).toBe('confirmed');
        expect(t.seq).toBe(s.seq);
      });
    });

    describe('requests with nothing to review', () => {
      it('connect from a connected site completes at once: pending, then completed, no review', async () => {
        const page = await w.openPage(SITE);
        await connect(page);
        const seen = events(page);
        const before = await w.stats();
        const rid = newRequestId();
        const reply = await page.send(wire('connect', { permissions: ['accounts'] }, { rid }));
        expect(reply.success).toBe(true);
        expect((await status(page, rid)).status).toBe('completed');
        expect((await w.stats()).reviewsOpened).toBe(before.reviewsOpened);
        await until(() => updatesFor(seen, rid).some((u) => u.status === 'completed'), 'completed event');
        expect(updatesFor(seen, rid).map((u) => u.status)).not.toContain('review_open');
      });

      it('a switch to the current network completes without a review', async () => {
        const page = await w.openPage(SITE);
        await connect(page);
        const current = (await page.send(wire('get_network_info', {}))).data as any;
        const before = await w.stats();
        const rid = newRequestId();
        const reply = await page.send(wire('switch_network', { networkId: current.id }, { rid }));
        expect(reply.success).toBe(true);
        expect((await status(page, rid)).status).toBe('completed');
        expect((await w.stats()).reviewsOpened).toBe(before.reviewsOpened);
      });

    });

    describe('pre-signed transactions and key registration', () => {
      when(f.chain)('broadcast_only from the connected wallet goes pending to submitted with no review, then confirmed', async () => {
        const page = await w.openPage(SITE);
        const address = await connect(page);
        const before = await w.stats();
        const rid = newRequestId();
        const reply = await page.send(wire('broadcast_only', { signedTx: { from: address, signature: 'c2lnbmF0dXJl' } }, { rid }));
        expect(reply.success).toBe(true);
        const s = await status(page, rid);
        expect(s.status).toBe('submitted');
        expect(typeof s.hash).toBe('string');
        expect(await w.reviewOnScreen()).toBeNull();
        expect(await w.stats()).toEqual(before);
        await w.confirmOnChain!(s.hash);
        await statusIs(page, rid, 'confirmed');
      });

      it('refuses broadcast_only of a transaction from another wallet, without a review', async () => {
        const page = await w.openPage(SITE);
        await connect(page);
        await refusedWithoutReview(page, 'broadcast_only', { signedTx: { from: RECIPIENT, signature: 'c2lnbmF0dXJl' } });
      });

      it('register_private_view_key for another address is refused with INVALID_PARAMS, before any review', async () => {
        const page = await w.openPage(SITE);
        await connect(page);
        await refusedWithoutReview(page, 'register_private_view_key', { address: RECIPIENT });
      });

      when(f.account)('register_private_view_key for a registered account completes at once: no review, no signature', async () => {
        const page = await w.openPage(SITE);
        const address = await connect(page);
        await w.setAccount!({ registered: true, balanceRaw: '0', pendingRegistration: true });
        const before = await w.stats();
        const rid = newRequestId();
        const reply = await page.send(wire('register_private_view_key', { address }, { rid }));
        expect(reply.success).toBe(true);
        expect(reply.data).toMatchObject({ status: 'registered', view_pubkey: expect.any(String), pvac: true });
        const s = await status(page, rid);
        expect(s.status).toBe('completed');
        expect(s.hash).toBeUndefined();
        expect(await w.reviewOnScreen()).toBeNull();
        expect(await w.stats()).toEqual(before);
      });

      when(f.account && f.chain)('register_private_view_key for an unregistered account: one review with the fee, then submitted with a hash and confirmed', async () => {
        const page = await w.openPage(SITE);
        const address = await connect(page);
        await w.setAccount!({ registered: false, balanceRaw: '1000000000000' });
        const before = await w.stats();
        await reviewedToConfirmed(page, 'register_private_view_key', { address });
        const after = await w.stats();
        expect(after.reviewsOpened - before.reviewsOpened).toBe(1);
        expect(after.signatures - before.signatures).toBe(1);
      });

      when(f.account)('register_private_view_key with a balance below the fee is refused with INSUFFICIENT_BALANCE, before any review', async () => {
        const page = await w.openPage(SITE);
        const address = await connect(page);
        await w.setAccount!({ registered: false, balanceRaw: '0' });
        await refusedWithoutReview(page, 'register_private_view_key', { address }, 'INSUFFICIENT_BALANCE');
      });

      when(f.account)('register_private_view_key when another PVAC key is registered for the account is refused with PVAC_KEY_MISMATCH, before any review', async () => {
        const page = await w.openPage(SITE);
        const address = await connect(page);
        await w.setAccount!({ registered: false, balanceRaw: '1000000000000', foreignKey: true });
        await refusedWithoutReview(page, 'register_private_view_key', { address }, 'PVAC_KEY_MISMATCH');
      });

      when(f.account)('register_private_view_key while this wallet\'s registration is unconfirmed is refused with REGISTRATION_PENDING, before any review', async () => {
        const page = await w.openPage(SITE);
        const address = await connect(page);
        await w.setAccount!({ registered: false, balanceRaw: '1000000000000', pendingRegistration: true });
        await refusedWithoutReview(page, 'register_private_view_key', { address }, 'REGISTRATION_PENDING');
      });

      when(f.account && f.chain)('register_private_view_key again before the first one confirms is refused with REGISTRATION_PENDING', async () => {
        const page = await w.openPage(SITE);
        const address = await connect(page);
        await w.setAccount!({ registered: false, balanceRaw: '1000000000000' });
        const rid = newRequestId();
        const first = page.send(wire('register_private_view_key', { address }, { rid }));
        await onScreen(rid);
        await w.approve(rid);
        expect((await first).success).toBe(true);
        await refusedWithoutReview(page, 'register_private_view_key', { address }, 'REGISTRATION_PENDING');
      });
    });

    describe('events', () => {
      when(f.frames)('go only to the tab and frame that sent the request', async () => {
        const top = await w.openPage(SITE);
        await connect(top);
        const frame = await w.openPage(SITE, { tab: top, frame: 'child' });
        const otherTab = await w.openPage(SITE);
        const otherOrigin = await w.openPage(OTHER);
        const [fromTop, fromFrame, fromTab, fromOther] = [top, frame, otherTab, otherOrigin].map(events);
        const rid = newRequestId();
        const reply = frame.send(wire('send_transaction', sendParams(), { rid }));
        await onScreen(rid);
        await w.approve(rid);
        await reply;
        await until(() => updatesFor(fromFrame, rid).some((u) => u.status === 'submitted'), 'frame events');
        expect(updatesFor(fromTop, rid)).toHaveLength(0);
        expect(updatesFor(fromTab, rid)).toHaveLength(0);
        expect(fromOther.filter((e) => e.type === 'requestUpdate')).toHaveLength(0);
        expect((await status(otherTab, rid)).status).toBe('submitted');
        expect((await status(otherOrigin, rid)).status).toBe('unknown');
      });

      it('let a page that is not connected follow its own connect review', async () => {
        const page = await w.openPage(SITE);
        const seen = events(page);
        const rid = newRequestId();
        const reply = page.send(wire('connect', {}, { rid }));
        await onScreen(rid);
        await until(() => updatesFor(seen, rid).some((u) => u.status === 'review_open'), 'review_open event');
        await w.reject(rid);
        await reply;
      });

      it('are not sent for a request without an id (an SDK older than 2.12.0)', async () => {
        const page = await w.openPage(SITE);
        const seen = events(page);
        const reply = page.send({ id: `old-${++seq}`, method: 'connect', params: {}, timestamp: Date.now() });
        await until(async () => (await w.reviewOnScreen()) !== null, 'old request review');
        await w.approve();
        expect((await reply).success).toBe(true);
        expect(seen.filter((e) => e.type === 'requestUpdate')).toHaveLength(0);
      });
    });

    describe('sites that are not connected', () => {
      it('get NOT_CONNECTED for every non-public method, and public reads that carry no address', async () => {
        const owner = await w.openPage(OTHER);
        const address = await connect(owner);
        const before = await w.stats();
        const noLeak = (reply: WireReply) => {
          const json = JSON.stringify(reply);
          expect(json).not.toContain(address);
          expect(json).not.toMatch(/"(address|publicKey|public_key|balance|privateBalance)"/);
        };
        const chunks = async <T,>(items: readonly T[], run: (page: PageTransport, item: T) => Promise<void>) => {
          for (let i = 0; i < items.length; i += 8) {
            if (i > 0) await new Promise((r) => setTimeout(r, 1100));
            const page = await w.openPage(SITE);
            for (const item of items.slice(i, i + 8)) await run(page, item);
          }
        };
        const refused: ReadonlyArray<readonly [string, unknown]> = [
          ['getWalletInfo', {}],
          ['get_balance', {}],
          ['getBalance', {}],
          ['getAddress', {}],
          ['getPublicKey', {}],
          ['get_transaction_history', { page: 1, limit: 5 }],
          ['get_private_balance_info', {}],
          ['get_private_balance', {}],
          ['get_pending_private_transfers', {}],
          ['get_private_capabilities', {}],
          ['encrypt_value', { value_raw: '1' }],
          ['decrypt_value', { cipher: 'AA==' }],
          ['make_zero_proof', { cipher: 'AA==' }],
          ['make_range_proof', { cipher: 'AA==', value_raw: '1' }],
          ['signMessage', { message: 'hi' }],
          ['send_transaction', sendParams()],
          ['call_contract', callParams()],
        ];
        await chunks(refused, async (page, [method, params]) => {
          const reply = await page.send(wire(method, params, isLifecycleMethod(method) ? { rid: newRequestId() } : {}));
          expect(reply.success).toBe(false);
          expect(reply.error?.code).toBe('NOT_CONNECTED');
          noLeak(reply);
        });
        const answered: ReadonlyArray<readonly [string, unknown]> = [
          ['ping', {}],
          ['register_dapp', { appName: 'Conformance' }],
          ['getConnectionStatus', {}],
          ['get_network_info', {}],
          ['contract_call_view', { contract: CONTRACT, method: 'name', params: [] }],
          ['get_contract_storage', { contract: CONTRACT, key: 'name' }],
          ['rpc_call', { method: 'octra_transaction', params: ['0'.repeat(64)] }],
          ['wallet_hello', { sdk: '2.12.0', protocols: [1, 2] }],
          ['request_status', { rid: newRequestId() }],
          ['cancel_request', { rid: newRequestId() }],
          ['disconnect', {}],
        ];
        await chunks(answered, async (page, [method, params]) => {
          const reply = await page.send(wire(method, params));
          expect(reply.error?.code).not.toBe('NOT_CONNECTED');
          noLeak(reply);
        });
        expect(await w.reviewOnScreen()).toBeNull();
        expect(await w.stats()).toEqual(before);
      }, 30_000);
    });

    describe('locked wallet', () => {
      when(f.lock)('a site that is not connected sees review_open, never locked, and no address', async () => {
        await w.lock!();
        const page = await w.openPage(SITE);
        const seen = events(page);
        const rid = newRequestId();
        const reply = page.send(wire('connect', {}, { rid }));
        await onScreen(rid);
        const s = await status(page, rid);
        expect(s.status).toBe('review_open');
        expect(s.address).toBeUndefined();
        expect(s.network).toBeUndefined();
        expect(updatesFor(seen, rid).map((u) => u.status)).not.toContain('locked');
        await w.unlock!();
        await w.approve(rid);
        await reply;
        expect(updatesFor(seen, rid).map((u) => u.status)).not.toContain('locked');
      });

      when(f.lock)('a connected site sees locked, then review_open after unlock, and its signer', async () => {
        const page = await w.openPage(SITE);
        await connect(page);
        await w.lock!();
        const rid = newRequestId();
        const reply = page.send(wire('signMessage', { message: 'hi' }, { rid }));
        await onScreen(rid);
        const s = await status(page, rid);
        expect(s.status).toBe('locked');
        expect(typeof s.address).toBe('string');
        await w.unlock!();
        await statusIs(page, rid, 'review_open');
        await w.reject(rid);
        await reply;
      });

      when(f.lock)('while locked, a site that is not connected gets the same read answers and NOT_CONNECTED for reviews, with no review', async () => {
        const page = await w.openPage(SITE);
        const reads = async () => {
          const out: unknown[] = [];
          for (const [method, params] of [
            ['getConnectionStatus', {}],
            ['ping', {}],
            ['wallet_hello', { sdk: '2.12.0', protocols: [1, 2] }],
          ] as const) {
            const reply = await page.send(wire(method, params));
            out.push({ success: reply.success, data: reply.data, error: reply.error?.code });
          }
          return out;
        };
        const unlocked = await reads();
        await w.lock!();
        expect(await reads()).toEqual(unlocked);
        const before = await w.stats();
        for (const [method, params] of [
          ['signMessage', { message: 'hi' }],
          ['send_transaction', sendParams()],
        ] as const) {
          const reply = await page.send(wire(method, params, { rid: newRequestId() }));
          expect(reply.success).toBe(false);
          expect(reply.error?.code).toBe('NOT_CONNECTED');
        }
        expect(await w.reviewOnScreen()).toBeNull();
        expect(await w.stats()).toEqual(before);
        await w.unlock!();
      });

      when(f.lock)('a stranger\'s connect made while locked keeps its seq and updatedAt across unlock; a connected site goes locked to review_open', async () => {
        const site = await w.openPage(SITE);
        await connect(site);
        await w.lock!();
        const stranger = await w.openPage(OTHER);
        const seen = events(stranger);
        const rid = newRequestId();
        const reply = stranger.send(wire('connect', {}, { rid }));
        await onScreen(rid);
        const held = await status(stranger, rid);
        expect(held.status).toBe('review_open');
        const heard = updatesFor(seen, rid).length;
        await w.unlock!();
        await new Promise((r) => setTimeout(r, statusPollMs));
        const after = await status(stranger, rid);
        expect(after.status).toBe('review_open');
        expect(after.seq).toBe(held.seq);
        expect(after.updatedAt).toBe(held.updatedAt);
        expect(updatesFor(seen, rid)).toHaveLength(heard);
        expect(updatesFor(seen, rid).map((u) => u.status)).not.toContain('locked');
        await w.reject(rid);
        await reply;

        await w.lock!();
        const own = newRequestId();
        const ownReply = site.send(wire('signMessage', { message: 'mine' }, { rid: own }));
        await onScreen(own);
        expect((await status(site, own)).status).toBe('locked');
        await w.unlock!();
        await statusIs(site, own, 'review_open');
        await w.reject(own);
        await ownReply;
      });
    });

    describe('timeouts', () => {
      when(f.clock)('a page that stops waiting never cancels the review; the outcome is kept', async () => {
        const page = await w.openPage(SITE);
        await connect(page);
        const rid = newRequestId();
        void page.send(wire('call_contract', callParams(), { rid }));
        await onScreen(rid);
        await w.advance!(4 * 60_000);
        expect((await status(page, rid)).status).toBe('review_open');
        await w.approve(rid);
        await statusIs(page, rid, 'submitted');
        expect((await w.stats()).signatures).toBeGreaterThanOrEqual(1);
      });

      when(f.clock)('the review window is 5 minutes: then expired, USER_REJECTED with status expired', async () => {
        const page = await w.openPage(SITE);
        await connect(page);
        const before = await w.stats();
        const rid = newRequestId();
        const reply = page.send(wire('send_transaction', sendParams(), { rid }));
        await onScreen(rid);
        await w.advance!(LIFECYCLE_LIMITS.reviewWindowMs - 1000);
        expect((await status(page, rid)).status).toBe('review_open');
        await w.advance!(2000);
        const answer: WireReply = await reply;
        expect(answer.error?.code).toBe('USER_REJECTED');
        expect(answer.status).toBe('expired');
        expect(answer.error?.details).toEqual({ requestId: rid, status: 'expired' });
        expect((await status(page, rid)).status).toBe('expired');
        const again = await page.send(wire('send_transaction', sendParams(), { rid }));
        expect(again.status).toBe('expired');
        const after = await w.stats();
        expect(after.signatures).toBe(before.signatures);
        expect(after.reviewsOpened - before.reviewsOpened).toBe(1);
      });

      when(f.clock)('keeps a final record 24 hours, then answers unknown', async () => {
        const page = await w.openPage(SITE);
        await connect(page);
        const { rid } = await submitted(page, 'signMessage', { message: 'kept' });
        await w.advance!(LIFECYCLE_LIMITS.recordTtlMs - 60_000);
        expect((await status(page, rid)).status).toBe('completed');
        await w.advance!(120_000);
        expect((await status(page, rid)).status).toBe('unknown');
      });

      when(f.clock && f.chain)('stops watching after 10 minutes and says so', async () => {
        const page = await w.openPage(SITE);
        await connect(page);
        const { rid } = await submitted(page);
        await w.advance!(LIFECYCLE_LIMITS.watchForMs + 1000);
        const s = await status(page, rid);
        expect(s.status).toBe('submitted');
        expect(s.watching).toBe(false);
      });
    });

    describe('limits', () => {
      it('answers RATE_LIMITED over 20 requests a second, and never drops one', async () => {
        const page = await w.openPage(SITE);
        const replies = await Promise.all(Array.from({ length: 30 }, () => page.send(wire('ping', {}))));
        expect(replies).toHaveLength(30);
        expect(replies.some((r) => r.error?.code === 'RATE_LIMITED')).toBe(true);
        expect(replies.filter((r) => r.success).length).toBeLessThanOrEqual(LIFECYCLE_LIMITS.requestsPerSecond);
      });

      when(f.clock)('refuses an open request over the site cap (8, or the lower cap the wallet declares) with RATE_LIMIT_EXCEEDED', async () => {
        const cap = f.openRequestCap ?? LIFECYCLE_LIMITS.openPerOrigin;
        expect(cap).toBeGreaterThan(0);
        expect(cap).toBeLessThanOrEqual(LIFECYCLE_LIMITS.openPerOrigin);
        const page = await w.openPage(SITE);
        await connect(page);
        await w.advance!(2000);
        const seen = events(page);
        const open = Array.from({ length: cap }, (_, i) => {
          const rid = newRequestId();
          return { rid, reply: page.send(wire('signMessage', { message: `m${i}` }, { rid })) };
        });
        await until(() => open.every((o) => updatesFor(seen, o.rid).length > 0), 'every open request recorded');
        const extra = await page.send(wire('signMessage', { message: 'one more' }, { rid: newRequestId() }));
        expect(extra.error?.code).toBe('RATE_LIMIT_EXCEEDED');
        for (let i = 0; i < cap; i++) {
          await until(async () => (await w.reviewOnScreen()) !== null, 'next review on screen');
          await w.reject((await w.reviewOnScreen())!);
        }
        await Promise.all(open.map((o) => o.reply));
      }, 30_000);
    });

    describe('page close', () => {
      it('closes an unanswered review: rejected, nothing signed', async () => {
        const page = await w.openPage(SITE);
        await connect(page);
        const before = await w.stats();
        const rid = newRequestId();
        void page.send(wire('send_transaction', sendParams(), { rid })).catch(() => {});
        await onScreen(rid);
        await page.close();
        const next = await w.openPage(SITE);
        await statusIs(next, rid, 'rejected');
        expect(await w.reviewOnScreen()).not.toBe(rid);
        expect((await w.stats()).signatures).toBe(before.signatures);
      });

      it('finishes an approved request and keeps the outcome for the reloaded page', async () => {
        const page = await w.openPage(SITE);
        await connect(page);
        const before = await w.stats();
        const rid = newRequestId();
        void page.send(wire('call_contract', callParams(), { rid })).catch(() => {});
        await onScreen(rid);
        await w.approve(rid);
        await page.close();
        const reloaded = await w.openPage(SITE);
        await until(async () => ['submitted', 'confirmed'].includes((await status(reloaded, rid)).status), 'outcome kept', statusPollMs);
        const again = await reloaded.send(wire('call_contract', callParams(), { rid }));
        expect(again.success).toBe(true);
        expect((await w.stats()).signatures - before.signatures).toBe(1);
      });
    });

    describe('cancel_request', () => {
      it('closes a review that was not approved, and refuses nothing once approved', async () => {
        const page = await w.openPage(SITE);
        await connect(page);
        const rid = newRequestId();
        const reply = page.send(wire('send_transaction', sendParams(), { rid }));
        await onScreen(rid);
        const cancelled = await page.send(wire('cancel_request', { rid }));
        expect((cancelled.data as any).status).toBe('rejected');
        expect((await reply).error?.code).toBe('USER_REJECTED');

        const { rid: done } = await submitted(page);
        const late = await page.send(wire('cancel_request', { rid: done }));
        expect(isFinalStatus((late.data as any).status) || (late.data as any).status === 'submitted').toBe(true);
        expect((late.data as any).status).not.toBe('rejected');
      });
    });
  });
}
