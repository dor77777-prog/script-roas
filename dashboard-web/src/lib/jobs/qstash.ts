import { Client } from '@upstash/qstash';

/** Absolute base URL of the deployed dashboard (QStash needs absolute URLs). */
function baseUrl(): string {
  const b = process.env.ROAS_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
  if (!b) throw new Error('ROAS_BASE_URL (or VERCEL_URL) required for QStash worker URLs');
  return b.replace(/\/$/, '');
}

export function workerUrl(path: string): string {
  return `${baseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}

let _client: Client | null = null;
function client(): Client {
  if (!process.env.QSTASH_TOKEN) throw new Error('QSTASH_TOKEN not set');
  if (!_client) _client = new Client({ token: process.env.QSTASH_TOKEN });
  return _client;
}

/** Publish ONE job: QStash will POST `body` as JSON to workerUrl(path), with retries. */
export async function publishJob(
  path: string,
  body: unknown,
  opts: { retries?: number; delayseconds?: number } = {},
): Promise<void> {
  await client().publishJSON({
    url: workerUrl(path),
    body,
    retries: opts.retries ?? 3,
    ...(opts.delayseconds ? { delay: opts.delayseconds } : {}),
  });
}
