/**
 * 0xio Signed Message standard (v1).
 *
 * `wallet.signMessage(message)` never signs the raw message. The wallet frames it first so a signed
 * "message" can never collide with a transaction pre-image (a transaction is canonical JSON that
 * begins with '{'). The framing is:
 *
 *     "Octra Signed Message:\n" + utf8ByteLength(message) + "\n" + message
 *
 * signed as an Ed25519 detached signature over the UTF-8 bytes of that string. The leading 'O'
 * guarantees the signed bytes never begin with '{', so a personal-message signature can never be a
 * valid transaction. Any verifier MUST reconstruct the same bytes: use `getSignedMessageBytes()`
 * with any Ed25519 library, or `verifyMessage()` for a batteries-included check.
 */

/** Fixed prefix tag for the 0xio Signed Message scheme. */
export const SIGNED_MESSAGE_PREFIX = 'Octra Signed Message:';

/** Scheme version, bumped if the framing ever changes so verifiers can detect it. */
export const SIGNED_MESSAGE_VERSION = 1;

/** UTF-8 byte length of a string (JS `.length` counts UTF-16 units, not bytes). */
function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  // atob is available in browsers and Node 16+; utils.deriveOctraAddress uses the same path.
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * The exact bytes that `wallet.signMessage(message)` produces a signature over. Verify a 0xio
 * message signature by checking an Ed25519 signature against these bytes with the signer's public
 * key. Zero-dependency - bring your own Ed25519 verifier, or use `verifyMessage`.
 */
export function getSignedMessageBytes(message: string): Uint8Array {
  if (typeof message !== 'string') {
    throw new TypeError('message must be a string');
  }
  const framed = `${SIGNED_MESSAGE_PREFIX}\n${utf8ByteLength(message)}\n${message}`;
  return new TextEncoder().encode(framed);
}

/**
 * Reconstruct the auth message that `wallet.signAuthMessage(service, nonce)` signs. A relying
 * service verifies an auth signature with `verifyMessage(buildAuthMessage(service, nonce, origin),
 * signature, publicKey)`, where `origin` is the caller's page origin.
 */
export function buildAuthMessage(service: string, nonce: string, origin: string): string {
  return `0xio auth\nService: ${service}\nNonce: ${nonce}\nOrigin: ${origin}`;
}

/**
 * Verify a 0xio message signature produced by `wallet.signMessage`.
 *
 * @param message   The original message passed to `wallet.signMessage`.
 * @param signature Base64 Ed25519 signature returned by `wallet.signMessage`.
 * @param publicKey Base64 Ed25519 public key of the signer (from `wallet.getPublicKey()`).
 * @returns         Whether the signature is valid for this message and key.
 *
 * Uses the Web Crypto Ed25519 primitive (Node 18+, Chrome 137+, Safari 17+, Firefox 129+). In an
 * environment without it, verify `getSignedMessageBytes(message)` with your own Ed25519 library.
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
    // importKey/verify can throw (rather than return false) on malformed input or an environment
    // that recognizes Ed25519 only partially; treat any such failure as "not verified".
    return false;
  }
}
