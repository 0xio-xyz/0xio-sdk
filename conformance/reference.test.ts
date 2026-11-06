import { defineConformanceSuite } from './suite';
import { createReferenceAdapter } from './reference/adapter';

defineConformanceSuite({
  name: 'reference wallet',
  features: { clock: true, chain: true, lock: true, frames: true, account: true },
  create: () => createReferenceAdapter(),
});

defineConformanceSuite({
  name: 'reference wallet, 3 open requests per site',
  features: { clock: true, chain: true, lock: true, frames: true, openRequestCap: 3, account: true },
  create: () => createReferenceAdapter({ openRequestCap: 3 }),
});

defineConformanceSuite({
  name: 'reference wallet, node refuses receipts',
  features: { clock: true, chain: true, lock: true, frames: true, account: true },
  create: () => createReferenceAdapter({ refuseReceipts: true }),
});
