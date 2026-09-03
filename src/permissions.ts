import type { Permission } from './types';

/** Scope names the 0xio wallet enforces. Any other name is dropped at connect. */
export const WALLET_PERMISSIONS = [
  'accounts',
  'public_transactions',
  'contract_calls',
  'contract_views',
  'private_balance_read',
  'private_proofs',
  'private_transfers',
  'private_claims',
] as const;
export type WalletPermission = (typeof WALLET_PERMISSIONS)[number];

/** Older SDK permission names and the wallet scope each one means. */
export const LEGACY_PERMISSION_MAP: Record<string, WalletPermission> = {
  read_address: 'accounts',
  read_balance: 'accounts',
  read_public_key: 'accounts',
  send_transactions: 'public_transactions',
  sign_messages: 'public_transactions',
  contract_calls: 'contract_calls',
  view_private_balance: 'private_balance_read',
  view_encrypted_balance: 'private_balance_read',
  stealth_scan: 'private_balance_read',
  decrypt_balance: 'private_balance_read',
  encrypt_balance: 'private_proofs',
  private_transfers: 'private_transfers',
  stealth_claim: 'private_claims',
};

/** Translate any mix of old and new names into the wallet's scope names, without duplicates. */
export function toWalletPermissions(perms: readonly string[] | undefined): WalletPermission[] {
  const out: WalletPermission[] = [];
  for (const p of perms ?? []) {
    const canonical = (WALLET_PERMISSIONS as readonly string[]).includes(p)
      ? (p as WalletPermission)
      : LEGACY_PERMISSION_MAP[p];
    if (canonical && !out.includes(canonical)) out.push(canonical);
  }
  return out;
}

/**
 * The granted wallet scopes plus every requested old name they satisfy, so a dapp that checks
 * for the name it asked for (for example 'read_balance') keeps seeing it.
 */
export function withLegacyAliases(
  granted: readonly string[] | undefined,
  requested: readonly string[] | undefined
): Permission[] {
  const set = new Set<string>(granted ?? []);
  for (const p of requested ?? []) {
    const canonical = LEGACY_PERMISSION_MAP[p];
    if (canonical && set.has(canonical)) set.add(p);
  }
  return [...set] as Permission[];
}
