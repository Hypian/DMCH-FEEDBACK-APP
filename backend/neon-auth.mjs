import { Pool } from '@neondatabase/serverless';
import { betterAuth } from 'better-auth';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { username } from 'better-auth/plugins';
import 'dotenv/config';
import { createPendingApproval } from './approval-api.mjs';
import { recordAuditEvent } from './audit-log.mjs';

const databaseUrl = process.env.NEON_DATABASE_URL;
const authSecret = process.env.BETTER_AUTH_SECRET;
const baseURL = process.env.BETTER_AUTH_URL;
const frontendOrigin = process.env.FRONTEND_ORIGIN;

if (!databaseUrl) throw new Error('NEON_DATABASE_URL is required.');
if (!authSecret || authSecret.length < 32) {
  throw new Error('BETTER_AUTH_SECRET must be set to at least 32 characters.');
}
if (!baseURL) throw new Error('BETTER_AUTH_URL is required.');

export const pool = new Pool({ connectionString: databaseUrl });

export const auth = betterAuth({
  appName: 'DMC Patient Feedback',
  baseURL,
  secret: authSecret,
  database: pool,
  trustedOrigins: [baseURL, frontendOrigin].filter(Boolean),
  advanced: {
    defaultCookieAttributes: {
      sameSite: baseURL.startsWith('https://') && frontendOrigin ? 'none' : 'lax',
      secure: baseURL.startsWith('https://'),
      partitioned: baseURL.startsWith('https://') && Boolean(frontendOrigin)
    }
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (typeof user.username !== 'string' || !user.username) {
            throw new Error('A username is required to create an account.');
          }
          return {
            data: {
              ...user,
              email: `${user.username.toLowerCase()}@accounts.dmc.invalid`
            }
          };
        },
        after: async (user) => {
          await createPendingApproval(pool, user.id);
        }
      }
    },
    session: {
      create: {
        after: async (session) => {
          await recordAuditEvent(pool, {
            actorId: session.userId,
            action: 'auth.login',
            summary: 'Signed in successfully.',
            targetType: 'session'
          });
        }
      }
    }
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    autoSignIn: false
  },
  plugins: [username({
    minUsernameLength: 3,
    maxUsernameLength: 30,
    usernameValidator: (value) => /^[a-zA-Z0-9_.]+$/.test(value),
    immutableUsername: true,
    displayUsername: false
  })]
});

export const authNodeHandler = toNodeHandler(auth);

export async function getAuthSession(headers) {
  return auth.api.getSession({ headers: fromNodeHeaders(headers) });
}
