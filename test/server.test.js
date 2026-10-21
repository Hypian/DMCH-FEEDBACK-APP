'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const test = require('node:test');

test('browser submissions are deduplicated for 24 hours, then accepted again', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmc-feedback-test-'));
  const serverProcess = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
    env: {
      ...process.env,
      DMC_DATA_DIR: dataDir,
      DMC_DEVICE_HASH_SECRET: 'test-only-secret-that-is-at-least-32-bytes',
      DMC_TEST_MODE: '1',
      FRONTEND_ORIGIN: 'https://hypian.github.io',
      BETTER_AUTH_URL: 'http://localhost:5173',
      HOST: '127.0.0.1',
      PORT: '0'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  let errors = '';
  serverProcess.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
  serverProcess.stderr.setEncoding('utf8').on('data', (chunk) => { errors += chunk; });

  try {
    const address = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Server failed to start. ${output} ${errors}`)), 15000);
      const checkOutput = () => {
        const match = output.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) {
          clearTimeout(timeout);
          resolve(`http://127.0.0.1:${match[1]}`);
        }
      };
      serverProcess.stdout.on('data', checkOutput);
      serverProcess.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      serverProcess.once('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`Server exited before starting (${code}). ${errors}`));
      });
      checkOutput();
    });

    const postDevice = (deviceId) => fetch(`${address}/api/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId })
    });
    const checkDevice = (deviceId) => fetch(`${address}/api/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId })
    });

    const homepage = await fetch(address);
    assert.equal(homepage.status, 200);
    assert.match(await homepage.text(), /Patient Feedback/);
    const stylesheet = await fetch(`${address}/styles.css`);
    assert.equal(stylesheet.status, 200);
    assert.match(stylesheet.headers.get('content-type'), /text\/css/);
    const preflight = await fetch(`${address}/api/check`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://hypian.github.io' }
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://hypian.github.io');
    assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
    const untrustedPreflight = await fetch(`${address}/api/check`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://untrusted.example' }
    });
    assert.equal(untrustedPreflight.status, 403);

    const deviceA = '7ac62bf0-f9e4-4c87-9eb9-6bc5c840fd31';
    const deviceB = 'd02a4869-a244-48b0-8e19-d59cab82943c';
    const deviceC = '51f133b0-1dd9-4008-a3b1-4b39c39ba086';
    assert.equal((await postDevice('not-a-device-id')).status, 400);
    assert.equal((await checkDevice('not-a-device-id')).status, 400);
    assert.equal((await checkDevice(deviceA)).status, 200);
    assert.equal((await postDevice(deviceA)).status, 201);
    assert.equal((await checkDevice(deviceA)).status, 409);
    const duplicate = await postDevice(deviceA);
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).error, 'duplicate_submission');
    assert.equal((await postDevice(deviceB)).status, 201);
    const concurrent = await Promise.all([postDevice(deviceC), postDevice(deviceC)]);
    assert.deepEqual(concurrent.map((response) => response.status).sort(), [201, 409]);

    const database = new DatabaseSync(path.join(dataDir, 'feedback.sqlite'));
    database.prepare('UPDATE device_submissions SET submitted_at = ? WHERE device_hash = ?')
      .run(Date.now() - 24 * 60 * 60 * 1000 - 1000, crypto.createHmac('sha256', 'test-only-secret-that-is-at-least-32-bytes').update(deviceA).digest('hex'));
    const storedHash = database.prepare('SELECT device_hash FROM device_submissions WHERE device_hash = ?')
      .get(crypto.createHmac('sha256', 'test-only-secret-that-is-at-least-32-bytes').update(deviceA).digest('hex')).device_hash;
    database.close();
    assert.match(storedHash, /^[a-f0-9]{64}$/);
    assert.equal((await checkDevice(deviceA)).status, 200);
    assert.equal((await postDevice(deviceA)).status, 201);
  } finally {
    serverProcess.kill();
    await once(serverProcess, 'exit');
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
