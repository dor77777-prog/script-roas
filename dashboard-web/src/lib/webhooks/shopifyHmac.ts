import { createHmac, timingSafeEqual } from 'node:crypto';

/** Constant-time verify of Shopify's X-Shopify-Hmac-Sha256 (base64) over the RAW body. */
export function verifyShopifyHmac(
  rawBody: string,
  headerSig: string | null,
  secret: string | null | undefined,
): boolean {
  if (!headerSig || !secret) return false;
  const digest = createHmac('sha256', secret).update(rawBody, 'utf8').digest(); // Buffer
  // Note (Review #3): Buffer.from(x, 'base64') does NOT throw on malformed input
  // in Node — it silently drops invalid chars. So the REAL guard against a
  // malformed/short signature is the length check below (and timingSafeEqual
  // itself requires equal lengths). The try/catch is belt-and-suspenders only.
  let provided: Buffer;
  try {
    provided = Buffer.from(headerSig, 'base64');
  } catch {
    return false;
  }
  if (provided.length !== digest.length) return false;
  return timingSafeEqual(digest, provided);
}
