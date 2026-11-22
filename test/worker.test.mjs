import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import worker from '../worker/index.mjs';

const envBase = {
  BETTER_AUTH_URL: 'https://dmch-feedback-app.dmc-resto-mis.workers.dev',
  FRONTEND_ORIGIN: 'https://dmch-feedback-app.dmc-resto-mis.workers.dev'
};

test('Cloudflare Worker serves GET and HEAD /api/health with security headers without database access', async () => {
  const getRes = await worker.fetch(
    new Request('https://dmch-feedback-app.dmc-resto-mis.workers.dev/api/health'),
    envBase,
    { waitUntil() {} }
  );
  assert.equal(getRes.status, 200);
  assert.equal(getRes.headers.get('x-frame-options'), 'DENY');
  assert.equal(getRes.headers.get('x-content-type-options'), 'nosniff');
  const body = await getRes.json();
  assert.equal(body.ok, true);
  assert.equal(body.runtime, 'cloudflare-workers');

  const headRes = await worker.fetch(
    new Request('https://dmch-feedback-app.dmc-resto-mis.workers.dev/api/health', { method: 'HEAD' }),
    envBase,
    { waitUntil() {} }
  );
  assert.equal(headRes.status, 200);
});

test('Cloudflare Worker blocks disabled auth paths and enforces CORS preflight origins', async () => {
  const disabled = await worker.fetch(
    new Request('https://dmch-feedback-app.dmc-resto-mis.workers.dev/api/auth/request-password-reset', { method: 'POST' }),
    envBase,
    { waitUntil() {} }
  );
  assert.equal(disabled.status, 404);

  const okPreflight = await worker.fetch(
    new Request('https://dmch-feedback-app.dmc-resto-mis.workers.dev/api/submit', {
      method: 'OPTIONS',
      headers: { Origin: 'https://dmch-feedback-app.dmc-resto-mis.workers.dev' }
    }),
    envBase,
    { waitUntil() {} }
  );
  assert.equal(okPreflight.status, 204);
  assert.equal(
    okPreflight.headers.get('access-control-allow-origin'),
    'https://dmch-feedback-app.dmc-resto-mis.workers.dev'
  );

  const badPreflight = await worker.fetch(
    new Request('https://dmch-feedback-app.dmc-resto-mis.workers.dev/api/submit', {
      method: 'OPTIONS',
      headers: { Origin: 'https://untrusted.example' }
    }),
    envBase,
    { waitUntil() {} }
  );
  assert.equal(badPreflight.status, 403);
});

test('Cloudflare Worker delegates static asset requests to env.ASSETS and wrangler.jsonc enables observability + crons', async () => {
  let assetFetched = false;
  const res = await worker.fetch(
    new Request('https://dmch-feedback-app.dmc-resto-mis.workers.dev/index.html'),
    {
      ...envBase,
      ASSETS: {
        async fetch() {
          assetFetched = true;
          return new Response('<html>DMC</html>', { status: 200 });
        }
      }
    },
    { waitUntil() {} }
  );
  assert.equal(assetFetched, true);
  assert.equal(res.status, 200);

  const wranglerConfig = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, '..', 'wrangler.jsonc'), 'utf8')
  );
  assert.equal(wranglerConfig.name, 'dmch-feedback-app');
  assert.ok(wranglerConfig.compatibility_flags.includes('nodejs_compat'));
  assert.equal(wranglerConfig.observability.enabled, true);
  assert.equal(wranglerConfig.observability.traces.enabled, true);
  assert.ok(wranglerConfig.triggers.crons.includes('*/5 * * * *'));
  assert.equal(wranglerConfig.assets.directory, './frontend');
});
