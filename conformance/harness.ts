import type { RequestStatusValue, WalletKind } from '../src/types';

export interface WireRequest {
  readonly id: string;
  readonly method: string;
  readonly params: unknown;
  readonly timestamp: number;
  /** Absent from SDKs older than 2.12.0. */
  readonly v?: 2;
  /** Review methods only. */
  readonly rid?: string;
  /** Only on channels that carry one (0xio Desktop frames). */
  readonly network?: string;
}

export interface WireReply {
  readonly id: string;
  readonly success: boolean;
  readonly data?: unknown;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly status?: RequestStatusValue;
    readonly details?: { readonly requestId?: string; readonly status?: RequestStatusValue };
  };
  readonly rid?: string;
  /** On error answers, also in `error.details.status`. */
  readonly status?: RequestStatusValue;
}

export interface WireEvent {
  readonly type: string;
  readonly data: unknown;
}

export interface PageTransport {
  readonly origin: string;
  readonly frame: string;
  send(request: WireRequest): Promise<WireReply>;
  onEvent(listener: (event: WireEvent) => void): () => void;
  /** Pagehide, tab closed or navigation. */
  close(): Promise<void>;
}

/** A test that needs a missing feature is skipped, never passed. */
export interface ConformanceFeatures {
  readonly clock?: boolean;
  readonly chain?: boolean;
  readonly lock?: boolean;
  readonly frames?: boolean;
  /** The wallet's cap of open requests per site, at most 8 (0xio Desktop keeps 3). Default 8. */
  readonly openRequestCap?: number;
  /** `setAccount()` sets the connected account's registration and balance. */
  readonly account?: boolean;
}

export interface ConformanceAdapter {
  readonly name: string;
  readonly features: ConformanceFeatures;
  /** A new tab unless `frame` names a frame of `tab`. */
  openPage(origin: string, options?: { tab?: PageTransport; frame?: string }): Promise<PageTransport>;
  approve(requestId?: string): Promise<void>;
  reject(requestId?: string): Promise<void>;
  reviewOnScreen(): Promise<string | null>;
  lock?(): Promise<void>;
  unlock?(): Promise<void>;
  confirmOnChain?(hash: string): Promise<void>;
  failOnChain?(hash: string, reason: string): Promise<void>;
  dropOnChain?(hash: string): Promise<void>;
  advance?(ms: number): Promise<void>;
  /**
   * `registered`: the view key is on chain and this wallet's PVAC key is confirmed. `foreignKey`:
   * another PVAC key is registered for the account. `pendingRegistration`: this wallet's
   * registration is submitted and not yet confirmed.
   */
  setAccount?(account: { registered: boolean; balanceRaw: string; foreignKey?: boolean; pendingRegistration?: boolean }): Promise<void>;
  /** Counts since the adapter was made. */
  stats(): Promise<{ signatures: number; reviewsOpened: number }>;
  dispose(): Promise<void>;
}

export const CONFORMANCE_KINDS: readonly WalletKind[] = ['extension', 'desktop', 'app-ios', 'app-android', 'app-expo'];
