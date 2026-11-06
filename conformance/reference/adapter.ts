import type { ConformanceAdapter, PageTransport } from '../harness';
import { ManualClock } from './clock';
import { ReferencePage, ReferenceWallet, ReferenceWalletOptions } from './referenceWallet';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

export function createReferenceAdapter(options: Omit<ReferenceWalletOptions, 'clock'> = {}): ConformanceAdapter & {
  wallet: ReferenceWallet;
} {
  const clock = new ManualClock();
  const wallet = new ReferenceWallet({ ...options, clock });
  return {
    name: `reference wallet (protocol ${wallet.protocol})`,
    wallet,
    features: { clock: true, chain: true, lock: true, frames: true, account: true },
    async openPage(origin, opts = {}) {
      const tab = opts.tab as unknown as ReferencePage | undefined;
      return wallet.openPage(origin, { tab, frame: opts.frame }) as PageTransport;
    },
    async approve(requestId) {
      await wallet.approve(requestId);
      await flush();
    },
    async reject(requestId) {
      await wallet.reject(requestId);
      await flush();
    },
    async reviewOnScreen() {
      return wallet.reviewOnScreen();
    },
    async lock() {
      wallet.lock();
    },
    async unlock() {
      wallet.unlock();
      await flush();
    },
    async confirmOnChain(hash) {
      wallet.confirmOnChain(hash);
      await flush();
    },
    async failOnChain(hash, reason) {
      wallet.failOnChain(hash, reason);
      await flush();
    },
    async dropOnChain(hash) {
      wallet.dropOnChain(hash);
      await flush();
    },
    async setAccount({ registered, balanceRaw, foreignKey = false, pendingRegistration = false }) {
      wallet.registered = registered;
      wallet.balanceRaw = BigInt(balanceRaw);
      wallet.foreignKey = foreignKey;
      wallet.pendingRegistration = pendingRegistration;
    },
    async advance(ms) {
      clock.advance(ms);
      await flush();
    },
    async stats() {
      return { signatures: wallet.signatures, reviewsOpened: wallet.reviewsOpened };
    },
    async dispose() {},
  };
}
