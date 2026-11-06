import { ReferenceWallet, ReferenceWalletOptions } from './referenceWallet';

/** Every request opens its own review, even with an id it saw before. */
export function createLegacyWallet(options: Omit<ReferenceWalletOptions, 'protocol'> = {}): ReferenceWallet {
  return new ReferenceWallet({ ...options, protocol: 1 });
}
