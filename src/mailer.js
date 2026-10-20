/*
 * Outgoing email (verification and password reset).
 *
 * With RESEND_API_KEY and MAIL_FROM set, mail goes out through Resend's HTTP
 * API (no extra dependency). Without them, nothing is sent: the message is
 * logged in development and kept in `outbox` so tests can read it.
 */
function createMailer(opts = {}) {
  const key = opts.apiKey !== undefined ? opts.apiKey : process.env.RESEND_API_KEY;
  const from = opts.from || process.env.MAIL_FROM;
  const fetcher = opts.fetch || ((u, i) => fetch(u, i));
  const log = opts.log !== undefined ? opts.log : process.env.NODE_ENV !== 'production';
  const outbox = [];
  const enabled = !!(key && from);

  async function send({ to, subject, text }) {
    outbox.push({ to, subject, text, at: Date.now() });
    if (outbox.length > 50) outbox.shift();
    if (!enabled) {
      if (log) console.log(`[mail] (not sent: no mail service) to ${to}: ${subject}\n${text}`);
      return { sent: false };
    }
    const res = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`mail service ${res.status}`);
    return { sent: true };
  }

  return { send, enabled, outbox };
}

module.exports = { createMailer };
