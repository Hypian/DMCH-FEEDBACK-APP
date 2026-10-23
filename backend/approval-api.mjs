import { recordAuditEvent } from './audit-log.mjs';

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

export async function ensureSupremeAdminBootstrap(pool) {
  try {
    const supremeCount = await pool.query(
      'select count(*)::int as total from public.feedback_supreme_admins'
    );
    if (supremeCount.rows?.[0]?.total === 0) {
      await pool.query(`
        insert into public.feedback_supreme_admins (user_id)
        select user_id from public.feedback_admins
        order by created_at asc
        limit 1
        on conflict (user_id) do nothing
      `);
    }
  } catch {
    // Graceful fallback for mock tests or before table initialization
  }
}

async function requireSupremeAdmin(request, response, pool, getAuthSession) {
  const session = await requireAdmin(request, response, pool, getAuthSession);
  if (!session) return null;
  await ensureSupremeAdminBootstrap(pool);
  const result = await pool.query(
    'select 1 from public.feedback_supreme_admins where user_id = $1',
    [session.user.id]
  );
  if (result.rowCount === 0) {
    sendJson(response, 403, { error: 'supreme_admin_access_required' });
    return null;
  }
  return session;
}

export async function requireApprovedAccount(request, response, pool, getAuthSession) {
  const session = await getAuthSession(request.headers);
  if (!session?.user) {
    sendJson(response, 401, { error: 'authentication_required' });
    return null;
  }
  const status = await getAccountApproval(pool, session.user.id);
  if (status !== 'approved') {
    sendJson(response, 403, { error: 'account_approval_required', status });
    return null;
  }
  await ensureSupremeAdminBootstrap(pool);
  const admin = await pool.query(
    'select 1 from public.feedback_admins where user_id = $1',
    [session.user.id]
  );
  const supreme = admin.rowCount > 0
    ? await pool.query(
      'select 1 from public.feedback_supreme_admins where user_id = $1',
      [session.user.id]
    )
    : { rowCount: 0 };
  return {
    session,
    isAdmin: admin.rowCount > 0,
    isSupremeAdmin: supreme.rowCount > 0
  };
}

export async function createPendingApproval(pool, userId) {
  await pool.query(
    `with approval as (
       insert into public.feedback_account_approvals (user_id, status)
       values ($1, 'pending') on conflict (user_id) do nothing
       returning user_id
     )
     insert into public.feedback_audit_events
       (actor_user_id, action, summary, target_type, target_id, metadata)
     select user_id, 'account.created', 'Account created and submitted for approval.',
            'account', user_id, '{}'::jsonb
     from approval`,
    [userId]
  );
}

async function ensurePendingApprovals(pool) {
  await pool.query(
    `insert into public.feedback_account_approvals (user_id, status)
     select auth_user.id, 'pending'
     from public."user" as auth_user
     left join public.feedback_admins as admin on admin.user_id = auth_user.id
     where admin.user_id is null
       and not exists (
         select 1
         from public.feedback_account_approvals as approval
         where approval.user_id = auth_user.id
       )
     on conflict (user_id) do nothing`
  );
}

