import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createPendingApproval, getAccountApproval, handleApprovalApi } from '../backend/approval-api.mjs';

process.env.FRONTEND_ORIGIN = 'https://hypian.github.io';
process.env.BETTER_AUTH_URL = 'https://api.example.com';

class ApprovalPool {
  constructor() {
    this.admins = new Set(['sandra-user', 'regular-admin']);
    this.supremeAdmins = new Set(['sandra-user']);
    this.approvals = new Map([
      ['pending-user', { user_id: 'pending-user', status: 'pending', created_at: '2026-10-21T10:00:00Z' }],
      ['reject-user', { user_id: 'reject-user', status: 'pending', created_at: '2026-10-21T10:30:00Z' }],
      ['other-user', { user_id: 'other-user', status: 'approved', created_at: '2026-10-20T10:00:00Z' }]
    ]);
    this.users = [
      { user_id: 'pending-user', name: 'Pending Person', username: 'pending_person', created_at: '2026-10-21T10:00:00Z' },
      { user_id: 'reject-user', name: 'Rejected Person', username: 'rejected_person', created_at: '2026-10-21T10:30:00Z' },
      { user_id: 'regular-admin', name: 'Regular Admin', username: 'regular_admin', created_at: '2026-10-20T10:00:00Z' },
      { user_id: 'sandra-user', name: 'Sandra Admin', username: 'sandra', created_at: '2026-10-20T10:00:00Z' }
    ];
    this.auditEvents = [];
  }

