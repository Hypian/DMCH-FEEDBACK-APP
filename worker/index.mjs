import { Pool } from '@neondatabase/serverless';
import { createAuthRuntime } from '../backend/neon-auth.mjs';
import { createNeonApiHandler } from '../backend/neon-backend.mjs';
import { processPendingAlerts, processAlertEscalations } from '../backend/alert-dispatcher.mjs';

const DISABLED_AUTH_PATHS = new Set([
  '/api/auth/sign-in/email',
  '/api/auth/request-password-reset',
  '/api/auth/reset-password',
  '/api/auth/send-verification-email',
  '/api/auth/verify-email',
  '/api/auth/change-email'
]);

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; font-src 'self' https://fonts.gstatic.com https://unpkg.com data:; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'; form-action 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY'
};

function getConfiguredOrigins(env) {
  const origins = new Set();
  const candidates = [
    env.FRONTEND_ORIGIN,
    env.BETTER_AUTH_URL,
    ...(typeof env.TRUSTED_ORIGINS === 'string' ? env.TRUSTED_ORIGINS.split(',') : [])
  ];
  for (const raw of candidates) {
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (!trimmed) continue;
    try {
      origins.add(new URL(trimmed).origin);
    } catch {
      // Ignore malformed origin values
    }
  }
  return origins;
}

function getTrustedOrigins(env, requestUrl) {
  const origins = getConfiguredOrigins(env);
  origins.add(requestUrl.origin);
  return origins;
}

function applyResponseHeaders(headers, requestOrigin, trustedOrigins) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  if (requestOrigin && trustedOrigins.has(requestOrigin)) {
    headers.set('Access-Control-Allow-Origin', requestOrigin);
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, x-background-poll, x-cron-secret');
    headers.set('Vary', 'Origin');
  }
}

function jsonResponse(status, body, requestOrigin, trustedOrigins, extraHeaders = {}) {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    ...extraHeaders
  });
  applyResponseHeaders(headers, requestOrigin, trustedOrigins);
  return new Response(JSON.stringify(body), { status, headers });
}

function createNodeShimRequest(request) {
  const headers = {};
  for (const [key, value] of request.headers.entries()) {
    const lower = key.toLowerCase();
    headers[lower] = headers[lower] ? `${headers[lower]}, ${value}` : value;
  }
  return {
    method: request.method,
    url: request.url,
    headers,
    async *[Symbol.asyncIterator]() {
      if (!request.body) return;
      const reader = request.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) yield Buffer.from(value);
        }
      } finally {
        reader.releaseLock();
      }
    }
  };
}

