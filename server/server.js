'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const FRONTEND_DIR = path.join(ROOT, 'frontend');
require('dotenv').config({ path: path.join(ROOT, '.env') });
const DATA_DIR = process.env.DMC_DATA_DIR || path.join(ROOT, 'data');
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '0.0.0.0';
const TRUSTED_ORIGINS = new Set(
  [process.env.FRONTEND_ORIGIN, process.env.BETTER_AUTH_URL]
    .filter(Boolean)
    .map((origin) => new URL(origin).origin)
);
const DISABLED_AUTH_PATHS = new Set([
  '/api/auth/sign-in/email',
  '/api/auth/request-password-reset',
  '/api/auth/reset-password',
  '/api/auth/send-verification-email',
  '/api/auth/verify-email',
  '/api/auth/change-email'
]);
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const TEST_MODE = process.env.DMC_TEST_MODE === '1';
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; font-src 'self' https://fonts.gstatic.com https://unpkg.com data:; img-src 'self' data: blob:; connect-src 'self'; form-action 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY'
};

function getHashSecret() {
  if (process.env.DMC_DEVICE_HASH_SECRET) {
    const secret = Buffer.from(process.env.DMC_DEVICE_HASH_SECRET, 'utf8');
    if (secret.length < 32) {
      throw new Error('DMC_DEVICE_HASH_SECRET must be at least 32 bytes long.');
    }
    return secret;
  }
  if (!TEST_MODE) {
    throw new Error('DMC_DEVICE_HASH_SECRET must be configured with at least 32 bytes.');
  }

  const secretPath = path.join(DATA_DIR, 'device-hash.key');
  try {
    return fs.readFileSync(secretPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const secret = crypto.randomBytes(32);
  try {
    fs.writeFileSync(secretPath, secret, { flag: 'wx', mode: 0o600 });
    return secret;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return fs.readFileSync(secretPath);
  }
}

fs.mkdirSync(DATA_DIR, { recursive: true });
const hashSecret = getHashSecret();
let database = null;
let neonBackend = null;
let authNodeHandler = null;
let findSubmission = null;
let saveSubmission = null;
if (TEST_MODE) {
  database = new DatabaseSync(path.join(DATA_DIR, 'feedback.sqlite'));
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS device_submissions (
      device_hash TEXT PRIMARY KEY,
      submitted_at INTEGER NOT NULL
    )
  `);
  findSubmission = database.prepare(
    'SELECT submitted_at FROM device_submissions WHERE device_hash = ?'
  );
  saveSubmission = database.prepare(`
    INSERT INTO device_submissions (device_hash, submitted_at)
    VALUES (?, ?)
    ON CONFLICT(device_hash) DO UPDATE SET submitted_at = excluded.submitted_at
  `);
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) {
      const error = new Error('Request body is too large.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.status = 400;
    throw error;
  }
}

function getDeviceHash(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    return null;
  }
  return crypto.createHmac('sha256', hashSecret).update(value.toLowerCase()).digest('hex');
}

function checkCooldown(deviceHash, now) {
  const existing = findSubmission.get(deviceHash);
  if (!existing || now - existing.submitted_at >= COOLDOWN_MS) {
    return { status: 200, body: { available: true } };
  }
  return {
    status: 409,
    body: {
      error: 'duplicate_submission',
      retryAfterSeconds: Math.ceil((COOLDOWN_MS - (now - existing.submitted_at)) / 1000)
    }
  };
}

function handleDeviceCheck(deviceId, now = Date.now()) {
  const deviceHash = getDeviceHash(deviceId);
  if (!deviceHash) return { status: 400, body: { error: 'invalid_device_id' } };
  return checkCooldown(deviceHash, now);
}

function handleSubmission(deviceId, now = Date.now()) {
  const deviceHash = getDeviceHash(deviceId);
  if (!deviceHash) return { status: 400, body: { error: 'invalid_device_id' } };
  database.exec('BEGIN IMMEDIATE');
  try {
    const availability = checkCooldown(deviceHash, now);
    if (availability.status === 409) {
      database.exec('ROLLBACK');
      return availability;
    }
    saveSubmission.run(deviceHash, now);
    database.exec('COMMIT');
    return { status: 201, body: { ok: true } };
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

async function sendDeviceCheck(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }
  if (!request.headers['content-type']?.startsWith('application/json')) {
    sendJson(response, 415, { error: 'content_type_must_be_json' });
    return;
  }
  const body = await readJson(request);
  const result = handleDeviceCheck(body.deviceId);
  sendJson(response, result.status, result.body);
}

async function sendSubmission(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }
  if (!request.headers['content-type']?.startsWith('application/json')) {
    sendJson(response, 415, { error: 'content_type_must_be_json' });
    return;
  }
  const body = await readJson(request);
  const result = handleSubmission(body.deviceId);
  sendJson(response, result.status, result.body);
}

async function serveStatic(request, response, pathname) {
  const relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const filePath = path.resolve(FRONTEND_DIR, relativePath);
  if (!filePath.startsWith(`${FRONTEND_DIR}${path.sep}`)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }
  try {
    const content = await fs.promises.readFile(filePath);
    response.writeHead(200, {
      'Cache-Control': 'no-cache',
      'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
    });
    response.end(content);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    throw error;
  }
}

async function handleRequest(request, response) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.setHeader(name, value);
  }
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const requestOrigin = request.headers.origin;
  if (requestOrigin && TRUSTED_ORIGINS.has(requestOrigin)) {
    response.setHeader('Access-Control-Allow-Origin', requestOrigin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Vary', 'Origin');
  }
  if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
    if (!requestOrigin || !TRUSTED_ORIGINS.has(requestOrigin)) {
      sendJson(response, 403, { error: 'invalid_origin' });
      return;
    }
    response.writeHead(204);
    response.end();
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    if (TEST_MODE) {
      if (url.pathname === '/api/check') return sendDeviceCheck(request, response);
      if (url.pathname === '/api/submit') return sendSubmission(request, response);
      sendJson(response, 404, { error: 'not_found' });
      return;
    }
    if (!neonBackend) {
      sendJson(response, 503, { error: 'database_unavailable' });
      return;
    }
    if (url.pathname.startsWith('/api/auth/')) {
      if (DISABLED_AUTH_PATHS.has(url.pathname)) {
        sendJson(response, 404, { error: 'not_found' });
        return;
      }
      authNodeHandler(request, response);
      return;
    }
    await neonBackend.handleNeonApi(request, response, url);
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end('Method not allowed');
    return;
  }
  await serveStatic(request, response, url.pathname);
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    console.error('Request failed:', error);
    if (!response.headersSent) {
      sendJson(response, error.status || 500, { error: error.status ? 'invalid_request' : 'internal_error' });
    } else {
      response.destroy(error);
    }
  });
});

async function startServer() {
  if (!TEST_MODE) {
    if (!process.env.NEON_DATABASE_URL) throw new Error('NEON_DATABASE_URL is required.');
    if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) {
      throw new Error('BETTER_AUTH_SECRET must be at least 32 characters.');
    }
    if (!process.env.BETTER_AUTH_URL) throw new Error('BETTER_AUTH_URL is required.');
    const backend = await import('../backend/neon-backend.mjs');
    neonBackend = backend;
    authNodeHandler = backend.authNodeHandler;
    await backend.pool.query('select 1');
  }
  server.listen(PORT, HOST, () => {
    const address = server.address();
    console.log(`DMC feedback app listening on http://${HOST}:${address.port}`);
  });
}

startServer().catch((error) => {
  console.error('Server startup failed:', error.message);
  process.exitCode = 1;
});

function shutdown() {
  server.close((error) => {
    if (database) database.close();
    if (neonBackend) neonBackend.pool.end().catch((poolError) => {
      console.error('Database shutdown failed:', poolError);
      process.exitCode = 1;
    });
    if (error) {
      console.error('Server shutdown failed:', error);
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