  async query(sql, values = []) {
    if (sql.startsWith('with approval as')) {
      if (this.approvals.has(values[0])) return { rowCount: 0, rows: [] };
      this.approvals.set(values[0], {
        user_id: values[0],
        status: 'pending',
        created_at: new Date().toISOString()
      });
      this.auditEvents.push({
        actorId: values[0],
        action: 'account.created',
        summary: 'Account created and submitted for approval.',
        targetId: values[0]
      });
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes('insert into public.feedback_audit_events')) {
      this.auditEvents.push({
        actorId: values[0] || null,
        action: values[1] || 'account.created',
        summary: values[2] || 'Account created and submitted for approval.',
        targetId: values[4] || values[0] || null
      });
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("select auth_user.id, 'pending'")) {
      let inserted = 0;
      for (const user of this.users) {
        if (!this.admins.has(user.user_id) && !this.approvals.has(user.user_id)) {
          this.approvals.set(user.user_id, {
            user_id: user.user_id,
            status: 'pending',
            created_at: new Date().toISOString()
          });
          inserted += 1;
        }
      }
      return { rowCount: inserted, rows: [] };
    }
    if (sql.startsWith('select 1 from public.feedback_supreme_admins where user_id')) {
      const isSupreme = this.supremeAdmins.has(values[0]);
      return { rowCount: isSupreme ? 1 : 0, rows: isSupreme ? [{ '?column?': 1 }] : [] };
    }
    if (sql.includes('count(*)::int as total from public.feedback_supreme_admins')) {
      return { rowCount: 1, rows: [{ total: this.supremeAdmins.size }] };
    }
    if (sql.startsWith('select 1 from public.feedback_admins where user_id')) {
      const isAdmin = this.admins.has(values[0]);
      return { rowCount: isAdmin ? 1 : 0, rows: isAdmin ? [{ '?column?': 1 }] : [] };
    }
    if (sql.includes('from public."user" where id = $1')) {
      const exists = this.users.some((user) => user.user_id === values[0]);
      return { rowCount: exists ? 1 : 0, rows: exists ? [{ '?column?': 1 }] : [] };
    }
    if (sql.includes('count(*)::int as total from public.feedback_admins')) {
      return { rowCount: 1, rows: [{ total: this.admins.size }] };
    }
    if (sql.includes('from public.feedback_admins as admin')) {
      return {
        rowCount: this.admins.size,
        rows: [...this.admins].map((user_id) => {
          const user = this.users.find((row) => row.user_id === user_id);
          return { name: user?.name, username: user?.username, is_supreme_admin: this.supremeAdmins.has(user_id) };
        })
      };
    }
    if (sql.includes("where approval.status = 'approved' or admin.user_id is not null")) {
      const users = this.users.filter((user) =>
        this.approvals.get(user.user_id)?.status === 'approved' || this.admins.has(user.user_id)
      );
      return {
        rowCount: users.length,
        rows: users.map(({ name, username }) => ({ name, username }))
      };
    }
    if (sql.includes('from public."user" as auth_user')) {
      return {
        rowCount: this.users.length,
        rows: this.users.map((user) => ({
          user_id: user.user_id,
          name: user.name,
          username: user.username,
          status: this.approvals.get(user.user_id)?.status || (this.admins.has(user.user_id) ? 'approved' : 'pending'),
          created_at: user.created_at,
          is_admin: this.admins.has(user.user_id),
          is_supreme_admin: this.supremeAdmins.has(user.user_id)
        }))
      };
    }
    if (sql.includes('insert into public.feedback_admins')) {
      this.admins.add(values[0]);
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes('delete from public.feedback_admins')) {
      this.admins.delete(values[0]);
      this.supremeAdmins.delete(values[0]);
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes('insert into public.feedback_supreme_admins')) {
      this.supremeAdmins.add(values[0]);
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes('delete from public.feedback_supreme_admins')) {
      this.supremeAdmins.delete(values[0]);
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes('insert into public.feedback_account_approvals')) {
      if (sql.includes('reviewed_at')) {
        this.approvals.set(values[0], {
          user_id: values[0],
          status: 'approved',
          reviewed_by: values[1],
          created_at: new Date().toISOString()
        });
        return { rowCount: 1, rows: [] };
      }
      if (!this.approvals.has(values[0])) {
        this.approvals.set(values[0], { user_id: values[0], status: 'pending', created_at: new Date().toISOString() });
      }
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes('select status from public.feedback_account_approvals')) {
      const approval = this.approvals.get(values[0]);
      return { rowCount: approval ? 1 : 0, rows: approval ? [{ status: approval.status }] : [] };
    }
    if (sql.includes('join public."user"')) {
      return { rowCount: this.users.length, rows: this.users.filter((user) => this.approvals.get(user.user_id)?.status === 'pending') };
    }
    if (sql === 'begin' || sql === 'commit' || sql === 'rollback' || sql.includes('pg_advisory_xact_lock')) {
      return { rowCount: 0, rows: [] };
    }
    if (sql.includes('update public.feedback_account_approvals')) {
      const approval = this.approvals.get(values[0]);
      if (!approval || approval.status !== 'pending') return { rowCount: 0, rows: [] };
      approval.status = values[1];
      approval.reviewed_by = values[2];
      approval.reviewed_at = '2026-10-21T11:00:00Z';
      return { rowCount: 1, rows: [{ user_id: approval.user_id, status: approval.status, reviewed_at: approval.reviewed_at }] };
    }
    throw new Error(`Unexpected SQL in approval API test: ${sql}`);
  }

  async connect() {
    return { query: this.query.bind(this), release() {} };
  }
}

function makeRequest(method, path, userId = '', body, options = {}) {
  const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  request.method = method;
  request.headers = {
    origin: options.origin ?? 'https://hypian.github.io',
    'x-test-user': userId,
    ...(body === undefined || options.contentType === false ? {} : { 'content-type': 'application/json' })
  };
  return { request, url: new URL(path, 'http://localhost') };
}

function makeResponse() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers = {}) { this.status = status; Object.assign(this.headers, headers); },
    end(body = '') { this.body = body; }
  };
}

function getAuthSession(headers) {
  return headers['x-test-user']
    ? { user: { id: headers['x-test-user'] } }
    : null;
}

