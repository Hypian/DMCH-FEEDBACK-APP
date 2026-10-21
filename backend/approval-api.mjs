function sendJson(response, status, body) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(body));
}

function requireTrustedOrigin(request, response) {
  const trustedOrigins = [process.env.FRONTEND_ORIGIN, process.env.BETTER_AUTH_URL]
    .filter(Boolean)
    .map((origin) => new URL(origin).origin);
  if (!request.headers.origin || !trustedOrigins.includes(request.headers.origin)) {
    sendJson(response, 403, { error: 'invalid_origin' });
    return false;
  }
  return true;
}

async function readJson(request, response) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16 * 1024) {
      const error = new Error('Request body is too large.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

async function requireAdmin(request, response, pool, getAuthSession) {
  const session = await getAuthSession(request.headers);
  if (!session?.user) {
    sendJson(response, 401, { error: 'authentication_required' });
    return null;
  }
  const result = await pool.query(
    'select 1 from public.feedback_admins where user_id = $1',
    [session.user.id]
  );
  if (result.rowCount === 0) {
    sendJson(response, 403, { error: 'admin_access_required' });
    return null;
  }
  return session;
}

export async function createPendingApproval(pool, userId) {
  await pool.query(
    `insert into public.feedback_account_approvals (user_id, status)
     values ($1, 'pending') on conflict (user_id) do nothing`,
    [userId]
  );
}

export async function getAccountApproval(pool, userId) {
  const admin = await pool.query(
    'select 1 from public.feedback_admins where user_id = $1',
    [userId]
  );
  if (admin.rowCount > 0) return 'approved';

  await createPendingApproval(pool, userId);
  const result = await pool.query(
    'select status from public.feedback_account_approvals where user_id = $1',
    [userId]
  );
  return result.rows[0]?.status || 'pending';
}

export async function handleApprovalApi(request, response, url, { pool, getAuthSession }) {
  const { pathname } = url;
  if (pathname === '/api/account/status') {
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      sendJson(response, 405, { error: 'method_not_allowed' });
      return true;
    }
    const session = await getAuthSession(request.headers);
    if (!session?.user) {
      sendJson(response, 401, { error: 'authentication_required' });
      return true;
    }
    const status = await getAccountApproval(pool, session.user.id);
    sendJson(response, 200, { status });
    return true;
  }

  if (pathname === '/api/admin/users/pending') {
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      sendJson(response, 405, { error: 'method_not_allowed' });
      return true;
    }
    const adminSession = await requireAdmin(request, response, pool, getAuthSession);
    if (!adminSession) return true;
    const result = await pool.query(
      `select approval.user_id, auth_user.name, auth_user.email, auth_user.phone, approval.created_at
       from public.feedback_account_approvals as approval
       join public."user" as auth_user on auth_user.id = approval.user_id
       where approval.status = 'pending'
       order by approval.created_at asc`
    );
    sendJson(response, 200, { users: result.rows });
    return true;
  }

  const approvalMatch = pathname.match(/^\/api\/admin\/users\/([A-Za-z0-9_-]+)\/approval$/);
  if (!approvalMatch) return false;
  if (request.method !== 'PATCH') {
    response.setHeader('Allow', 'PATCH');
    sendJson(response, 405, { error: 'method_not_allowed' });
    return true;
  }
  const adminSession = await requireAdmin(request, response, pool, getAuthSession);
  if (!adminSession) return true;
  if (!requireTrustedOrigin(request, response)) return true;
  if (!request.headers['content-type']?.startsWith('application/json')) {
    sendJson(response, 415, { error: 'content_type_must_be_json' });
    return true;
  }
  let body;
  try {
    body = await readJson(request, response);
  } catch (error) {
    if (error.status !== 413) throw error;
    sendJson(response, 413, { error: 'request_body_too_large' });
    return true;
  }
  if (!body || !['approved', 'rejected'].includes(body.status)) {
    sendJson(response, 400, { error: 'invalid_approval_status' });
    return true;
  }

  const result = await pool.query(
    `update public.feedback_account_approvals
     set status = $2, reviewed_at = now(), reviewed_by = $3
     where user_id = $1 and status = 'pending'
     returning user_id, status, reviewed_at`,
    [approvalMatch[1], body.status, adminSession.user.id]
  );
  if (result.rowCount === 0) {
    sendJson(response, 404, { error: 'pending_user_not_found' });
    return true;
  }
  sendJson(response, 200, { user: result.rows[0] });
  return true;
}
