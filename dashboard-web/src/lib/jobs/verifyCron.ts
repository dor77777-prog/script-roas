export function verifyCronRequest(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.ALLOW_UNSIGNED_JOBS === '1';
  return req.headers.get('authorization') === `Bearer ${secret}`;
}
