import { Receiver } from '@upstash/qstash';

let _receiver: Receiver | null = null;
function receiver(): Receiver | null {
  const cur = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nxt = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!cur || !nxt) return null;
  if (!_receiver) _receiver = new Receiver({ currentSigningKey: cur, nextSigningKey: nxt });
  return _receiver;
}

export async function verifyQstashRequest(
  req: Request,
): Promise<{ ok: true; raw: string } | { ok: false }> {
  const raw = await req.text();
  if (process.env.ALLOW_UNSIGNED_JOBS === '1') return { ok: true, raw }; // dev only
  const sig = req.headers.get('Upstash-Signature');
  const r = receiver();
  if (!sig || !r) return { ok: false };
  try {
    const valid = await r.verify({ body: raw, signature: sig });
    return valid ? { ok: true, raw } : { ok: false };
  } catch {
    return { ok: false };
  }
}