async function call(pool, method, path, userId = '', body, options) {
  const { request, url } = makeRequest(method, path, userId, body, options);
  const response = makeResponse();
  const handled = await handleApprovalApi(request, response, url, { pool, getAuthSession });
  return { handled, response, data: response.body ? JSON.parse(response.body) : null };
}

test('account status requires authentication and creates a pending record for signed-in accounts', async () => {
  const pool = new ApprovalPool();
  const unauthenticated = await call(pool, 'GET', '/api/account/status');
  assert.equal(unauthenticated.response.status, 401);
  assert.deepEqual(unauthenticated.data, { error: 'authentication_required' });

  const pending = await call(pool, 'GET', '/api/account/status', 'new-user');
  assert.equal(pending.response.status, 200);
  assert.deepEqual(pending.data, { status: 'pending' });
  assert.equal(pool.approvals.get('new-user').status, 'pending');

  const admin = await call(pool, 'GET', '/api/account/status', 'sandra-user');
  assert.deepEqual(admin.data, { status: 'approved' });
});

test('approved users can access the dashboard while pending users cannot', async () => {
  const pool = new ApprovalPool();
  const unauthenticated = await call(pool, 'GET', '/api/dashboard/session');
  assert.equal(unauthenticated.response.status, 401);

  const pending = await call(pool, 'GET', '/api/dashboard/session', 'pending-user');
  assert.equal(pending.response.status, 403);
  assert.deepEqual(pending.data, { error: 'account_approval_required', status: 'pending' });

  const regularUser = await call(pool, 'GET', '/api/dashboard/session', 'other-user');
  assert.equal(regularUser.response.status, 200);
  assert.equal(regularUser.data.isAdmin, false);
  assert.equal(regularUser.data.isSupremeAdmin, false);

  const admin = await call(pool, 'GET', '/api/dashboard/session', 'sandra-user');
  assert.equal(admin.response.status, 200);
  assert.equal(admin.data.isAdmin, true);
  assert.equal(admin.data.isSupremeAdmin, true);
});

test('account creation hook records new accounts as pending without overriding existing reviews', async () => {
  const pool = new ApprovalPool();
  await createPendingApproval(pool, 'new-signup');
  assert.equal(pool.approvals.get('new-signup').status, 'pending');
  assert.equal(pool.auditEvents.at(-1).action, 'account.created');
  assert.equal(pool.auditEvents.at(-1).targetId, 'new-signup');
  await createPendingApproval(pool, 'other-user');
  assert.equal(pool.approvals.get('other-user').status, 'approved');

  pool.users.push({
    user_id: 'new-signup',
    name: 'New Signup',
    username: 'new_signup',
    created_at: '2026-10-21T12:00:00Z'
  });
  const visibleToSupremeAdmin = await call(pool, 'GET', '/api/admin/users', 'sandra-user');
  assert.equal(
    visibleToSupremeAdmin.data.users.find((user) => user.user_id === 'new-signup').status,
    'pending'
  );
  const visibleToAdmin = await call(pool, 'GET', '/api/admin/users', 'regular-admin');
  assert.equal(
    visibleToAdmin.data.users.find((user) => user.user_id === 'new-signup').status,
    'pending'
  );
});

test('pending approval list requires supreme-admin authorization and only returns pending accounts', async () => {
  const pool = new ApprovalPool();
  const loggedOut = await call(pool, 'GET', '/api/admin/users/pending');
  assert.equal(loggedOut.response.status, 401);

  const regularUser = await call(pool, 'GET', '/api/admin/users/pending', 'pending-user');
  assert.equal(regularUser.response.status, 403);

  const regularAdmin = await call(pool, 'GET', '/api/admin/users/pending', 'regular-admin');
  assert.equal(regularAdmin.response.status, 403);
  assert.deepEqual(regularAdmin.data, { error: 'supreme_admin_access_required' });

  const admin = await call(pool, 'GET', '/api/admin/users/pending', 'sandra-user');
  assert.equal(admin.response.status, 200);
  assert.deepEqual(admin.data.users.map((user) => user.user_id), ['pending-user', 'reject-user']);
  assert.equal(admin.data.users[0].username, 'pending_person');
  assert.equal('email' in admin.data.users[0], false);
});

