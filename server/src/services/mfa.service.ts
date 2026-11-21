import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/prisma.js';
import { httpError, parseJsonArray, shortId } from '../utils/helpers.js';
import { isDemoLoginEnabled } from '../utils/demo-login.js';

export const MFA_REQUIRED_ROLES_KEY = 'mfa_required_roles';
export const DEMO_MFA_CODE = '000000';

/** Default roles that require MFA when the business has not configured the setting yet. */
export const DEFAULT_MFA_REQUIRED_ROLES = [
  'business_owner',
  'managing_director',
  'finance_manager',
  'accountant',
  'payroll_officer',
  'hr_manager',
  'auditor'
];

const MFA_CHALLENGE_TTL_MS = 10 * 60 * 1000;
const MFA_MAX_ATTEMPTS = 5;

type MfaTokenPayload = {
  purpose: 'mfa';
  challengeId: string;
  userId: string;
  businessId: string;
};

function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) throw httpError(500, 'JWT_SECRET is not configured');
  return secret;
}

export function normalizeRoleCodes(roles: unknown): string[] {
  if (!Array.isArray(roles)) return [];
  return [
    ...new Set(
      roles
        .map((r) => String(r || '').trim().toLowerCase())
        .filter(Boolean)
    )
  ];
}

export async function getMfaRequiredRoles(businessId: string): Promise<string[]> {
  const row = await prisma.businessSetting.findUnique({
    where: { businessId_settingKey: { businessId, settingKey: MFA_REQUIRED_ROLES_KEY } }
  });
  const raw = row?.value ?? null;
  if (raw == null || raw.trim() === '') return [...DEFAULT_MFA_REQUIRED_ROLES];
  return normalizeRoleCodes(parseJsonArray(raw));
}

export async function getUserRoleCodes(userId: string, primaryRole: string): Promise<string[]> {
  const assigned = await prisma.userRole.findMany({
    where: { userId },
    include: { role: { select: { code: true } } }
  });
  return normalizeRoleCodes([primaryRole, ...assigned.map((r) => r.role.code)]);
}

export async function userRequiresMfa(
  businessId: string,
  userId: string,
  primaryRole: string
): Promise<boolean> {
  const required = await getMfaRequiredRoles(businessId);
  if (!required.length) return false;
  const userRoles = await getUserRoleCodes(userId, primaryRole);
  return userRoles.some((code) => required.includes(code));
}

function signMfaToken(payload: MfaTokenPayload): string {
  return jwt.sign(payload, requireJwtSecret(), { expiresIn: '10m' });
}

function verifyMfaToken(token: string): MfaTokenPayload {
  let payload: MfaTokenPayload;
  try {
    payload = jwt.verify(token, requireJwtSecret()) as MfaTokenPayload;
  } catch {
    throw httpError(401, 'MFA session expired. Sign in again.');
  }
  if (payload?.purpose !== 'mfa' || !payload.challengeId || !payload.userId) {
    throw httpError(401, 'Invalid MFA token');
  }
  return payload;
}

function randomOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function startMfaChallenge(input: {
  businessId: string;
  userId: string;
  username: string;
  email?: string | null;
}) {
  const demo = isDemoLoginEnabled();
  const code = demo ? DEMO_MFA_CODE : randomOtp();
  const codeHash = await bcrypt.hash(code, 10);
  const challenge = await prisma.mfaChallenge.create({
    data: {
      id: shortId('mfa'),
      businessId: input.businessId,
      userId: input.userId,
      codeHash,
      expiresAt: new Date(Date.now() + MFA_CHALLENGE_TTL_MS)
    }
  });

  if (!demo) {
    // Delivery hook: replace with email/SMS when mailer is wired.
    console.info(
      `[MFA] OTP for ${input.username}` +
        (input.email ? ` (${input.email})` : '') +
        `: ${code}`
    );
  }

  const mfaToken = signMfaToken({
    purpose: 'mfa',
    challengeId: challenge.id,
    userId: input.userId,
    businessId: input.businessId
  });

  return {
    mfa_required: true as const,
    mfa_token: mfaToken,
    expires_in_seconds: Math.floor(MFA_CHALLENGE_TTL_MS / 1000),
    message: demo
      ? 'Enter the demo MFA code to continue.'
      : input.email
        ? 'Enter the verification code sent for this login.'
        : 'Enter the verification code to continue.',
    demo_code: demo ? DEMO_MFA_CODE : undefined
  };
}

export async function consumeMfaChallenge(mfaToken: string, codeRaw: string) {
  const code = String(codeRaw || '').trim();
  if (!/^\d{6}$/.test(code)) throw httpError(400, 'Enter the 6-digit MFA code');

  const payload = verifyMfaToken(mfaToken);
  const challenge = await prisma.mfaChallenge.findUnique({ where: { id: payload.challengeId } });
  if (!challenge || challenge.userId !== payload.userId) {
    throw httpError(401, 'Invalid MFA challenge');
  }
  if (challenge.consumedAt) throw httpError(401, 'MFA code already used. Sign in again.');
  if (challenge.expiresAt.getTime() < Date.now()) {
    throw httpError(401, 'MFA code expired. Sign in again.');
  }
  if (challenge.attempts >= MFA_MAX_ATTEMPTS) {
    throw httpError(429, 'Too many MFA attempts. Sign in again.');
  }

  const demo = isDemoLoginEnabled();
  const ok =
    (demo && code === DEMO_MFA_CODE) || (await bcrypt.compare(code, challenge.codeHash));

  if (!ok) {
    await prisma.mfaChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } }
    });
    throw httpError(401, 'Invalid MFA code');
  }

  await prisma.mfaChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() }
  });

  return { userId: challenge.userId, businessId: challenge.businessId };
}
