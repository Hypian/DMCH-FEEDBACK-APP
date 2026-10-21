import crypto from 'node:crypto';
import { authNodeHandler, pool, getAuthSession } from './neon-auth.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hashSecret = process.env.DMC_DEVICE_HASH_SECRET;
const responseFields = 'id, submitted_at, language, department_id, department_name, answers, is_demo, user_id';

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
  if (!origin || new URL(origin).origin !== new URL(process.env.BETTER_AUTH_URL).origin) {
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
    const session = await getAuthSession(body.headers);
    await client.query(
      `insert into public.feedback_responses
        (language, department_id, department_name, answers, user_id)
       values ($1, $2, $3, $4::jsonb, $5)`,
      [body.language, body.departmentId, labels[0], JSON.stringify(body.answers), session?.user?.id || null]
    );
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

  if (pathname === '/api/admin/session' && request.method === 'GET') {
    const session = await getAdminSession(request, response);
    if (session) {
      sendJson(response, 200, {
        user: {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name
        }
      });
    }
    return true;
  }

  if (pathname === '/api/departments' && request.method === 'GET') {
    const includeInactive = url.searchParams.get('all') === '1';
    if (includeInactive && !await getAdminSession(request, response)) return true;
    const result = await pool.query(
      `select id, labels, is_active, sort_order
       from public.feedback_departments
       ${includeInactive ? '' : 'where is_active = true'}
       order by sort_order asc`
    );
    sendJson(response, 200, result.rows);
    return true;
  }

  if (pathname === '/api/responses' && request.method === 'DELETE') {
    if (!validateAdminMethod(request, response)) return true;
    if (!await getAdminSession(request, response)) return true;
    await pool.query('delete from public.feedback_responses');
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/responses' && request.method === 'GET') {
    if (!await getAdminSession(request, response)) return true;
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
    if (!await getAdminSession(request, response)) return true;
    if (request.method !== 'DELETE' && !requireJson(request, response)) return true;
    const body = request.method === 'DELETE' ? {} : await readJson(request);

    if (pathname === '/api/admin/departments' && request.method === 'POST') {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 120) {
        sendJson(response, 400, { error: 'invalid_department_name' });
        return true;
      }
      const id = `x${crypto.randomUUID().replace(/-/g, '')}`;
      const result = await pool.query(
        `insert into public.feedback_departments (id, labels, sort_order)
         values ($1, $2::jsonb, coalesce((select max(sort_order) + 1 from public.feedback_departments), 0))
         returning id, labels, is_active, sort_order`,
        [id, JSON.stringify([name, name, name])]
      );
      sendJson(response, 201, result.rows[0]);
      return true;
    }

    const departmentMatch = pathname.match(/^\/api\/admin\/departments\/([a-zA-Z0-9_-]+)$/);
    if (departmentMatch && request.method === 'PATCH') {
      if (typeof body.active !== 'boolean') {
        sendJson(response, 400, { error: 'invalid_department_status' });
        return true;
      }
      const result = await pool.query(
        `update public.feedback_departments set is_active = $2 where id = $1
         returning id, labels, is_active, sort_order`,
        [departmentMatch[1], body.active]
      );
      if (result.rowCount === 0) sendJson(response, 404, { error: 'department_not_found' });
      else sendJson(response, 200, result.rows[0]);
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
          await client.query(
            `insert into public.feedback_responses
              (submitted_at, language, department_id, department_name, answers, is_demo)
             values (now() - ($1 * interval '1 millisecond'), $2, $3, $4, $5::jsonb, true)`,
            [Math.random() * 2_592_000_000, ['rw', 'en', 'fr'][pick(3)], department.id, department.labels[0], JSON.stringify(answers)]
          );
        }
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
      await pool.query('delete from public.feedback_responses where is_demo = true');
      sendJson(response, 200, { ok: true });
      return true;
    }

  }

  sendJson(response, 404, { error: 'not_found' });
  return pathname.startsWith('/api/');
}

export { authNodeHandler, pool };
