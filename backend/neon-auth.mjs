import { Pool } from '@neondatabase/serverless';
import { betterAuth } from 'better-auth';
import { username } from 'better-auth/plugins';
import { createPendingApproval } from './approval-api.mjs';
import { recordAuditEvent } from './audit-log.mjs';
import { syncUserAlertContact, normalizePhoneE164 } from './services/contact-sync.mjs';

const isWorkersRuntime = typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers';

/**
 * Converts Node.js IncomingHttpHeaders or Web Headers into a standard Web Headers instance.
 * Works identically on Node.js and Cloudflare Workers without importing better-auth/node.
 */
export function toWebHeaders(rawHeaders) {
  if (rawHeaders instanceof Headers) return rawHeaders;
  const headers = new Headers();
  if (!rawHeaders || typeof rawHeaders !== 'object') return headers;
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, String(item));
    } else {
      headers.set(key, String(value));
    }
  }
  return headers;
}

/**
 * Creates a request-isolated Neon Pool + Better Auth instance for the given environment.
 * On Cloudflare Workers, call this once per request and close `pool.end()` inside `ctx.waitUntil()`.
 */
export function createAuthRuntime(env = process.env) {
  const databaseUrl = env.NEON_DATABASE_URL;
  const authSecret = env.BETTER_AUTH_SECRET;
  const baseURL = env.BETTER_AUTH_URL;
  const frontendOrigin = env.FRONTEND_ORIGIN;

  if (!databaseUrl) throw new Error('NEON_DATABASE_URL is required.');
  if (!authSecret || authSecret.length < 32) {
    throw new Error('BETTER_AUTH_SECRET must be set to at least 32 characters.');
  }
  if (!baseURL) throw new Error('BETTER_AUTH_URL is required.');

  const baseOrigin = new URL(baseURL).origin;
  const isCrossSiteFrontend = Boolean(
    baseURL.startsWith('https://')
    && frontendOrigin
    && new URL(frontendOrigin).origin !== baseOrigin
  );
  const trustedOrigins = [...new Set(
    [
      baseURL,
      frontendOrigin,
      ...(typeof env.TRUSTED_ORIGINS === 'string' ? env.TRUSTED_ORIGINS.split(',') : [])
    ]
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean)
      .flatMap((entry) => {
        try {
          return [new URL(entry).origin];
        } catch {
          return [];
        }
      })
  )];

  const pool = new Pool({ connectionString: databaseUrl });

  const auth = betterAuth({
    appName: 'DMC Patient Feedback',
    baseURL,
    secret: authSecret,
    database: pool,
    trustedOrigins,
    session: {
      expiresIn: 3600,
      updateAge: 300
    },
    advanced: {
      defaultCookieAttributes: {
        sameSite: isCrossSiteFrontend ? 'none' : 'lax',
        secure: baseURL.startsWith('https://'),
        partitioned: isCrossSiteFrontend
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
            const cleanPhone = user.phone ? normalizePhoneE164(user.phone) : null;
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

  const getAuthSession = (headers) => auth.api.getSession({ headers: toWebHeaders(headers) });

  return { pool, auth, getAuthSession };
}

/**
 * Pure Web-Standard Node HTTP adapter for Better Auth (`server/server.js`).
 * Avoids importing `better-auth/node` so Workers bundles stay free of Node HTTP shims.
 */
function createNodeAuthHandler(authInstance, baseURL) {
  return async (request, response) => {
    try {
      const origin = request.headers.host
        ? `${new URL(baseURL).protocol}//${request.headers.host}`
        : new URL(baseURL).origin;
      const requestUrl = new URL(request.url, origin);
      const hasBody = !['GET', 'HEAD'].includes(request.method);
      let body;
      if (hasBody) {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        body = Buffer.concat(chunks);
      }
      const webRequest = new Request(requestUrl.toString(), {
        method: request.method,
        headers: toWebHeaders(request.headers),
        body: hasBody && body.length > 0 ? body : undefined
      });
      const webResponse = await authInstance.handler(webRequest);
      const setCookies = typeof webResponse.headers.getSetCookie === 'function'
        ? webResponse.headers.getSetCookie()
        : [];
      for (const [name, value] of webResponse.headers.entries()) {
        if (name.toLowerCase() === 'set-cookie') continue;
        response.setHeader(name, value);
      }
      if (setCookies.length > 0) {
        response.setHeader('set-cookie', setCookies);
      }
      response.writeHead(webResponse.status);
      const responseBody = Buffer.from(await webResponse.arrayBuffer());
      response.end(responseBody);
    } catch (error) {
      console.error('Auth handler failed:', error);
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'auth_internal_error' }));
      } else {
        response.destroy(error);
      }
    }
  };
}

let defaultRuntime = null;
if (!isWorkersRuntime && process.env.NEON_DATABASE_URL && process.env.BETTER_AUTH_SECRET && process.env.BETTER_AUTH_URL) {
  defaultRuntime = createAuthRuntime(process.env);
}

export const pool = defaultRuntime?.pool ?? null;
export const auth = defaultRuntime?.auth ?? null;
export const authNodeHandler = defaultRuntime
  ? createNodeAuthHandler(defaultRuntime.auth, process.env.BETTER_AUTH_URL)
  : null;

export async function getAuthSession(headers) {
  if (!defaultRuntime) {
    throw new Error('Auth runtime is not initialized. Pass request-scoped env via createAuthRuntime(env).');
  }
  return defaultRuntime.getAuthSession(headers);
}
