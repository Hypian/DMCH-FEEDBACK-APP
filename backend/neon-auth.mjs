import { Pool } from '@neondatabase/serverless';
import { betterAuth } from 'better-auth';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { username } from 'better-auth/plugins';
import 'dotenv/config';
import { createPendingApproval } from './approval-api.mjs';
import { recordAuditEvent } from './audit-log.mjs';
import { syncUserAlertContact, normalizePhoneE164 } from './services/contact-sync.mjs';

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
  session: {
    expiresIn: 3600,
    updateAge: 300
  },
  advanced: {
    defaultCookieAttributes: {
      sameSite: baseURL.startsWith('https://') && frontendOrigin ? 'none' : 'lax',
      secure: baseURL.startsWith('https://'),
      partitioned: baseURL.startsWith('https://') && Boolean(frontendOrigin)
    }
  },
  user: {
    additionalFields: {
      phone: { type: 'string', required: false },
      category: { type: 'string', required: false, defaultValue: 'clinical' }
    }
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (typeof user.username !== 'string' || !user.username) {
            throw new Error('A username is required to create an account.');
          }
          let cleanPhone = user.phone ? normalizePhoneE164(user.phone) : null;
          const validCat = ['clinical', 'public_relations', 'managing_director'].includes(user.category)
            ? user.category
            : 'clinical';

          return {
            data: {
              ...user,
              phone: cleanPhone,
              category: validCat,
              email: `${user.username.toLowerCase()}@accounts.dmc.invalid`
            }
          };
        },
        after: async (user) => {
          await createPendingApproval(pool, user.id);
          if (user.phone) {
            await syncUserAlertContact(pool, {
              userId: user.id,
              name: user.name,
              username: user.username,
              phone: user.phone,
              category: user.category || 'clinical'
            }).catch((err) => console.warn('[CONTACT SYNC WARN]', err.message));
          }
        }
      }
    },
    session: {
      create: {
        after: async (session) => {
          await pool.query(
            `insert into public.feedback_session_activity (session_token, user_id, last_active_at)
             values ($1, $2, now())
             on conflict (session_token) do update
               set last_active_at = excluded.last_active_at`,
            [session.token || session.id, session.userId]
          ).catch(() => {});
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