test('signup without an approval row is repaired and can be approved or declined', async () => {
  const pool = new ApprovalPool();
  pool.users.push(
    { user_id: 'untracked-signup', name: 'Untracked Signup', username: 'untracked_signup' },
    { user_id: 'untracked-decline', name: 'Untracked Decline', username: 'untracked_decline' }
  );
  assert.equal(pool.approvals.has('untracked-signup'), false);
  assert.equal(pool.approvals.has('untracked-decline'), false);

  const accounts = await call(pool, 'GET', '/api/admin/users', 'sandra-user');
  assert.equal(accounts.response.status, 200);
  assert.equal(
    accounts.data.users.find((user) => user.user_id === 'untracked-signup').status,
    'pending'
  );

  const pending = await call(pool, 'GET', '/api/admin/users/pending', 'sandra-user');
  assert.equal(pending.response.status, 200);
  assert.deepEqual(
    pending.data.users.map((user) => user.user_id),
    ['pending-user', 'reject-user', 'untracked-signup', 'untracked-decline']
  );
  assert.equal(pool.approvals.get('untracked-signup').status, 'pending');
  assert.equal(pool.approvals.get('untracked-decline').status, 'pending');

  const approved = await call(
    pool,
    'PATCH',
    '/api/admin/users/untracked-signup/approval',
    'sandra-user',
    { status: 'approved' }
  );
  assert.equal(approved.response.status, 200);
  assert.equal(pool.approvals.get('untracked-signup').status, 'approved');

  const declined = await call(
    pool,
    'PATCH',
    '/api/admin/users/untracked-decline/approval',
    'sandra-user',
    { status: 'rejected' }
  );
  assert.equal(declined.response.status, 200);
  assert.equal(pool.approvals.get('untracked-decline').status, 'rejected');
});

test('admins can view all accounts while approval and role changes require supreme-admin access', async () => {
  const pool = new ApprovalPool();
  const unauthorizedDirectory = await call(pool, 'GET', '/api/admin/directory', 'pending-user');
  assert.equal(unauthorizedDirectory.response.status, 403);
  assert.deepEqual(unauthorizedDirectory.data, { error: 'admin_access_required' });

  const directory = await call(pool, 'GET', '/api/admin/directory', 'regular-admin');
  assert.equal(directory.response.status, 200);
  assert.equal(directory.data.admins.length, 2);

  const nonAdmin = await call(pool, 'GET', '/api/admin/users', 'pending-user');
  assert.equal(nonAdmin.response.status, 403);
  assert.deepEqual(nonAdmin.data, { error: 'admin_access_required' });
  const approvedRegularUser = await call(pool, 'GET', '/api/admin/users', 'other-user');
  assert.equal(approvedRegularUser.response.status, 403);
  assert.deepEqual(approvedRegularUser.data, { error: 'admin_access_required' });

  const regularAccounts = await call(pool, 'GET', '/api/admin/users', 'regular-admin');
  assert.equal(regularAccounts.response.status, 200);
  assert.equal(regularAccounts.data.users.find((user) => user.user_id === 'pending-user').status, 'pending');

  const supremeDirectory = await call(pool, 'GET', '/api/admin/directory', 'sandra-user');
  assert.equal(supremeDirectory.response.status, 200);
  assert.equal(supremeDirectory.data.admins.length, 2);
  assert.equal(supremeDirectory.data.admins.some((admin) => admin.is_supreme_admin), true);

  const users = await call(pool, 'GET', '/api/admin/users', 'sandra-user');
  assert.equal(users.response.status, 200);
  assert.equal(users.data.users.find((user) => user.user_id === 'pending-user').status, 'pending');
  assert.equal(users.data.users.find((user) => user.user_id === 'regular-admin').is_admin, true);
});

