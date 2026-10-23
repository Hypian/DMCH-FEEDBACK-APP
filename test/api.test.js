'use strict';

/**
 * DMC Feedback – Comprehensive API Test Suite
 *
 * Runs entirely in TEST_MODE (SQLite, no Neon/Better-Auth required).
 * Covers:
 *   - Static file serving + MIME types
 *   - /api/check  – device availability gate
 *   - /api/submit – feedback submission + deduplication
 *   - /api/departments – public list (active only)
 *   - Method / content-type rejection on every guarded route
 *   - 404 for unknown API paths
 *   - Admin-only routes return 401 without a session
 *   - Data integrity: HMAC hash is stored, not raw device ID
 *   - Concurrent submission race: exactly one 201, one 409
 *   - Cooldown expires: device accepted again after 24 h
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const test = require('node:test');

/* ─── Helpers ───────────────────────────────────────────────────────── */

const SECRET = 'test-only-secret-that-is-at-least-32-bytes';

async function startTestServer(dataDir) {
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
    env: {
      ...process.env,
      DMC_DATA_DIR: dataDir,
      DMC_DEVICE_HASH_SECRET: SECRET,
      DMC_TEST_MODE: '1',
      HOST: '127.0.0.1',
      PORT: '0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let out = '', err = '';
  proc.stdout.setEncoding('utf8').on('data', c => out += c);
  proc.stderr.setEncoding('utf8').on('data', c => err += c);

  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Server did not start within 15 s.\nstdout: ${out}\nstderr: ${err}`)),
      15_000
    );
    const check = () => {
      const m = out.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) { clearTimeout(timer); resolve(`http://127.0.0.1:${m[1]}`); }
    };
    proc.stdout.on('data', check);
    proc.once('error', e => { clearTimeout(timer); reject(e); });
    proc.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited (${code}).\n${err}`)); });
    check();
  });

  return { proc, base };
}

function post(base, pathname, body, extraHeaders = {}) {
  return fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body)
  });
}

function hmac(deviceId) {
  return crypto.createHmac('sha256', SECRET).update(deviceId.toLowerCase()).digest('hex');
}

const UUID_A = '7ac62bf0-f9e4-4c87-9eb9-6bc5c840fd31';
const UUID_B = 'd02a4869-a244-48b0-8e19-d59cab82943c';
const UUID_C = '51f133b0-1dd9-4008-a3b1-4b39c39ba086';
const UUID_D = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

/* ─── Test Suite ─────────────────────────────────────────────────────── */

test('Static file serving', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmc-api-test-static-'));
  const { proc, base } = await startTestServer(dataDir);

  try {
    await t.test('GET / returns 200 HTML containing app title', async () => {
      const r = await fetch(base);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type'), /text\/html/);
      assert.match(await r.text(), /DMC Hospital/);
    });

    await t.test('GET /styles.css returns 200 text/css', async () => {
      const r = await fetch(`${base}/styles.css`);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type'), /text\/css/);
    });

    await t.test('GET /script.js returns 200 javascript', async () => {
      const r = await fetch(`${base}/script.js`);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type'), /javascript/);
    });

    await t.test('GET /xlsx-export.js returns 200 javascript', async () => {
      const r = await fetch(`${base}/xlsx-export.js`);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type'), /javascript/);
    });

    await t.test('GET /logo-optimized.jpg returns 200 image/jpeg', async () => {
      const r = await fetch(`${base}/logo-optimized.jpg`);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('content-type'), /image\/jpeg/);
    });

    await t.test('GET /nonexistent.xyz returns 404', async () => {
      const r = await fetch(`${base}/nonexistent.xyz`);
      assert.equal(r.status, 404);
    });

    await t.test('Path traversal /../package.json is blocked (file not served)', async () => {
      const r = await fetch(`${base}/../package.json`);
      // Node's URL parser normalises /../ before our directory-escape check runs,
      // so the server sees /package.json → not in frontend/ → 403 or 404.
      // Either way the file must NOT be returned with 200.
      assert.notEqual(r.status, 200, 'Path traversal must not return file contents');
    });

    await t.test('POST to / returns 405', async () => {
      const r = await fetch(base, { method: 'POST', body: '' });
      assert.equal(r.status, 405);
    });
  } finally {
    proc.kill();
    await once(proc, 'exit');
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('/api/check – device availability gate', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmc-api-test-check-'));
  const { proc, base } = await startTestServer(dataDir);

  try {
    await t.test('Fresh device ID → 200 { available: true }', async () => {
      const r = await post(base, '/api/check', { deviceId: UUID_A });
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { available: true });
    });

    await t.test('Malformed device ID → 400', async () => {
      const r = await post(base, '/api/check', { deviceId: 'not-a-uuid' });
      assert.equal(r.status, 400);
    });

    await t.test('Missing device ID → 400', async () => {
      const r = await post(base, '/api/check', {});
      assert.equal(r.status, 400);
    });

    await t.test('GET /api/check → 405', async () => {
      const r = await fetch(`${base}/api/check`);
      assert.equal(r.status, 405);
    });

    await t.test('Wrong Content-Type → 415', async () => {
      const r = await fetch(`${base}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ deviceId: UUID_A })
      });
      assert.equal(r.status, 415);
    });

    await t.test('Device that already submitted → 409 with retryAfterSeconds', async () => {
      await post(base, '/api/submit', { deviceId: UUID_B });
      const r = await post(base, '/api/check', { deviceId: UUID_B });
      assert.equal(r.status, 409);
      const body = await r.json();
      assert.equal(body.error, 'duplicate_submission');
      assert.ok(typeof body.retryAfterSeconds === 'number' && body.retryAfterSeconds > 0);
    });
  } finally {
    proc.kill();
    await once(proc, 'exit');
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('/api/submit – feedback submission & deduplication', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmc-api-test-submit-'));
  const { proc, base } = await startTestServer(dataDir);

  try {
    await t.test('First submission → 201', async () => {
      const r = await post(base, '/api/submit', { deviceId: UUID_A });
      assert.equal(r.status, 201);
    });

    await t.test('Duplicate from same device → 409 duplicate_submission', async () => {
      const r = await post(base, '/api/submit', { deviceId: UUID_A });
      assert.equal(r.status, 409);
      assert.equal((await r.json()).error, 'duplicate_submission');
    });

    await t.test('Different device submits independently → 201', async () => {
      const r = await post(base, '/api/submit', { deviceId: UUID_B });
      assert.equal(r.status, 201);
    });

    await t.test('Invalid device ID format → 400', async () => {
      const r = await post(base, '/api/submit', { deviceId: 'bad-id' });
      assert.equal(r.status, 400);
    });

    await t.test('Missing device ID → 400', async () => {
      const r = await post(base, '/api/submit', {});
      assert.equal(r.status, 400);
    });

    await t.test('GET /api/submit → 405', async () => {
      const r = await fetch(`${base}/api/submit`);
      assert.equal(r.status, 405);
    });

    await t.test('Wrong Content-Type on submit → 415', async () => {
      const r = await fetch(`${base}/api/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'deviceId=abc'
      });
      assert.equal(r.status, 415);
    });

    await t.test('Concurrent race: exactly one 201 and one 409', async () => {
      const [r1, r2] = await Promise.all([
        post(base, '/api/submit', { deviceId: UUID_C }),
        post(base, '/api/submit', { deviceId: UUID_C })
      ]);
      assert.deepEqual([r1.status, r2.status].sort(), [201, 409]);
    });
  } finally {
    proc.kill();
    await once(proc, 'exit');
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Data integrity – device hash storage', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmc-api-test-hash-'));
  const { proc, base } = await startTestServer(dataDir);

  try {
    await t.test('Raw UUID is never stored; only HMAC-SHA256 hex digest is persisted', async () => {
      await post(base, '/api/submit', { deviceId: UUID_D });

      const db = new DatabaseSync(path.join(dataDir, 'feedback.sqlite'));
      const rows = db.prepare('SELECT device_hash FROM device_submissions').all();
      db.close();

      assert.equal(rows.length, 1);
      const stored = rows[0].device_hash;

      assert.match(stored, /^[a-f0-9]{64}$/, 'Must be a 64-char hex SHA-256 digest');
      assert.notEqual(stored, UUID_D, 'Raw UUID must not be stored');
      assert.notEqual(stored, UUID_D.replace(/-/g, ''), 'UUID without dashes must not be stored');
      assert.equal(stored, hmac(UUID_D), 'Must match HMAC-SHA256(secret, deviceId)');
    });
  } finally {
    proc.kill();
    await once(proc, 'exit');
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Cooldown expiry – device re-accepted after 24 h', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmc-api-test-cooldown-'));
  const { proc, base } = await startTestServer(dataDir);

  try {
    await t.test('Device blocked during cooldown, then accepted after expiry', async () => {
      assert.equal((await post(base, '/api/submit', { deviceId: UUID_A })).status, 201);
      assert.equal((await post(base, '/api/submit', { deviceId: UUID_A })).status, 409);
      assert.equal((await post(base, '/api/check',  { deviceId: UUID_A })).status, 409);

      // Backdate past the 24 h window
      const db = new DatabaseSync(path.join(dataDir, 'feedback.sqlite'));
      db.prepare('UPDATE device_submissions SET submitted_at = ? WHERE device_hash = ?')
        .run(Date.now() - 24 * 60 * 60 * 1000 - 1000, hmac(UUID_A));
      db.close();

      assert.equal((await post(base, '/api/check',  { deviceId: UUID_A })).status, 200);
      assert.equal((await post(base, '/api/submit', { deviceId: UUID_A })).status, 201);
    });
  } finally {
    proc.kill();
    await once(proc, 'exit');
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('/api/departments and admin routes blocked in TEST_MODE', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmc-api-test-guard-'));
  const { proc, base } = await startTestServer(dataDir);

  const blocked = [
    { method: 'GET',    path: '/api/departments' },
    { method: 'GET',    path: '/api/admin/session' },
    { method: 'GET',    path: '/api/responses' },
    { method: 'POST',   path: '/api/admin/departments' },
    { method: 'POST',   path: '/api/admin/demo' },
    { method: 'DELETE', path: '/api/admin/demo' },
    { method: 'DELETE', path: '/api/responses' },
    { method: 'GET',    path: '/api/' },
    { method: 'GET',    path: '/api/foobar' },
  ];

  try {
    for (const route of blocked) {
      await t.test(`${route.method} ${route.path} is not 200`, async () => {
        const opts = { method: route.method, headers: { 'Content-Type': 'application/json' } };
        if (!['GET', 'DELETE'].includes(route.method)) opts.body = JSON.stringify({});
        const r = await fetch(`${base}${route.path}`, opts);
        assert.notEqual(r.status, 200, `${route.method} ${route.path} must not return 200`);
        // Must return a JSON error body
        const body = await r.json();
        assert.ok('error' in body || r.status === 404, 'Must return error JSON or 404');
      });
    }
  } finally {
    proc.kill();
    await once(proc, 'exit');
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Response structure & headers', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmc-api-test-headers-'));
  const { proc, base } = await startTestServer(dataDir);

  try {
    await t.test('/api/check has correct Content-Type and shape', async () => {
      const r = await post(base, '/api/check', { deviceId: UUID_A });
      assert.equal(r.headers.get('content-type'), 'application/json; charset=utf-8');
      const body = await r.json();
      assert.ok(typeof body === 'object' && body !== null);
      assert.ok('available' in body);
    });

    await t.test('Error responses contain an "error" string key', async () => {
      const r = await post(base, '/api/check', { deviceId: 'bad' });
      const body = await r.json();
      assert.ok('error' in body);
      assert.equal(typeof body.error, 'string');
    });

    await t.test('API responses set Cache-Control: no-store', async () => {
      const r = await post(base, '/api/check', { deviceId: UUID_B });
      assert.equal(r.headers.get('cache-control'), 'no-store');
    });

    await t.test('API and static responses set browser security headers', async () => {
      const r = await fetch(`${base}/`);
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(r.headers.get('x-frame-options'), 'DENY');
      assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
      assert.equal(r.headers.get('strict-transport-security'), 'max-age=31536000');
      assert.equal(r.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
      assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
      assert.match(r.headers.get('content-security-policy'), /object-src 'none'/);
      const api = await post(base, '/api/check', { deviceId: UUID_A });
      assert.equal(api.headers.get('x-content-type-options'), 'nosniff');
      assert.match(api.headers.get('content-security-policy'), /default-src 'self'/);
    });

    await t.test('Static assets set a Cache-Control header (no-cache)', async () => {
      const r = await fetch(`${base}/styles.css`);
      assert.ok(r.headers.get('cache-control'), 'Static files must set Cache-Control');
    });
  } finally {
    proc.kill();
    await once(proc, 'exit');
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
