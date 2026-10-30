import crypto from 'node:crypto';
import { authNodeHandler, pool, getAuthSession } from './neon-auth.mjs';
import { getAccountApproval, handleApprovalApi, requireApprovedAccount, validateSessionActivity } from './approval-api.mjs';
import { recordAuditEvent } from './audit-log.mjs';
import { analyzeFeedback } from './sentiment-analyzer.mjs';
import { notifyUrgentFeedback } from './urgent-alert.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hashSecret = process.env.DMC_DEVICE_HASH_SECRET;
const responseFields = 'id, submitted_at, language, department_id, department_name, answers, is_demo, user_id, sentiment, urgent, urgent_reason, urgent_signals, analysis_source, detected_language';

if (!hashSecret || Buffer.byteLength(hashSecret, 'utf8') < 32) {
  throw new Error('DMC_DEVICE_HASH_SECRET must be configured with at least 32 bytes.');
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

function requireJson(request, response) {
  if (!request.headers['content-type']?.startsWith('application/json')) {
    sendJson(response, 415, { error: 'content_type_must_be_json' });
    return false;
  }
  return true;
}

function requireSameOrigin(request, response) {
  const origin = request.headers.origin;
  const trustedOrigins = [
    process.env.FRONTEND_ORIGIN,
    process.env.BETTER_AUTH_URL
  ].filter(Boolean).map((trustedOrigin) => new URL(trustedOrigin).origin);
  if (!origin || !trustedOrigins.includes(new URL(origin).origin)) {
    sendJson(response, 403, { error: 'invalid_origin' });
    return false;
  }
  return true;
}

function getDeviceHash(value) {
  if (typeof value !== 'string' || !DEVICE_ID_PATTERN.test(value)) return null;
  return crypto.createHmac('sha256', hashSecret).update(value.toLowerCase()).digest('hex');
}

async function getAdminSession(request, response) {
  const session = await getAuthSession(request.headers);
  if (!session?.user) {
    sendJson(response, 401, { error: 'authentication_required' });
    return null;
  }
  const activity = await validateSessionActivity(session, request, pool);
  if (!activity.valid) {
    sendJson(response, 401, { error: activity.error, message: activity.message });
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

async function checkDevice(deviceId) {
  const deviceHash = getDeviceHash(deviceId);
  if (!deviceHash) return { status: 400, body: { error: 'invalid_device_id' } };
  const result = await pool.query(
    'select submitted_at from public.device_submissions where device_hash = $1',
    [deviceHash]
  );
  if (result.rowCount === 0) return { status: 200, body: { available: true } };
  const submittedAt = new Date(result.rows[0].submitted_at).getTime();
  const retryAfterMs = DAY_MS - (Date.now() - submittedAt);
  if (retryAfterMs <= 0) return { status: 200, body: { available: true } };
  return {
    status: 409,
    body: {
      error: 'duplicate_submission',
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000)
    }
  };
}

async function saveFeedback(body) {
  const deviceHash = getDeviceHash(body.deviceId);
  if (!deviceHash) return { status: 400, body: { error: 'invalid_device_id' } };
  if (!['en', 'fr', 'rw'].includes(body.language)
    || typeof body.departmentId !== 'string'
    || !body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers)) {
    return { status: 400, body: { error: 'invalid_feedback' } };
  }
  const session = await getAuthSession(body.headers);
  if (session?.user && await getAccountApproval(pool, session.user.id) !== 'approved') {
    return { status: 403, body: { error: 'account_approval_pending' } };
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    const accepted = await client.query(
      `insert into public.device_submissions (device_hash, submitted_at)
       values ($1, now())
       on conflict (device_hash) do update
         set submitted_at = excluded.submitted_at
         where public.device_submissions.submitted_at <= now() - interval '24 hours'
       returning device_hash`,
      [deviceHash]
    );
    if (accepted.rowCount === 0) {
      await client.query('rollback');
      return await checkDevice(body.deviceId);
    }

    const department = await client.query(
      `select labels from public.feedback_departments
       where id = $1 and is_active = true`,
      [body.departmentId]
    );
    if (department.rowCount === 0) {
      await client.query('rollback');
      return { status: 400, body: { error: 'invalid_department' } };
    }
    const labels = department.rows[0].labels;
    const feedbackText = [body.answers?.q10, body.answers?.q9, body.text, body.comment]
      .filter((v) => typeof v === 'string' && v.trim().length > 0)
      .join('\n');
    const analysis = await analyzeFeedback(feedbackText, { language: body.language });

    const inserted = await client.query(
      `insert into public.feedback_responses
        (language, department_id, department_name, answers, user_id, sentiment, urgent, urgent_reason, urgent_signals, analysis_source, detected_language)
       values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9::jsonb, $10, $11)
       returning id`,
      [
        body.language,
        body.departmentId,
        labels[0],
        JSON.stringify(body.answers),
        session?.user?.id || null,
        analysis.sentiment,
        analysis.urgent,
        analysis.reason,
        JSON.stringify(analysis.signals),
        analysis.analysis_source,
        analysis.language
      ]
    );

    if (analysis.urgent) {
      await notifyUrgentFeedback(client, {
        feedbackId: inserted.rows[0]?.id,
        departmentId: body.departmentId,
        departmentName: labels[0],
        language: body.language,
        text: feedbackText,
        analysis
      });
    }

    await recordAuditEvent(client, {
      actorId: session?.user?.id || null,
      action: 'feedback.submitted',
      summary: `Feedback submitted for ${labels[0]}.`,
      targetType: 'feedback',
      targetId: inserted.rows[0]?.id || null,
      metadata: {
        departmentId: body.departmentId,
        language: body.language,
        sentiment: analysis.sentiment,
        urgent: analysis.urgent
      }
    });
    await client.query('commit');
    return { status: 201, body: { ok: true } };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function validateAdminMethod(request, response) {
  if (!['POST', 'PATCH', 'DELETE'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    sendJson(response, 405, { error: 'method_not_allowed' });
    return false;
  }
  return requireSameOrigin(request, response);
}

export async function handleNeonApi(request, response, url) {
  const pathname = url.pathname;
  if (await handleApprovalApi(request, response, url, { pool, getAuthSession })) return true;

  if (pathname === '/api/check') {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      sendJson(response, 405, { error: 'method_not_allowed' });
      return true;
    }
    if (!requireJson(request, response)) return true;
    const body = await readJson(request);
    const result = await checkDevice(body.deviceId);
    sendJson(response, result.status, result.body);
    return true;
  }

  if (pathname === '/api/submit') {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      sendJson(response, 405, { error: 'method_not_allowed' });
      return true;
    }
    if (!requireJson(request, response) || !requireSameOrigin(request, response)) return true;
    const body = await readJson(request);
    const result = await saveFeedback({ ...body, headers: request.headers });
    sendJson(response, result.status, result.body);
    return true;
  }

  if (pathname === '/api/admin/audit') {
    if (request.method === 'POST') {
      if (!validateAdminMethod(request, response)) return true;
      const account = await requireApprovedAccount(request, response, pool, getAuthSession);
      if (!account) return true;
      if (!requireJson(request, response)) return true;
      const body = await readJson(request);
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || !['full', 'departments', 'patients', 'visuals', 'executive'].includes(body.type)
        || !['csv', 'xlsx', 'pptx'].includes(body.format)) {
        sendJson(response, 400, { error: 'invalid_report_export' });
        return true;
      }
      await recordAuditEvent(pool, {
        actorId: account.session.user.id,
        action: 'report.exported',
        summary: `Exported the ${body.type} report as ${body.format.toUpperCase()}.`,
        targetType: 'report',
        targetId: body.type,
        metadata: { format: body.format }
      });
      sendJson(response, 201, { ok: true });
      return true;
    }
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET, POST');
      sendJson(response, 405, { error: 'method_not_allowed' });
      return true;
    }
    if (!await requireApprovedAccount(request, response, pool, getAuthSession)) return true;
    const result = await pool.query(
      `select audit_entry.id, audit_entry.created_at, audit_entry.action, audit_entry.summary,
              audit_entry.target_type, audit_entry.target_id, audit_entry.metadata,
              case
                when audit_entry.actor_user_id is null then 'Anonymous patient'
                else coalesce(auth_user.name, auth_user.username, 'Former account')
              end as actor,
              target_user.name as target_name,
              target_user.username as target_username
       from public.feedback_audit_events as audit_entry
       left join public."user" as auth_user on auth_user.id = audit_entry.actor_user_id
       left join public."user" as target_user on target_user.id = audit_entry.target_id and audit_entry.target_type = 'account'
       order by audit_entry.created_at desc, audit_entry.id desc
       limit 500`
    );
    sendJson(response, 200, result.rows);
    return true;
  }

  if (pathname === '/api/departments' && request.method === 'GET') {
    const includeInactive = url.searchParams.get('all') === '1';
    if (includeInactive && !await requireApprovedAccount(request, response, pool, getAuthSession)) return true;
    const result = await pool.query(
      `select id, labels, is_active, sort_order
       from public.feedback_departments
       ${includeInactive ? '' : 'where is_active = true'}
       order by sort_order asc`
    );
    sendJson(response, 200, result.rows);
    return true;
  }

  const responseMatch = pathname.match(/^\/api\/responses\/([0-9a-f-]+)$/i);
  if (responseMatch && request.method === 'DELETE') {
    if (!validateAdminMethod(request, response)) return true;
    const session = await getAdminSession(request, response);
    if (!session) return true;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(responseMatch[1])) {
      sendJson(response, 400, { error: 'invalid_response_id' });
      return true;
    }
    const client = await pool.connect();
    try {
      await client.query('begin');
      const result = await client.query(
        'delete from public.feedback_responses where id = $1 returning id',
        [responseMatch[1]]
      );
      if (result.rowCount === 0) {
        await client.query('rollback');
        sendJson(response, 404, { error: 'response_not_found' });
        return true;
      }
      await recordAuditEvent(client, {
        actorId: session.user.id,
        action: 'feedback.deleted',
        summary: 'Deleted a feedback submission.',
        targetType: 'feedback',
        targetId: result.rows[0].id
      });
      await client.query('commit');
      sendJson(response, 200, { ok: true, id: result.rows[0].id });
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    return true;
  }

  if (pathname === '/api/responses' && request.method === 'DELETE') {
    if (!validateAdminMethod(request, response)) return true;
    const session = await getAdminSession(request, response);
    if (!session) return true;
    const client = await pool.connect();
    try {
      await client.query('begin');
      const result = await client.query('delete from public.feedback_responses');
      await recordAuditEvent(client, {
        actorId: session.user.id,
        action: 'feedback.cleared',
        summary: `Cleared ${result.rowCount} feedback submissions.`,
        targetType: 'feedback',
        metadata: { count: result.rowCount }
      });
      await client.query('commit');
      sendJson(response, 200, { ok: true, deleted: result.rowCount });
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    return true;
  }

  if (pathname === '/api/responses' && request.method === 'GET') {
    if (!await requireApprovedAccount(request, response, pool, getAuthSession)) return true;
    const result = await pool.query(
      `select ${responseFields} from public.feedback_responses
       order by submitted_at asc`
    );
    sendJson(response, 200, result.rows);
    return true;
  }

  if (pathname === '/api/my-responses' && request.method === 'GET') {
    const session = await getAuthSession(request.headers);
    if (!session?.user) {
      sendJson(response, 401, { error: 'authentication_required' });
      return true;
    }
    const approvalStatus = await getAccountApproval(pool, session.user.id);
    if (approvalStatus !== 'approved') {
      sendJson(response, 403, { error: 'account_approval_pending', status: approvalStatus });
      return true;
    }
    const result = await pool.query(
      `select ${responseFields} from public.feedback_responses
       where user_id = $1 order by submitted_at desc`,
      [session.user.id]
    );
    sendJson(response, 200, result.rows);
    return true;
  }

  if (pathname.startsWith('/api/admin/')) {
    if (!validateAdminMethod(request, response)) return true;
    const adminSession = await getAdminSession(request, response);
    if (!adminSession) return true;
    if (request.method !== 'DELETE' && !requireJson(request, response)) return true;
    const body = request.method === 'DELETE' ? {} : await readJson(request);

    if (pathname === '/api/admin/departments' && request.method === 'POST') {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 120) {
        sendJson(response, 400, { error: 'invalid_department_name' });
        return true;
      }
      const id = `x${crypto.randomUUID().replace(/-/g, '')}`;
      const client = await pool.connect();
      let result;
      try {
        await client.query('begin');
        result = await client.query(
          `insert into public.feedback_departments (id, labels, sort_order)
           values ($1, $2::jsonb, coalesce((select max(sort_order) + 1 from public.feedback_departments), 0))
           returning id, labels, is_active, sort_order`,
          [id, JSON.stringify([name, name, name])]
        );
        await recordAuditEvent(client, {
          actorId: adminSession.user.id,
          action: 'department.created',
          summary: `Added the ${name} service.`,
          targetType: 'department',
          targetId: id
        });
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
      sendJson(response, 201, result.rows[0]);
      return true;
    }

    const departmentMatch = pathname.match(/^\/api\/admin\/departments\/([a-zA-Z0-9_-]+)$/);
    if (departmentMatch && request.method === 'PATCH') {
      if (typeof body.active !== 'boolean') {
        sendJson(response, 400, { error: 'invalid_department_status' });
        return true;
      }
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await client.query(
          `update public.feedback_departments set is_active = $2 where id = $1
           returning id, labels, is_active, sort_order`,
          [departmentMatch[1], body.active]
        );
        if (result.rowCount === 0) {
          await client.query('rollback');
          sendJson(response, 404, { error: 'department_not_found' });
          return true;
        }
        const label = result.rows[0].labels[0];
        await recordAuditEvent(client, {
          actorId: adminSession.user.id,
          action: body.active ? 'department.activated' : 'department.deactivated',
          summary: `${body.active ? 'Restored' : 'Deactivated'} the ${label} service.`,
          targetType: 'department',
          targetId: departmentMatch[1]
        });
        await client.query('commit');
        sendJson(response, 200, result.rows[0]);
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
      return true;
    }

    if (departmentMatch && request.method === 'DELETE') {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await client.query(
          'delete from public.feedback_departments where id = $1 returning id, labels',
          [departmentMatch[1]]
        );
        if (result.rowCount === 0) {
          await client.query('rollback');
          sendJson(response, 404, { error: 'department_not_found' });
          return true;
        }
        const label = result.rows[0].labels[0];
        await recordAuditEvent(client, {
          actorId: adminSession.user.id,
          action: 'department.deleted',
          summary: `Deleted the ${label} service.`,
          targetType: 'department',
          targetId: departmentMatch[1]
        });
        await client.query('commit');
        sendJson(response, 200, { deleted: true, id: departmentMatch[1] });
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
      return true;
    }

    if (pathname === '/api/admin/demo' && request.method === 'POST') {
      const result = await pool.query('select id, labels from public.feedback_departments where is_active = true');
      if (!result.rows.length) {
        sendJson(response, 409, { error: 'no_active_departments' });
        return true;
      }
      const choices = ['Great service', 'Waiting time was too long', 'Clean and calm environment', 'Please add more parking', 'Doctor was very patient and professional', ''];
      const client = await pool.connect();
      try {
        await client.query('begin');
        for (let index = 0; index < 60; index += 1) {
          const department = result.rows[Math.floor(Math.random() * result.rows.length)];
          const pick = (count) => Math.floor(Math.random() ** 1.8 * count);
          const answers = {
            cat: Math.random() > 0.45 ? 0 : 1,
            time: pick(3),
            q1: pick(5),
            q2: pick(5),
            q3: pick(5),
            q4: [pick(12)],
            q5: pick(3),
            q6: [pick(12)],
            q7: pick(5),
            q8: pick(5),
            q10: choices[pick(choices.length)]
          };
          const demoLang = ['rw', 'en', 'fr'][pick(3)];
          const demoAnalysis = await analyzeFeedback(answers.q10 || '', { language: demoLang });
          await client.query(
            `insert into public.feedback_responses
              (submitted_at, language, department_id, department_name, answers, is_demo, sentiment, urgent, urgent_reason, urgent_signals, analysis_source, detected_language)
             values (now() - ($1 * interval '1 millisecond'), $2, $3, $4, $5::jsonb, true, $6, $7, $8, $9::jsonb, $10, $11)`,
            [
              Math.random() * 2_592_000_000,
              demoLang,
              department.id,
              department.labels[0],
              JSON.stringify(answers),
              demoAnalysis.sentiment,
              demoAnalysis.urgent,
              demoAnalysis.reason,
              JSON.stringify(demoAnalysis.signals),
              demoAnalysis.analysis_source,
              demoAnalysis.language
            ]
          );
        }
        await recordAuditEvent(client, {
          actorId: adminSession.user.id,
          action: 'feedback.demo_added',
          summary: 'Added 60 demo feedback submissions.',
          targetType: 'feedback',
          metadata: { count: 60 }
        });
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
      sendJson(response, 201, { ok: true });
      return true;
    }

    if (pathname === '/api/admin/demo' && request.method === 'DELETE') {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await client.query('delete from public.feedback_responses where is_demo = true');
        await recordAuditEvent(client, {
          actorId: adminSession.user.id,
          action: 'feedback.demo_removed',
          summary: `Removed ${result.rowCount} demo feedback submissions.`,
          targetType: 'feedback',
          metadata: { count: result.rowCount }
        });
        await client.query('commit');
        sendJson(response, 200, { ok: true, deleted: result.rowCount });
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
      return true;
    }

  }

  sendJson(response, 404, { error: 'not_found' });
  return pathname.startsWith('/api/');
}

export { authNodeHandler, pool };