test('approved account list is available to admins and excludes pending accounts', async () => {
  const pool = new ApprovalPool();
  pool.users.push({
    user_id: 'legacy-untracked',
    name: 'Legacy Untracked',
    username: 'legacy_untracked',
    created_at: '2026-10-19T10:00:00Z'
  });
  const unauthorized = await call(pool, 'GET', '/api/admin/active-users', 'pending-user');
  assert.equal(unauthorized.response.status, 403);
  assert.deepEqual(unauthorized.data, { error: 'admin_access_required' });

  const activeUsers = await call(pool, 'GET', '/api/admin/active-users', 'regular-admin');
  assert.equal(activeUsers.response.status, 200);
  assert.deepEqual(activeUsers.data.users.map((user) => user.username), ['regular_admin', 'sandra']);
  assert.equal(pool.approvals.get('legacy-untracked').status, 'pending');

  const supremeActiveUsers = await call(pool, 'GET', '/api/admin/active-users', 'sandra-user');
  assert.equal(supremeActiveUsers.response.status, 200);
  assert.deepEqual(supremeActiveUsers.data.users.map((user) => user.username), ['regular_admin', 'sandra']);
});

test('regular admins cannot review pending accounts', async () => {
  const pool = new ApprovalPool();
  const result = await call(
    pool,
    'PATCH',
    '/api/admin/users/pending-user/approval',
    'regular-admin',
    { status: 'approved' }
  );
  assert.equal(result.response.status, 403);
  assert.deepEqual(result.data, { error: 'supreme_admin_access_required' });
  assert.equal(pool.approvals.get('pending-user').status, 'pending');
});

test('supreme admins can grant dashboard access and set supreme role only for admins', async () => {
  const pool = new ApprovalPool();
  const promoted = await call(
    pool,
    'PATCH',
    '/api/admin/users/pending-user/admin',
    'sandra-user',
    { enabled: true }
  );
  assert.equal(promoted.response.status, 200);
  assert.equal(pool.admins.has('pending-user'), true);
  assert.equal(pool.approvals.get('pending-user').status, 'approved');
  assert.equal(pool.auditEvents.some((event) =>
    event.action === 'account.admin_granted' && event.targetId === 'pending-user'
  ), true);

  const madeSupreme = await call(
    pool,
    'PATCH',
    '/api/admin/users/pending-user/supreme',
    'sandra-user',
    { enabled: true }
  );
  assert.equal(madeSupreme.response.status, 200);
  assert.equal(pool.supremeAdmins.has('pending-user'), true);

  const removedSupreme = await call(
    pool,
    'PATCH',
    '/api/admin/users/pending-user/supreme',
    'sandra-user',
    { enabled: false }
  );
  assert.equal(removedSupreme.response.status, 200);
  assert.equal(pool.admins.has('pending-user'), true);

  const removedAdmin = await call(
    pool,
    'PATCH',
    '/api/admin/users/pending-user/admin',
    'sandra-user',
    { enabled: false }
  );
  assert.equal(removedAdmin.response.status, 200);
  assert.equal(pool.admins.has('pending-user'), false);
});

