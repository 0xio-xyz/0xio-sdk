import { DesktopPresence, DetectOptions, DetectResult, WalletKind, WalletProtocolVersion } from './types';
import { canUseDesktopTransport, localNetworkPermission, probeDesktop } from './desktop';
import {
  DEFAULT_DETECT_TIMEOUT_MS,
  onWalletSignal,
  openInAppUrl,
  requestWalletAnnounce,
  walletSignals,
} from './lifecycle';

type Injected = DetectResult['injected'];

/** iPadOS reports a Mac with touch points. */
export function isMobileBrowser(): boolean {
  const nav = (globalThis as any).navigator;
  if (!nav) return false;
  if (typeof nav.userAgentData?.mobile === 'boolean' && nav.userAgentData.mobile) return true;
  const ua = typeof nav.userAgent === 'string' ? nav.userAgent : '';
  if (/Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua)) return true;
  return /Macintosh/.test(ua) && typeof nav.maxTouchPoints === 'number' && nav.maxTouchPoints > 1;
}

function injectedNow(): Injected {
  const { announce, readyVersion } = walletSignals();
  if (announce) {
    return {
      kind: announce.kind,
      ...(announce.version ? { version: announce.version } : {}),
      protocol: announce.protocol,
    };
  }
  if (typeof window === 'undefined') return null;
  const win = window as any;
  if (win.wallet0xio || win.ZeroXIOWallet) {
    const kind: WalletKind = win.ReactNativeWebView ? 'app-expo' : 'extension';
    return { kind, ...(readyVersion ? { version: readyVersion } : {}), protocol: 1 as WalletProtocolVersion };
  }
  return null;
}

async function detectInjected(timeoutMs: number): Promise<Injected> {
  if (typeof window === 'undefined') return null;
  walletSignals();
  requestWalletAnnounce();
  const now = injectedNow();
  if (now) return now;
  const found = await new Promise<Injected>((resolve) => {
    let settled = false;
    const finish = (value: Injected) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      unsubscribe();
      resolve(value);
    };
    const check = () => {
      const seen = injectedNow();
      if (seen) finish(seen);
    };
    const unsubscribe = onWalletSignal(check);
    const poll = setInterval(check, 50);
    const timer = setTimeout(() => finish(null), timeoutMs);
  });
  if (found) return found;
  return (window as any).ReactNativeWebView ? { kind: 'app-expo', protocol: 1 } : null;
}

async function detectDesktop(allowed: boolean, mobile: boolean): Promise<DesktopPresence> {
  if (!allowed || mobile || !canUseDesktopTransport()) return 'not-allowed';
  const permission = await localNetworkPermission();
  if (permission === 'denied') return 'blocked';
  // Any probe while the browser would prompt shows that prompt to every visitor.
  if (permission === 'prompt') return 'unknown-until-connect';
  const probe = await probeDesktop();
  return probe.running ? 'available' : 'not-running';
}

/** Needs no `initialize()` and never shows a browser prompt. */
export async function detectWallet(options: DetectOptions = {}): Promise<DetectResult> {
  const timeoutMs = Math.min(Math.max(options.detectTimeoutMs ?? DEFAULT_DETECT_TIMEOUT_MS, 0), 10000);
  const mobile = isMobileBrowser();
  const [injected, desktop] = await Promise.all([
    detectInjected(timeoutMs),
    detectDesktop(options.desktop !== false, mobile),
  ]);
  const link = mobile && !injected ? openInAppUrl() : null;
  const next: DetectResult['next'] =
    injected || desktop === 'available' || desktop === 'unknown-until-connect'
      ? 'connect'
      : link
        ? 'open-in-app'
        : 'install';
  return Object.freeze({ injected, desktop, mobile, openInAppUrl: link, next });
}