function createNodeShimResponse(requestOrigin, trustedOrigins) {
  const headers = new Headers();
  let statusCode = 200;
  let body = null;
  let finished = false;

  return {
    get headersSent() {
      return finished;
    },
    setHeader(name, value) {
      if (Array.isArray(value)) {
        headers.delete(name);
        for (const item of value) headers.append(name, String(item));
      } else {
        headers.set(name, String(value));
      }
    },
    writeHead(status, headerMap = {}) {
      statusCode = status;
      for (const [name, value] of Object.entries(headerMap)) {
        this.setHeader(name, value);
      }
    },
    end(chunk = '') {
      finished = true;
      body = chunk ?? '';
    },
    toWebResponse() {
      applyResponseHeaders(headers, requestOrigin, trustedOrigins);
      return new Response(body, { status: statusCode, headers });
    }
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const requestOrigin = request.headers.get('origin');
    const trustedOrigins = getTrustedOrigins(env, url);

    if (request.method === 'OPTIONS' && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/webhooks/'))) {
      if (!requestOrigin || !trustedOrigins.has(requestOrigin)) {
        return jsonResponse(403, { error: 'invalid_origin' }, requestOrigin, trustedOrigins);
      }
      const headers = new Headers();
      applyResponseHeaders(headers, requestOrigin, trustedOrigins);
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname === '/api/health') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return jsonResponse(405, { error: 'method_not_allowed' }, requestOrigin, trustedOrigins, { Allow: 'GET, HEAD' });
      }
      if (request.method === 'HEAD') {
        const headers = new Headers({
          'Cache-Control': 'no-store',
          'Content-Type': 'application/json; charset=utf-8'
        });
        applyResponseHeaders(headers, requestOrigin, trustedOrigins);
        return new Response(null, { status: 200, headers });
      }
      return jsonResponse(200, {
        ok: true,
        service: 'dmch-feedback-app',
        runtime: 'cloudflare-workers'
      }, requestOrigin, trustedOrigins);
    }

    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/webhooks/')) {
      if (url.pathname.startsWith('/api/auth/') && DISABLED_AUTH_PATHS.has(url.pathname)) {
        return jsonResponse(404, { error: 'not_found' }, requestOrigin, trustedOrigins);
      }

      const configuredOrigins = getConfiguredOrigins(env);
      const activeOrigin = configuredOrigins.has(url.origin) ? url.origin : null;
      const runtimeEnv = {
        ...env,
        BETTER_AUTH_URL: activeOrigin || env.BETTER_AUTH_URL || url.origin,
        FRONTEND_ORIGIN: activeOrigin || env.FRONTEND_ORIGIN || url.origin
      };

      const backgroundTasks = [];
      let pool = null;

      try {
        const authRuntime = createAuthRuntime(runtimeEnv);
        pool = authRuntime.pool;

        if (url.pathname.startsWith('/api/auth/')) {
          const authResponse = await authRuntime.auth.handler(request);
          const headers = new Headers(authResponse.headers);
          applyResponseHeaders(headers, requestOrigin, trustedOrigins);
          return new Response(authResponse.body, {
            status: authResponse.status,
            statusText: authResponse.statusText,
            headers
          });
        }

        const handleNeonApi = createNeonApiHandler({
          pool,
          getAuthSession: authRuntime.getAuthSession,
          env: runtimeEnv,
          waitUntil: (promise) => {
            backgroundTasks.push(Promise.resolve(promise).catch((err) => {
              console.error(JSON.stringify({
                event: 'worker.background_task_error',
                path: url.pathname,
                error: err instanceof Error ? err.message : String(err)
              }));
            }));
          }
        });

        const nodeReq = createNodeShimRequest(request);
        const nodeRes = createNodeShimResponse(requestOrigin, trustedOrigins);
        await handleNeonApi(nodeReq, nodeRes, url);
        return nodeRes.toWebResponse();
      } catch (error) {
        const status = error && typeof error.status === 'number' ? error.status : 500;
        console.error(JSON.stringify({
          event: 'worker.request_error',
          method: request.method,
          path: url.pathname,
          status,
          error: error instanceof Error ? error.message : String(error)
        }));
        return jsonResponse(
          status,
          { error: status !== 500 ? 'invalid_request' : 'internal_error' },
          requestOrigin,
          trustedOrigins
        );
      } finally {
        if (pool) {
          const activePool = pool;
          const cleanup = Promise.allSettled(backgroundTasks).finally(() =>
            activePool.end().catch(() => {})
          );
          if (ctx && typeof ctx.waitUntil === 'function') {
            ctx.waitUntil(cleanup);
          } else {
            await cleanup;
          }
        }
      }
    }

    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }

    return jsonResponse(404, { error: 'not_found' }, requestOrigin, trustedOrigins);
  },

  async scheduled(controller, env, ctx) {
    if (!env.NEON_DATABASE_URL) {
      console.error(JSON.stringify({
        event: 'cron.skipped',
        cron: controller?.cron || null,
        reason: 'NEON_DATABASE_URL is not configured'
      }));
      return;
    }

    const runAlerts = async () => {
      const pool = new Pool({ connectionString: env.NEON_DATABASE_URL });
      try {
        const results = await processPendingAlerts(pool, { limit: 25 });
        const escalated = await processAlertEscalations(pool);
        console.log(JSON.stringify({
          event: 'cron.alerts_processed',
          cron: controller?.cron || null,
          ...results,
          escalated
        }));
      } catch (error) {
        console.error(JSON.stringify({
          event: 'cron.alerts_error',
          cron: controller?.cron || null,
          error: error instanceof Error ? error.message : String(error)
        }));
      } finally {
        await pool.end().catch(() => {});
      }
    };

    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(runAlerts());
    } else {
      await runAlerts();
    }
  }
};
