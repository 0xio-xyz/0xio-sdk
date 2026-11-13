import { isValidAddress } from '../utils';

export const ONS_SUFFIX = '.oct';

/** The name service list in the token-lists repo: one contract per network. @since 2.12.2 */
export const ONS_LIST_URL = 'https://raw.githubusercontent.com/0xio-xyz/Token-lists/main/octra.namelist.json';

const LIST_TTL_MS = 10 * 60_000;
const SERVICE_NAME = 'Octra Name System';
const SERVICE_SYMBOL = 'ONS';
const INTERFACES = ['6'];

let listed: { at: number; byNetwork: Record<string, string> } | null = null;
let loading: Promise<Record<string, string>> | null = null;

/** What a name points to. `wallet` is set for kind `wallet`, `circle` for kind `circle`. @since 2.12.2 */
export interface ResolvedName {
  readonly name: string;
  readonly kind: 'none' | 'wallet' | 'circle';
  readonly wallet: string | null;
  readonly circle: string | null;
}

export function parseNameList(list: unknown): Record<string, string> {
  const services = (list as { services?: unknown } | null)?.services;
  if (!Array.isArray(services)) throw new Error('Name list could not be read');
  const byNetwork: Record<string, string> = Object.create(null);
  const seen = new Set<string>();
  for (const entry of services) {
    const { network, address, suffix } = (entry ?? {}) as Record<string, unknown>;
    if (typeof network !== 'string' || !/^[a-z0-9-]{1,32}$/.test(network) || suffix !== ONS_SUFFIX) continue;
    if (seen.has(network)) {
      delete byNetwork[network];
      continue;
    }
    seen.add(network);
    if (typeof address === 'string' && isValidAddress(address)) byNetwork[network] = address;
  }
  return byNetwork;
}

async function loadNameList(): Promise<Record<string, string>> {
  const response = await fetch(ONS_LIST_URL, { cache: 'no-store', credentials: 'omit' });
  if (!response.ok) throw new Error('Name list could not be read');
  return parseNameList(await response.json());
}

/**
 * The name service contract listed for a network, or null where none is listed. Read from
 * `ONS_LIST_URL`, kept for ten minutes, and the last list read is used when it cannot be reached.
 * @since 2.12.2
 */
export async function onsContract(networkId: string): Promise<string | null> {
  if (!listed || Date.now() - listed.at >= LIST_TTL_MS) {
    loading ??= loadNameList().finally(() => {
      loading = null;
    });
    try {
      listed = { at: Date.now(), byNetwork: await loading };
    } catch {
      if (!listed) return null;
    }
  }
  return listed.byNetwork[networkId] ?? null;
}

export function forgetNameList(): void {
  listed = null;
  loading = null;
}

export function isNameService(reply: unknown): boolean | undefined {
  const text = viewText(reply);
  if (text === null) return undefined;
  const fields = text.split('|');
  return (
    fields.length === 5 &&
    fields[0] === SERVICE_NAME &&
    fields[1] === SERVICE_SYMBOL &&
    INTERFACES.includes(fields[4])
  );
}

/** The bare name (`0xio` for `0xio.oct` or `0xio`), or null when it is not a valid name. @since 2.12.2 */
export function normalizeOnsName(input: string): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, '').replace(/[A-Z]/g, (c) => c.toLowerCase());
  const bare = trimmed.endsWith(ONS_SUFFIX) ? trimmed.slice(0, -ONS_SUFFIX.length) : trimmed;
  return /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(bare) ? bare : null;
}

/** Text is a name only when it ends in `.oct` and passes the name rules. @since 2.12.2 */
export function isOnsName(text: string): boolean {
  return typeof text === 'string' && text.trim().toLowerCase().endsWith(ONS_SUFFIX) && normalizeOnsName(text) !== null;
}

export function viewText(reply: unknown): string | null {
  let value = reply;
  for (let depth = 0; depth < 4; depth++) {
    if (typeof value === 'string') return value;
    if (value === null || typeof value !== 'object') return null;
    value = (value as { result?: unknown }).result;
  }
  return null;
}

export function parsePrimaryName(reply: unknown): string | null | undefined {
  const text = viewText(reply);
  if (text === null) return undefined;
  if (text === '') return null;
  const name = normalizeOnsName(text);
  return name !== null && name === text ? `${name}${ONS_SUFFIX}` : undefined;
}

export function parseResolved(name: string, reply: unknown): ResolvedName | undefined {
  const text = viewText(reply);
  if (text === null) return undefined;
  const full = `${name}${ONS_SUFFIX}`;
  if (text === '0|') return { name: full, kind: 'none', wallet: null, circle: null };
  const target = text.slice(2);
  if (!isValidAddress(target)) return undefined;
  if (text.startsWith('1|')) return { name: full, kind: 'circle', wallet: null, circle: target };
  if (text.startsWith('2|')) return { name: full, kind: 'wallet', wallet: target, circle: null };
  return undefined;
}
