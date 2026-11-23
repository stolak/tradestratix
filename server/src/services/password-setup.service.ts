import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../utils/prisma.js';
import { httpError, shortId } from '../utils/helpers.js';
import { buildAppLink, sendMail } from '../utils/mailer.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(raw: string) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export async function userHasPendingPasswordSetup(userId: string): Promise<boolean> {
  const row = await prisma.passwordSetupToken.findFirst({
    where: {
      userId,
      usedAt: null,
      expiresAt: { gt: new Date() }
    },
    select: { id: true }
  });
  return Boolean(row);
}

export async function issuePasswordSetupInvite(input: {
  userId: string;
  email: string;
  fullName: string;
  username: string;
  businessName?: string | null;
}) {
  const raw = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(raw);

  await prisma.passwordSetupToken.updateMany({
    where: { userId: input.userId, usedAt: null },
    data: { usedAt: new Date() }
  });

  await prisma.passwordSetupToken.create({
    data: {
      id: shortId('pst'),
      userId: input.userId,
      tokenHash,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS)
    }
  });

  const inviteLink = buildAppLink(`set-password?token=${encodeURIComponent(raw)}`);
  const biz = input.businessName || 'TradeStratix';
  const subject = `${biz}: set your login password`;
  const text = [
    `Hello ${input.fullName},`,
    '',
    `Your ${biz} staff account is ready.`,
    `Username (staff number): ${input.username}`,
    '',
    'Click the link below to create your password:',
    inviteLink,
    '',
    'This link expires in 7 days.',
    '',
    'If you did not expect this email, ignore it.'
  ].join('\n');

  const mail = await sendMail({
    to: input.email,
    subject,
    text,
    html: `<p>Hello ${input.fullName},</p>
<p>Your <strong>${biz}</strong> staff account is ready.</p>
<p>Username (staff number): <strong>${input.username}</strong></p>
<p><a href="${inviteLink}">Click here to create your password</a></p>
<p>This link expires in 7 days.</p>`
  });

  if (!mail.sent) {
    console.info(`[password-setup] Invite link for ${input.username}: ${inviteLink}`);
  }

  return {
    invite_link: inviteLink,
    email_sent: mail.sent,
    email_skipped: Boolean(mail.skipped),
    email_error: mail.error || null
  };
}

export async function previewPasswordSetupToken(rawToken: string) {
  const tokenHash = hashToken(String(rawToken || '').trim());
  const row = await prisma.passwordSetupToken.findFirst({
    where: { tokenHash },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          fullName: true,
          email: true,
          status: true,
          business: { select: { name: true } }
        }
      }
    }
  });
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
    throw httpError(400, 'This password link is invalid or has expired');
  }
  if (row.user.status !== 'active') throw httpError(403, 'User account is not active');
  return {
    username: row.user.username,
    full_name: row.user.fullName,
    email: row.user.email,
    business_name: row.user.business?.name || null
  };
}

export async function completePasswordSetup(rawToken: string, password: string) {
  const pwd = String(password || '');
  if (pwd.length < 6) throw httpError(400, 'Password must be at least 6 characters');

  const tokenHash = hashToken(String(rawToken || '').trim());
  const row = await prisma.passwordSetupToken.findFirst({
    where: { tokenHash },
    include: { user: true }
  });
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
    throw httpError(400, 'This password link is invalid or has expired');
  }
  if (row.user.status !== 'active') throw httpError(403, 'User account is not active');

  const passwordHash = await bcrypt.hash(pwd, 10);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: row.userId },
      data: { passwordHash }
    }),
    prisma.passwordSetupToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() }
    }),
    prisma.passwordSetupToken.updateMany({
      where: { userId: row.userId, usedAt: null, id: { not: row.id } },
      data: { usedAt: new Date() }
    })
  ]);

  return { ok: true, username: row.user.username };
}
