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
  assert.equal(wranglerConfig.main, './worker/index.mjs');
  assert.ok(wranglerConfig.compatibility_flags.includes('nodejs_compat'));
  assert.equal(wranglerConfig.workers_dev, true);
  assert.equal(wranglerConfig.keep_vars, true);
  assert.equal(wranglerConfig.placement.mode, 'smart');
  assert.equal(wranglerConfig.observability.enabled, true);
  assert.equal(wranglerConfig.observability.traces.enabled, true);
  assert.ok(wranglerConfig.triggers.crons.includes('*/5 * * * *'));
  assert.equal(wranglerConfig.assets.directory, './frontend');
  assert.deepEqual(wranglerConfig.assets.run_worker_first, ['/api/*', '/webhooks/*']);
  assert.ok(
    wranglerConfig.routes.some((r) => r.pattern === 'feedback.dreammedicalcenter.rw' && r.custom_domain === true)
  );
  assert.equal(wranglerConfig.vars.BETTER_AUTH_URL, 'https://feedback.dreammedicalcenter.rw');
  assert.ok(wranglerConfig.vars.TRUSTED_ORIGINS.includes('https://feedback.dreammedicalcenter.rw'));
  assert.ok(wranglerConfig.vars.TRUSTED_ORIGINS.includes('https://dmch-feedback-app.dmc-resto-mis.workers.dev'));
});

test('Cloudflare Worker scheduled handler skips cleanly when NEON_DATABASE_URL is unset', async () => {
  const logged = [];
  const origError = console.error;
  console.error = (msg) => logged.push(String(msg));
  try {
    await worker.scheduled({ cron: '*/5 * * * *' }, {}, { waitUntil() {} });
  } finally {
    console.error = origError;
  }
  assert.equal(logged.length, 1);
  const parsed = JSON.parse(logged[0]);
  assert.equal(parsed.event, 'cron.skipped');
  assert.equal(parsed.cron, '*/5 * * * *');
});

test('Cloudflare deployment scripts, headers, templates, and legacy cleanup are configured', () => {
  const rootDir = path.join(import.meta.dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.dev, 'npx wrangler dev');
  assert.equal(pkg.scripts.deploy, 'npx wrangler deploy');
  assert.equal(pkg.scripts['cf:dry-run'], 'npx wrangler deploy --dry-run');
  assert.equal(pkg.scripts['cf:tail'], 'npx wrangler tail');

  const headersFile = fs.readFileSync(path.join(rootDir, 'frontend', '_headers'), 'utf8');
  assert.match(headersFile, /Content-Security-Policy:/);
  assert.match(headersFile, /X-Frame-Options:\s*DENY/);
  assert.match(headersFile, /X-Content-Type-Options:\s*nosniff/);
  assert.match(headersFile, /Strict-Transport-Security:/);

  const gitignore = fs.readFileSync(path.join(rootDir, '.gitignore'), 'utf8');
  assert.match(gitignore, /\.wrangler\//);
  assert.match(gitignore, /\.dev\.vars/);

  assert.equal(fs.existsSync(path.join(rootDir, '.dev.vars.example')), true);
  assert.equal(fs.existsSync(path.join(rootDir, '.github', 'workflows', 'deploy-worker.yml')), true);
  assert.equal(fs.existsSync(path.join(rootDir, 'railway.json')), false);
});
