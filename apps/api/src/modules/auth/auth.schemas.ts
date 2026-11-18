import { z } from 'zod';

/** Normalises Sri Lankan mobile numbers to E.164 (+94XXXXXXXXX); other +country numbers are kept as is. */
export function normalizePhone(raw: string): string | null {
  const s = raw.replace(/[\s()-]/g, '');
  if (/^0\d{9}$/.test(s)) return `+94${s.slice(1)}`;
  if (/^94\d{9}$/.test(s)) return `+${s}`;
  if (/^\+\d{8,15}$/.test(s)) return s;
  return null;
}

export const phoneSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const p = normalizePhone(v);
    if (!p) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid mobile number' });
      return z.NEVER;
    }
    return p;
  });

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/\d/, 'Include at least one number');

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address');

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(200), // email or mobile
  password: z.string().min(1).max(128),
});

export const verifyRequestSchema = z.object({ channel: z.enum(['email', 'sms']) });
export const verifyConfirmSchema = z.object({ channel: z.enum(['email', 'sms']), code: z.string().regex(/^\d{6}$/) });

export const forgotSchema = z.object({ identifier: z.string().trim().min(3).max(200) });
export const resetSchema = z.object({
  identifier: z.string().trim().min(3).max(200),
  code: z.string().regex(/^\d{6}$/),
  password: passwordSchema,
});

export const updateMeSchema = z.object({ name: z.string().trim().min(2).max(100).optional(), phone: phoneSchema.optional() });
export const changePasswordSchema = z.object({ currentPassword: z.string().optional(), newPassword: passwordSchema });
