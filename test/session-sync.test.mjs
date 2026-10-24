import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const authJsPath = path.join(__dirname, '..', 'frontend', 'auth.js');
const scriptJsPath = path.join(__dirname, '..', 'frontend', 'script.js');
const authPagesJsPath = path.join(__dirname, '..', 'frontend', 'auth-pages.js');

test('auth.js implements multi-tab session coordination channel and storage listener', () => {
  const authCode = fs.readFileSync(authJsPath, 'utf8');
  assert.match(authCode, /dmc_auth_session_channel/);
  assert.match(authCode, /dmc_session_channel_msg/);
  assert.match(authCode, /dmc_session_last_active/);
  assert.match(authCode, /dmc_has_active_session/);
  assert.match(authCode, /INACTIVITY_TIMEOUT_MS = 3600 \* 1000/);
  assert.match(authCode, /broadcastSessionEvent/);
  assert.match(authCode, /USER_ACTIVITY/);
  assert.match(authCode, /SESSION_EXPIRED/);
  assert.match(authCode, /SESSION_LOGOUT/);
  assert.match(authCode, /SESSION_LOGIN/);
  assert.match(authCode, /window\.DMC_SESSION_SYNC/);
});

test('script.js marks automatic background refreshes with background option and handles inactivity 401', () => {
  const scriptCode = fs.readFileSync(scriptJsPath, 'utf8');
  assert.match(scriptCode, /headers\['x-background-poll'\] = '1'/);
  assert.match(scriptCode, /apiRequest\('\/api\/responses',\s*'GET',\s*undefined,\s*\{\s*background:\s*true\s*\}\)/);
  assert.match(scriptCode, /loadAuditEvents\(false,\s*true\)/);
  assert.match(scriptCode, /session_expired_inactivity/);
  assert.match(scriptCode, /login\.html\?reason=inactivity/);
  assert.match(scriptCode, /DMC_SESSION_SYNC\.broadcast\('SESSION_LOGOUT'\)/);
});

test('auth-pages.js informs user of 1-hour session inactivity on login page', () => {
  const authPagesCode = fs.readFileSync(authPagesJsPath, 'utf8');
  assert.match(authPagesCode, /reason.*inactivity/);
  assert.match(authPagesCode, /Your session expired after 1 hour of inactivity\. Please sign in again\./);
});

test('user approval and deletion update in-place without triggering full screen loading animation or UI reset', () => {
  const scriptCode = fs.readFileSync(scriptJsPath, 'utf8');
  assert.match(scriptCode, /function updateUserManagementUI\(\)/);
  assert.match(scriptCode, /user-management-view/);
  assert.match(scriptCode, /Approving…/);
  assert.match(scriptCode, /loadUserManagement\(true\)/);
  // Ensure reviewUser does not set userManagementLoading = true
  assert.doesNotMatch(scriptCode, /async function reviewUser[^{]*\{[^}]*userManagementLoading\s*=\s*true/);
  // Ensure executeDeleteUser does not set userManagementLoading = true
  assert.doesNotMatch(scriptCode, /async function executeDeleteUser[^{]*\{[^}]*userManagementLoading\s*=\s*true/);
});
