/**
 * The wallet signs `"Octra Signed Message:\n" + utf8ByteLength(message) + "\n" + message`, never the
 * raw message: a transaction is canonical JSON starting with '{', so a signed message can never be one.
 */

export const SIGNED_MESSAGE_PREFIX = 'Octra Signed Message:';

/** Bumped if the framing ever changes. */
export const SIGNED_MESSAGE_VERSION = 1;

function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The exact bytes `wallet.signMessage(message)` signs, for any Ed25519 verifier. */
export function getSignedMessageBytes(message: string): Uint8Array {
  if (typeof message !== 'string') {
    throw new TypeError('message must be a string');
  }
  const framed = `${SIGNED_MESSAGE_PREFIX}\n${utf8ByteLength(message)}\n${message}`;
  return new TextEncoder().encode(framed);
}

/** The message `wallet.signAuthMessage(service, nonce)` signs on the page `origin`. */
export function buildAuthMessage(service: string, nonce: string, origin: string): string {
  return `0xio auth\nService: ${service}\nNonce: ${nonce}\nOrigin: ${origin}`;
}

/**
 * Verifies a `wallet.signMessage` signature with Web Crypto Ed25519 (Node 18+, Chrome 137+,
 * Safari 17+, Firefox 129+); elsewhere verify `getSignedMessageBytes(message)` yourself.
 *
 * @param message   The message passed to `wallet.signMessage`
 * @param signature Base64 Ed25519 signature
 * @param publicKey Base64 Ed25519 public key of the signer
 * @returns         Whether the signature is valid for this message and key
 */
export async function verifyMessage(
  message: string,
  signature: string,
  publicKey: string,
): Promise<boolean> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error(
      'Web Crypto API unavailable; verify getSignedMessageBytes(message) with your own Ed25519 library',
    );
  }
  let sigBytes: Uint8Array<ArrayBuffer>;
  let pubBytes: Uint8Array<ArrayBuffer>;
  try {
    sigBytes = base64ToBytes(signature);
    pubBytes = base64ToBytes(publicKey);
  } catch {
    return false;
  }
  try {
    const data = new Uint8Array(getSignedMessageBytes(message));
    const key = await crypto.subtle.importKey('raw', pubBytes, { name: 'Ed25519' }, false, [
      'verify',
    ]);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, sigBytes, data);
  } catch {
    // importKey and verify throw, not return false, on malformed input or partial Ed25519 support
    return false;
  }
}
