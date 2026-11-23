import nodemailer from 'nodemailer';

function appBaseUrl(): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  const cors = (process.env.CORS_ORIGIN || 'http://localhost:5177')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return (cors[0] || 'http://localhost:5177').replace(/\/$/, '');
}

export function buildAppLink(hashPath: string): string {
  const path = hashPath.startsWith('#') ? hashPath : `#/${hashPath.replace(/^\//, '')}`;
  return `${appBaseUrl()}/${path}`.replace(/([^:]\/)\/+/g, '$1');
}

export async function sendMail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<{ sent: boolean; skipped?: boolean; error?: string }> {
  const host = process.env.MAIL_HOST?.trim();
  const user = process.env.MAIL_USERNAME?.trim();
  const pass = process.env.MAIL_PASSWORD;
  const from =
    process.env.MAIL_FROM_ADDRESS?.trim() ||
    process.env.MAIL_USERNAME?.trim() ||
    'noreply@localhost';

  if (!host || !user || !pass) {
    console.warn('[mail] SMTP not configured — skipping send:', input.subject, '→', input.to);
    return { sent: false, skipped: true };
  }

  const port = Number(process.env.MAIL_PORT || 465);
  const secure =
    process.env.MAIL_ENCRYPTION === 'ssl' ||
    process.env.MAIL_ENCRYPTION === 'tls' ||
    port === 465;

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass }
    });
    await transporter.sendMail({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html || input.text.replace(/\n/g, '<br/>')
    });
    return { sent: true };
  } catch (err: any) {
    console.error('[mail] send failed', err?.message || err);
    return { sent: false, error: err?.message || 'Mail send failed' };
  }
}