export async function getAccountApproval(pool, userId) {
  const existing = await pool.query(
    'select status from public.feedback_account_approvals where user_id = $1',
    [userId]
  );
  if (existing.rows[0]?.status === 'deactivated') {
    return 'deactivated';
  }
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
  if (pathname === '/api/dashboard/session') {
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      sendJson(response, 405, { error: 'method_not_allowed' });
      return true;
    }
    const account = await requireApprovedAccount(request, response, pool, getAuthSession);
    if (!account) return true;
    sendJson(response, 200, {
      user: {
        id: account.session.user.id,
        name: account.session.user.name,
        username: account.session.user.username
      },
      isAdmin: account.isAdmin,
      isSupremeAdmin: account.isSupremeAdmin
    });
    return true;
  }

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

  if (pathname === '/api/admin/directory') {
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      sendJson(response, 405, { error: 'method_not_allowed' });
      return true;
    }
    if (!await requireAdmin(request, response, pool, getAuthSession)) return true;
    const result = await pool.query(
      `select auth_user.name, auth_user.username, supreme.user_id is not null as is_supreme_admin
       from public.feedback_admins as admin
       join public."user" as auth_user on auth_user.id = admin.user_id
       left join public.feedback_supreme_admins as supreme on supreme.user_id = admin.user_id
       order by auth_user.name asc, auth_user.username asc`
    );
    sendJson(response, 200, { admins: result.rows });
    return true;
  }

  if (pathname === '/api/admin/active-users') {
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      sendJson(response, 405, { error: 'method_not_allowed' });
      return true;
    }
    if (!await requireAdmin(request, response, pool, getAuthSession)) return true;
    await ensurePendingApprovals(pool);
    const result = await pool.query(
      `select auth_user.name, auth_user.username
       from public."user" as auth_user
       left join public.feedback_account_approvals as approval on approval.user_id = auth_user.id
       left join public.feedback_admins as admin on admin.user_id = auth_user.id
       where approval.status = 'approved' or admin.user_id is not null
       order by auth_user.name asc, auth_user.username asc`
    );
    sendJson(response, 200, { users: result.rows });
    return true;
  }

  if (pathname === '/api/admin/users') {
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      sendJson(response, 405, { error: 'method_not_allowed' });
      return true;
    }
    if (!await requireAdmin(request, response, pool, getAuthSession)) return true;
    await ensurePendingApprovals(pool);
    const result = await pool.query(
      `select auth_user.id as user_id, auth_user.name, auth_user.username,
              case when approval.status = 'deactivated' then 'deactivated'
                   when admin.user_id is not null then 'approved'
                   else coalesce(approval.status, 'pending')
              end as status,
              approval.created_at,
              admin.user_id is not null as is_admin,
              supreme.user_id is not null as is_supreme_admin
       from public."user" as auth_user
       left join public.feedback_account_approvals as approval on approval.user_id = auth_user.id
       left join public.feedback_admins as admin on admin.user_id = auth_user.id
       left join public.feedback_supreme_admins as supreme on supreme.user_id = auth_user.id
       order by auth_user.name asc, auth_user.username asc`
    );
    sendJson(response, 200, { users: result.rows });
    return true;
  }

  if (pathname === '/api/admin/users/pending') {
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      sendJson(response, 405, { error: 'method_not_allowed' });
      return true;
    }
    const adminSession = await requireSupremeAdmin(request, response, pool, getAuthSession);
    if (!adminSession) return true;
    await ensurePendingApprovals(pool);
    const result = await pool.query(
      `select approval.user_id, auth_user.name, auth_user.username, approval.created_at
       from public.feedback_account_approvals as approval
       join public."user" as auth_user on auth_user.id = approval.user_id
       where approval.status = 'pending'
       order by approval.created_at asc`
    );
    sendJson(response, 200, { users: result.rows });
    return true;
  }

  const userDeleteMatch = pathname.match(/^\/api\/admin\/users\/([A-Za-z0-9_-]+)$/);
  if (userDeleteMatch) {
    if (request.method !== 'DELETE') {
      response.setHeader('Allow', 'DELETE');
      sendJson(response, 405, { error: 'method_not_allowed' });
      return true;
    }
    const adminSession = await requireSupremeAdmin(request, response, pool, getAuthSession);
    if (!adminSession) return true;
    if (!requireTrustedOrigin(request, response)) return true;
    const targetUserId = userDeleteMatch[1];
    if (targetUserId === adminSession.user.id) {
      sendJson(response, 400, { error: 'cannot_delete_own_account' });
      return true;
    }
    const client = await pool.connect();
    let transactionStarted = false;
    try {
      await client.query('begin');
      transactionStarted = true;
      await client.query('select pg_advisory_xact_lock($1)', [74192831]);
      const targetUser = await client.query(
        'select id, name, username from public."user" where id = $1',
        [targetUserId]
      );
      if (targetUser.rowCount === 0) {
        await client.query('rollback');
        sendJson(response, 404, { error: 'user_not_found' });
        return true;
      }
      const targetSupreme = await client.query(
        'select 1 from public.feedback_supreme_admins where user_id = $1',
        [targetUserId]
      );
      if (targetSupreme.rowCount > 0) {
        const count = await client.query(
          'select count(*)::int as total from public.feedback_supreme_admins'
        );
        if (count.rows[0].total <= 1) {
          await client.query('rollback');
          sendJson(response, 409, { error: 'last_supreme_admin_cannot_be_removed' });
          return true;
        }
        await client.query(
          'delete from public.feedback_supreme_admins where user_id = $1',
          [targetUserId]
        );
      }
      const targetAdmin = await client.query(
        'select 1 from public.feedback_admins where user_id = $1',
        [targetUserId]
      );
      if (targetAdmin.rowCount > 0) {
        const count = await client.query(
          'select count(*)::int as total from public.feedback_admins'
        );
        if (count.rows[0].total <= 1) {
          await client.query('rollback');
          sendJson(response, 409, { error: 'last_admin_cannot_be_removed' });
          return true;
        }
        await client.query(
          'delete from public.feedback_admins where user_id = $1',
          [targetUserId]
        );
      }
      await client.query(
        'delete from public.feedback_account_approvals where user_id = $1',
        [targetUserId]
      );
      try {
        await client.query(
          'delete from public."session" where "userId" = $1',
          [targetUserId]
        );
      } catch {}
      await client.query(
        'delete from public."user" where id = $1',
        [targetUserId]
      );
      await recordAuditEvent(client, {
        actorId: adminSession.user.id,
        action: 'account.deleted',
        summary: `Permanently deleted account ${targetUser.rows[0]?.username || targetUserId}.`,
        targetType: 'account',
        targetId: targetUserId,
        metadata: {
          username: targetUser.rows[0]?.username,
          name: targetUser.rows[0]?.name
        }
      });
      await client.query('commit');
      transactionStarted = false;
      sendJson(response, 200, { deleted: true, userId: targetUserId });
      return true;
    } catch (error) {
      if (transactionStarted) await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  const roleMatch = pathname.match(/^\/api\/admin\/users\/([A-Za-z0-9_-]+)\/(admin|supreme)$/);
  const approvalMatch = pathname.match(/^\/api\/admin\/users\/([A-Za-z0-9_-]+)\/approval$/);
  const statusMatch = pathname.match(/^\/api\/admin\/users\/([A-Za-z0-9_-]+)\/status$/);
  const deactivateMatch = pathname.match(/^\/api\/admin\/users\/([A-Za-z0-9_-]+)\/deactivate$/);
  if (!approvalMatch && !roleMatch && !statusMatch && !deactivateMatch) return false;
  if (request.method !== 'PATCH') {
    response.setHeader('Allow', 'PATCH');
    sendJson(response, 405, { error: 'method_not_allowed' });
    return true;
  }
  const adminSession = await requireSupremeAdmin(request, response, pool, getAuthSession);
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
  if (statusMatch || deactivateMatch) {
    const targetUserId = (statusMatch || deactivateMatch)[1];
    let targetStatus = null;
    if (statusMatch) {
      if (body?.status === 'approved' || body?.status === 'deactivated') {
        targetStatus = body.status;
      }
    } else if (deactivateMatch) {
      if (typeof body?.deactivated === 'boolean') {
        targetStatus = body.deactivated ? 'deactivated' : 'approved';
      }
    }
    if (!targetStatus) {
      sendJson(response, 400, { error: 'invalid_status' });
      return true;
    }
    if (targetUserId === adminSession.user.id && targetStatus === 'deactivated') {
      sendJson(response, 400, { error: 'cannot_deactivate_own_account' });
      return true;
    }
    const client = await pool.connect();
    let transactionStarted = false;
    try {
      await client.query('begin');
      transactionStarted = true;
      await client.query('select pg_advisory_xact_lock($1)', [74192831]);
      const targetUser = await client.query(
        'select 1 from public."user" where id = $1',
        [targetUserId]
      );
      if (targetUser.rowCount === 0) {
        await client.query('rollback');
        sendJson(response, 404, { error: 'user_not_found' });
        return true;
      }
      if (targetStatus === 'deactivated') {
        const targetSupreme = await client.query(
          'select 1 from public.feedback_supreme_admins where user_id = $1',
          [targetUserId]
        );
        if (targetSupreme.rowCount > 0) {
          await client.query('rollback');
          sendJson(response, 409, { error: 'supreme_admin_must_be_demoted_first' });
          return true;
        }
        const targetAdmin = await client.query(
          'select 1 from public.feedback_admins where user_id = $1',
          [targetUserId]
        );
        if (targetAdmin.rowCount > 0) {
          const count = await client.query(
            'select count(*)::int as total from public.feedback_admins'
          );
          if (count.rows[0].total <= 1) {
            await client.query('rollback');
            sendJson(response, 409, { error: 'last_admin_cannot_be_removed' });
            return true;
          }
          await client.query(
            'delete from public.feedback_admins where user_id = $1',
            [targetUserId]
          );
        }
      }
      const result = await client.query(
        `insert into public.feedback_account_approvals
           (user_id, status, reviewed_at, reviewed_by)
         values ($1, $2, now(), $3)
         on conflict (user_id) do update
           set status = $2, reviewed_at = now(), reviewed_by = $3
         returning user_id, status, reviewed_at`,
        [targetUserId, targetStatus, adminSession.user.id]
      );
      await recordAuditEvent(client, {
        actorId: adminSession.user.id,
        action: `account.${targetStatus === 'deactivated' ? 'deactivated' : 'reactivated'}`,
        summary: `${targetStatus === 'deactivated' ? 'Deactivated' : 'Reactivated'} account ${targetUserId}.`,
        targetType: 'account',
        targetId: targetUserId,
        metadata: { status: targetStatus }
      });
      await client.query('commit');
      transactionStarted = false;
      sendJson(response, 200, { user: result.rows[0] });
      return true;
    } catch (error) {
      if (transactionStarted) await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
  if (roleMatch) {
    if (typeof body?.enabled !== 'boolean') {
      sendJson(response, 400, { error: `invalid_${roleMatch[2]}_status` });
      return true;
    }
    const client = await pool.connect();
    let transactionStarted = false;
    try {
      await client.query('begin');
      transactionStarted = true;
      await client.query('select pg_advisory_xact_lock($1)', [74192831]);
      const targetUser = await client.query(
        'select 1 from public."user" where id = $1',
        [roleMatch[1]]
      );
      if (targetUser.rowCount === 0) {
        await client.query('rollback');
        sendJson(response, 404, { error: 'user_not_found' });
        return true;
      }
      if (roleMatch[2] === 'admin') {
        if (body.enabled) {
          await client.query(
            `insert into public.feedback_admins (user_id)
             values ($1) on conflict (user_id) do nothing`,
            [roleMatch[1]]
          );
          await client.query(
            `insert into public.feedback_account_approvals
               (user_id, status, reviewed_at, reviewed_by)
             values ($1, 'approved', now(), $2)
             on conflict (user_id) do update
               set status = 'approved', reviewed_at = now(), reviewed_by = $2`,
            [roleMatch[1], adminSession.user.id]
          );
        } else {
          const targetSupreme = await client.query(
            'select 1 from public.feedback_supreme_admins where user_id = $1',
            [roleMatch[1]]
          );
          if (targetSupreme.rowCount > 0) {
            await client.query('rollback');
            sendJson(response, 409, { error: 'supreme_admin_must_be_demoted_first' });
            return true;
          }
          const count = await client.query(
            'select count(*)::int as total from public.feedback_admins'
          );
          const targetAdmin = await client.query(
            'select 1 from public.feedback_admins where user_id = $1',
            [roleMatch[1]]
          );
          if (targetAdmin.rowCount > 0 && count.rows[0].total <= 1) {
            await client.query('rollback');
            sendJson(response, 409, { error: 'last_admin_cannot_be_removed' });
            return true;
          }
          await client.query(
            'delete from public.feedback_admins where user_id = $1',
            [roleMatch[1]]
          );
        }
      } else {
        const targetAdmin = await client.query(
          'select 1 from public.feedback_admins where user_id = $1',
          [roleMatch[1]]
        );
        if (body.enabled && targetAdmin.rowCount === 0) {
          await client.query('rollback');
          sendJson(response, 409, { error: 'supreme_admin_must_be_an_admin' });
          return true;
        }
        if (body.enabled) {
          await client.query(
            `insert into public.feedback_supreme_admins (user_id)
             values ($1) on conflict (user_id) do nothing`,
            [roleMatch[1]]
          );
        } else {
          const count = await client.query(
            'select count(*)::int as total from public.feedback_supreme_admins'
          );
          const targetSupreme = await client.query(
            'select 1 from public.feedback_supreme_admins where user_id = $1',
            [roleMatch[1]]
          );
          if (targetSupreme.rowCount > 0 && count.rows[0].total <= 1) {
            await client.query('rollback');
            sendJson(response, 409, { error: 'last_supreme_admin_cannot_be_removed' });
            return true;
          }
          await client.query(
            'delete from public.feedback_supreme_admins where user_id = $1',
            [roleMatch[1]]
          );
        }
      }
      await recordAuditEvent(client, {
        actorId: adminSession.user.id,
        action: `account.${roleMatch[2]}_${body.enabled ? 'granted' : 'revoked'}`,
        summary: `${body.enabled ? 'Granted' : 'Revoked'} ${roleMatch[2]} access for account ${roleMatch[1]}.`,
        targetType: 'account',
        targetId: roleMatch[1],
        metadata: { role: roleMatch[2], enabled: body.enabled }
      });
      await client.query('commit');
      transactionStarted = false;
    } catch (error) {
      if (transactionStarted) await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    sendJson(response, 200, {
      user: {
        user_id: roleMatch[1],
        [roleMatch[2] === 'admin' ? 'is_admin' : 'is_supreme_admin']: body.enabled
      }
    });
    return true;
  }

  if (!body || !['approved', 'rejected'].includes(body.status)) {
    sendJson(response, 400, { error: 'invalid_approval_status' });
    return true;
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await client.query(
      `update public.feedback_account_approvals
       set status = $2, reviewed_at = now(), reviewed_by = $3
       where user_id = $1 and status = 'pending'
       returning user_id, status, reviewed_at`,
      [approvalMatch[1], body.status, adminSession.user.id]
    );
    if (result.rowCount === 0) {
      await client.query('rollback');
      sendJson(response, 404, { error: 'pending_user_not_found' });
      return true;
    }
    await recordAuditEvent(client, {
      actorId: adminSession.user.id,
      action: `account.${body.status}`,
      summary: `${body.status === 'approved' ? 'Approved' : 'Declined'} account ${approvalMatch[1]}.`,
      targetType: 'account',
      targetId: approvalMatch[1],
      metadata: { status: body.status }
    });
    await client.query('commit');
    sendJson(response, 200, { user: result.rows[0] });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
  return true;
}
