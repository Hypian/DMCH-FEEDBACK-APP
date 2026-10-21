import { Pool } from '@neondatabase/serverless';
import { betterAuth } from 'better-auth';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import nodemailer from 'nodemailer';
import 'dotenv/config';

const databaseUrl = process.env.NEON_DATABASE_URL;
const authSecret = process.env.BETTER_AUTH_SECRET;
const baseURL = process.env.BETTER_AUTH_URL;

if (!databaseUrl) throw new Error('NEON_DATABASE_URL is required.');
if (!authSecret || authSecret.length < 32) {
  throw new Error('BETTER_AUTH_SECRET must be set to at least 32 characters.');
}
if (!baseURL) throw new Error('BETTER_AUTH_URL is required.');

export const pool = new Pool({ connectionString: databaseUrl });
const smtpConfigured = Boolean(
  process.env.SMTP_HOST
  && process.env.SMTP_PORT
  && process.env.SMTP_USER
  && process.env.SMTP_PASSWORD
  && process.env.SMTP_FROM
);

async function sendAuthEmail({ to, subject, url, action }) {
  if (!smtpConfigured) throw new Error('SMTP settings are required to send account emails.');
  const port = Number(process.env.SMTP_PORT);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: process.env.SMTP_SECURE === 'true' || port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD
    }
  });
  const safeUrl = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject,
      text: `${action}\n\n${url}`,
      html: `<p>${action}</p><p><a href="${safeUrl}">${action}</a></p>`
    });
  } finally {
    transport.close();
  }
}

export const auth = betterAuth({
  appName: 'DMC Patient Feedback',
  baseURL,
  secret: authSecret,
  database: pool,
  trustedOrigins: [baseURL],
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => sendAuthEmail({
      to: user.email,
      subject: 'Reset your DMC account password',
      url,
      action: 'Set a new password'
    })
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => sendAuthEmail({
      to: user.email,
      subject: 'Confirm your DMC account email',
      url,
      action: 'Confirm your email address'
    })
  },
  user: {
    additionalFields: {
      phone: {
        type: 'string',
        required: true,
        input: true
      }
    }
  }
});

export const authNodeHandler = toNodeHandler(auth);

export async function getAuthSession(headers) {
  return auth.api.getSession({ headers: fromNodeHeaders(headers) });
}