test('role changes enforce authorization, role dependencies, and last-admin safeguards', async () => {
  const pool = new ApprovalPool();
  const forbidden = await call(
    pool,
    'PATCH',
    '/api/admin/users/pending-user/admin',
    'regular-admin',
    { enabled: true }
  );
  assert.equal(forbidden.response.status, 403);

  const invalid = await call(
    pool,
    'PATCH',
    '/api/admin/users/regular-admin/admin',
    'sandra-user',
    { enabled: 'yes' }
  );
  assert.equal(invalid.response.status, 400);

  const lastSupreme = await call(
    pool,
    'PATCH',
    '/api/admin/users/sandra-user/supreme',
    'sandra-user',
    { enabled: false }
  );
  assert.equal(lastSupreme.response.status, 409);
  assert.deepEqual(lastSupreme.data, { error: 'last_supreme_admin_cannot_be_removed' });

  const supremeNeedsAdmin = await call(
    pool,
    'PATCH',
    '/api/admin/users/pending-user/supreme',
    'sandra-user',
    { enabled: true }
  );
  assert.equal(supremeNeedsAdmin.response.status, 409);
  assert.deepEqual(supremeNeedsAdmin.data, { error: 'supreme_admin_must_be_an_admin' });

  const lastAdmin = await call(
    pool,
    'PATCH',
    '/api/admin/users/sandra-user/admin',
    'sandra-user',
    { enabled: false }
  );
  assert.equal(lastAdmin.response.status, 409);
});

test('admin can approve or reject a pending account exactly once', async () => {
  const pool = new ApprovalPool();
  const approved = await call(
    pool,
    'PATCH',
    '/api/admin/users/pending-user/approval',
    'sandra-user',
    { status: 'approved' }
  );
  assert.equal(approved.response.status, 200);
  assert.deepEqual(approved.data.user, {
    user_id: 'pending-user',
    status: 'approved',
    reviewed_at: '2026-10-21T11:00:00Z'
  });
  assert.equal(pool.approvals.get('pending-user').reviewed_by, 'sandra-user');
  assert.equal(pool.auditEvents.some((event) =>
    event.action === 'account.approved' && event.targetId === 'pending-user'
  ), true);

  const repeated = await call(
    pool,
    'PATCH',
    '/api/admin/users/pending-user/approval',
    'sandra-user',
    { status: 'rejected' }
  );
  assert.equal(repeated.response.status, 404);

  const rejected = await call(
    pool,
    'PATCH',
    '/api/admin/users/reject-user/approval',
    'sandra-user',
    { status: 'rejected' }
  );
  assert.equal(rejected.response.status, 200);
  assert.equal(pool.approvals.get('reject-user').status, 'rejected');
});

test('approval updates reject invalid payloads and unauthorized users', async () => {
  const pool = new ApprovalPool();
  const invalid = await call(
    pool,
    'PATCH',
    '/api/admin/users/pending-user/approval',
    'sandra-user',
    { status: 'admin' }
  );
  assert.equal(invalid.response.status, 400);

  const unauthorized = await call(
    pool,
    'PATCH',
    '/api/admin/users/pending-user/approval',
    'pending-user',
    { status: 'approved' }
  );
  assert.equal(unauthorized.response.status, 403);

  const unsupported = await call(pool, 'POST', '/api/admin/users/pending-user/approval', 'sandra-user');
  assert.equal(unsupported.response.status, 405);

  const missingContentType = await call(
    pool,
    'PATCH',
    '/api/admin/users/pending-user/approval',
    'sandra-user',
    { status: 'approved' },
    { contentType: false }
  );
  assert.equal(missingContentType.response.status, 415);

  const untrustedOrigin = await call(
    pool,
    'PATCH',
    '/api/admin/users/pending-user/approval',
    'sandra-user',
    { status: 'approved' },
    { origin: 'https://attacker.example' }
  );
  assert.equal(untrustedOrigin.response.status, 403);

  const oversized = await call(
    pool,
    'PATCH',
    '/api/admin/users/pending-user/approval',
    'sandra-user',
    { status: 'approved', extra: 'x'.repeat(17 * 1024) }
  );
  assert.equal(oversized.response.status, 413);
});

test('approval API ignores unrelated routes', async () => {
  const result = await call(new ApprovalPool(), 'GET', '/api/not-an-approval-route');
  assert.equal(result.handled, false);
});
