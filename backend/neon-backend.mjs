import crypto from 'node:crypto';
import { authNodeHandler, pool, getAuthSession } from './neon-auth.mjs';
import { getAccountApproval, handleApprovalApi, requireApprovedAccount, validateSessionActivity } from './approval-api.mjs';
import { recordAuditEvent } from './audit-log.mjs';
import { analyzeFeedback } from './sentiment-analyzer.mjs';
import { notifyUrgentFeedback } from './urgent-alert.mjs';
import { needsAttention } from './alertRules.js';
import { queueFeedbackAlerts, processPendingAlerts, processAlertEscalations, startAlertWorker, stopAlertWorker } from './alert-dispatcher.mjs';
import { sendAlert, isValidE164, sanitizeE164 } from './services/whatsapp.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hashSecret = process.env.DMC_DEVICE_HASH_SECRET;
const responseFields = 'id, submitted_at, language, department_id, department_name, answers, is_demo, user_id, sentiment, urgent, urgent_reason, urgent_signals, analysis_source, detected_language';

if (!hashSecret || Buffer.byteLength(hashSecret, 'utf8') < 32) {
  throw new Error('DMC_DEVICE_HASH_SECRET must be configured with at least 32 bytes.');
}


async function readRawBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 256 * 1024) {
      const error = new Error('Payload too large.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function handleWhatsAppWebhookEvent(pool, eventData) {
  if (!eventData || !Array.isArray(eventData.entry)) return;
  for (const entry of eventData.entry) {
    if (!Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      const val = change.value;
      if (!val) continue;

      if (Array.isArray(val.statuses)) {
        for (const st of val.statuses) {
          const providerMsgId = st.id;
          const status = st.status;
          if (status === 'delivered') {
            await pool.query(
              `update public.alert_outbox
               set status = 'delivered', delivered_at = now()
               where provider_message_id = $1 and status = 'sent'`,
              [providerMsgId]
            ).catch(() => {});
          } else if (status === 'read') {
            await pool.query(
              `update public.alert_outbox
               set status = 'read', read_at = now()
               where provider_message_id = $1 and status in ('sent', 'delivered')`,
              [providerMsgId]
            ).catch(() => {});
          } else if (status === 'failed') {
            const errObj = st.errors?.[0] || {};
            await pool.query(
              `update public.alert_outbox
               set status = 'failed', last_error = $1
               where provider_message_id = $2`,
              [`Meta delivery error ${errObj.code || ''}: ${errObj.message || 'unknown'}`, providerMsgId]
            ).catch(() => {});
          }
        }
      }

      if (Array.isArray(val.messages)) {
        for (const msg of val.messages) {
          const senderPhone = sanitizeE164(msg.from || '');
          let ackFeedbackId = null;

          if (msg.type === 'button') {
            const payload = msg.button?.payload || '';
            if (payload.startsWith('ack_')) ackFeedbackId = payload.slice(4);
          }
          if (msg.type === 'interactive') {
            const replyId = msg.interactive?.button_reply?.id || '';
            if (replyId.startsWith('ack_')) ackFeedbackId = replyId.slice(4);
          }
          if (msg.type === 'text') {
            const text = (msg.text?.body || '').trim().toLowerCase();
            if (['ok', 'ack', 'acknowledged', 'seen', 'done'].includes(text)) {
              const latestAlert = await pool.query(
                `select feedback_id from public.alert_outbox
                 where recipient_phone = $1 and acknowledged_at is null
                 order by created_at desc limit 1`,
                [senderPhone]
              ).catch(() => ({ rows: [] }));
              ackFeedbackId = latestAlert.rows[0]?.feedback_id;
            }
          }

          if (ackFeedbackId) {
            await pool.query(
              `update public.alert_outbox
               set status = 'acknowledged',
                   acknowledged_at = now(),
                   acknowledged_by = $1
               where feedback_id = $2 and acknowledged_at is null`,
              [`WhatsApp (${val.contacts?.[0]?.wa_id || senderPhone})`, ackFeedbackId]
            ).catch(() => {});
          }
        }
      }
    }
  }
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

    const alertDecision = needsAttention(
      { answers: body.answers, text: feedbackText, language: body.language, departmentName: labels[0] },
      analysis
    );

    if (alertDecision.flag) {
      try {
        await queueFeedbackAlerts(client, {
          feedbackId: inserted.rows[0]?.id,
          departmentId: body.departmentId,
          departmentName: labels[0],
          language: analysis.language || body.language,
          decision: alertDecision
        });
      } catch (alertQueueErr) {
        console.warn('[ALERT QUEUE WARN]', alertQueueErr.message);
      }
    }

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
        urgent: analysis.urgent,
        alertFlag: alertDecision.flag,
        alertSeverity: alertDecision.severity
      }
    });
    await client.query('commit');

    if (alertDecision.flag) {
      Promise.race([
        processPendingAlerts(pool, { limit: 5 }),
        new Promise((resolve) => setTimeout(resolve, 2000))
      ]).catch((err) => console.warn('[IMMEDIATE ALERT DISPATCH WARN]', err.message));
    }

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

  // ─── WhatsApp Webhooks ──────────────────────────────────────────────────────
  if (pathname === '/webhooks/whatsapp') {
    if (request.method === 'GET') {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      const expectedToken = process.env.WA_VERIFY_TOKEN || '';
      if (mode === 'subscribe' && token && token === expectedToken) {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.end(challenge || '');
        return true;
      }
      sendJson(response, 403, { error: 'invalid_verify_token' });
      return true;
    }

    if (request.method === 'POST') {
      const rawBody = await readRawBody(request);
      const appSecret = process.env.WA_APP_SECRET;
      const signature = request.headers['x-hub-signature-256'];

      if (appSecret) {
        if (!signature || !signature.startsWith('sha256=')) {
          sendJson(response, 401, { error: 'missing_or_invalid_signature' });
          return true;
        }
        const expectedSig = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
        const sigBuf = Buffer.from(signature);
        const expBuf = Buffer.from(expectedSig);
        if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
          sendJson(response, 403, { error: 'signature_verification_failed' });
          return true;
        }
      }

      try {
        const eventData = JSON.parse(rawBody.toString('utf8'));
        await handleWhatsAppWebhookEvent(pool, eventData);
      } catch (err) {
        console.warn('[WEBHOOK PARSE WARN]', err.message);
      }

      sendJson(response, 200, { ok: true });
      return true;
    }

    response.setHeader('Allow', 'GET, POST');
    sendJson(response, 405, { error: 'method_not_allowed' });
    return true;
  }

  // ─── Serverless / Cron Dispatcher ───────────────────────────────────────────
  if (pathname === '/api/cron/process-alerts') {
    const cronSecret = request.headers['x-cron-secret'] || url.searchParams.get('secret');
    if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
      sendJson(response, 401, { error: 'unauthorized_cron' });
      return true;
    }
    const results = await processPendingAlerts(pool, { limit: 25 });
    const escalated = await processAlertEscalations(pool);
    sendJson(response, 200, { ok: true, ...results, escalated });
    return true;
  }

  // ─── Alert Outbox & Acknowledgement API ──────────────────────────────────────
  if (pathname === '/api/admin/alerts' && request.method === 'GET') {
    if (!await requireApprovedAccount(request, response, pool, getAuthSession)) return true;
    const result = await pool.query(
      `select id, feedback_id, recipient_id, recipient_phone, recipient_name,
              department_name, severity, reason, detected_language, status,
              attempts, last_error, provider_message_id, created_at,
              sent_at, delivered_at, read_at, acknowledged_at, acknowledged_by, escalated_at
       from public.alert_outbox
       order by created_at desc
       limit 200`
    ).catch(() => ({ rows: [] }));
    sendJson(response, 200, result.rows);
    return true;
  }

  const ackMatch = pathname.match(/^\/api\/admin\/alerts\/([0-9a-f-]+)\/acknowledge$/i);
  if (ackMatch && request.method === 'POST') {
    if (!validateAdminMethod(request, response)) return true;
    const account = await requireApprovedAccount(request, response, pool, getAuthSession);
    if (!account) return true;
    const alertId = ackMatch[1];
    const actorName = account.session.user.name || account.session.user.username || 'Admin Staff';
    const result = await pool.query(
      `update public.alert_outbox
       set status = 'acknowledged',
           acknowledged_at = now(),
           acknowledged_by = $1
       where id = $2 or feedback_id = $2
       returning id, feedback_id`,
      [`Dashboard (${actorName})`, alertId]
    );
    if (result.rowCount === 0) {
      sendJson(response, 404, { error: 'alert_not_found' });
      return true;
    }
    await recordAuditEvent(pool, {
      actorId: account.session.user.id,
      action: 'alert.acknowledged',
      summary: `Manually acknowledged feedback alert ${alertId}.`,
      targetType: 'alert',
      targetId: alertId
    });
    sendJson(response, 200, { ok: true, acknowledged: true });
    return true;
  }

  // ─── Staff Alert Contacts Management ────────────────────────────────────────
  if (pathname === '/api/admin/alert-contacts') {
    if (request.method === 'GET') {
      if (!await requireApprovedAccount(request, response, pool, getAuthSession)) return true;
      const result = await pool.query(
        `select id, name, phone_e164, department_id, department_name, role,
                is_duty_manager, alert_enabled, min_severity, whatsapp_opt_in_at, created_at
         from public.staff_alert_contacts
         order by is_duty_manager desc, department_name asc, name asc`
      ).catch(() => ({ rows: [] }));
      sendJson(response, 200, result.rows);
      return true;
    }

    if (request.method === 'POST') {
      if (!validateAdminMethod(request, response)) return true;
      const session = await getAdminSession(request, response);
      if (!session) return true;
      if (!requireJson(request, response)) return true;
      const body = await readJson(request);

      if (!body.name || typeof body.name !== 'string' || !body.phone_e164 || typeof body.phone_e164 !== 'string') {
        sendJson(response, 400, { error: 'invalid_contact_payload', message: 'Name and phone are required.' });
        return true;
      }

      const phone = sanitizeE164(body.phone_e164);
      if (!isValidE164(phone)) {
        sendJson(response, 400, { error: 'invalid_e164_phone', message: 'Must be in E.164 format (+250...).' });
        return true;
      }

      const optIn = body.opt_in !== false ? new Date().toISOString() : null;
      const minSeverity = ['normal', 'high', 'critical'].includes(body.min_severity) ? body.min_severity : 'normal';

      let deptName = null;
      if (body.department_id) {
        const dRes = await pool.query('select labels from public.feedback_departments where id = $1', [body.department_id]);
        deptName = dRes.rows[0]?.labels?.[0] || null;
      }

      let contactId = body.id;
      if (contactId) {
        // Update existing contact
        await pool.query(
          `update public.staff_alert_contacts
           set name = $1, phone_e164 = $2, department_id = $3, department_name = $4,
               role = $5, is_duty_manager = $6, alert_enabled = $7, min_severity = $8,
               whatsapp_opt_in_at = coalesce(whatsapp_opt_in_at, $9::timestamptz),
               updated_at = now()
           where id = $10`,
          [
            body.name.trim(),
            phone,
            body.department_id || null,
            deptName,
            (body.role || 'staff').trim(),
            Boolean(body.is_duty_manager),
            body.alert_enabled !== false,
            minSeverity,
            optIn,
            contactId
          ]
        );
      } else {
        // Insert new contact
        const inserted = await pool.query(
          `insert into public.staff_alert_contacts
            (name, phone_e164, department_id, department_name, role, is_duty_manager, alert_enabled, min_severity, whatsapp_opt_in_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)
           returning id`,
          [
            body.name.trim(),
            phone,
            body.department_id || null,
            deptName,
            (body.role || 'staff').trim(),
            Boolean(body.is_duty_manager),
            body.alert_enabled !== false,
            minSeverity,
            optIn
          ]
        );
        contactId = inserted.rows[0]?.id;
      }

      await recordAuditEvent(pool, {
        actorId: session.user.id,
        action: body.id ? 'alert_contact.updated' : 'alert_contact.created',
        summary: `${body.id ? 'Updated' : 'Created'} alert contact for ${body.name} (${phone}).`,
        targetType: 'alert_contact',
        targetId: contactId
      });

      sendJson(response, body.id ? 200 : 201, { ok: true, id: contactId });
      return true;
    }
  }

  const contactTestMatch = pathname.match(/^\/api\/admin\/alert-contacts\/([0-9a-f-]+)\/test$/i);
  if (contactTestMatch && request.method === 'POST') {
    if (!validateAdminMethod(request, response)) return true;
    const session = await getAdminSession(request, response);
    if (!session) return true;
    const contactId = contactTestMatch[1];
    const cRes = await pool.query('select * from public.staff_alert_contacts where id = $1', [contactId]);
    if (cRes.rowCount === 0) {
      sendJson(response, 404, { error: 'contact_not_found' });
      return true;
    }
    const contact = cRes.rows[0];
    try {
      const testResult = await sendAlert(contact, {
        severity: 'normal',
        departmentName: contact.department_name || 'DMCH Testing',
        reason: 'Test verification alert dispatched from DMCH Admin Dashboard',
        language: 'en'
      });
      await recordAuditEvent(pool, {
        actorId: session.user.id,
        action: 'alert_contact.test_dispatched',
        summary: `Sent test alert to ${contact.name} (${contact.phone_e164}).`,
        targetType: 'alert_contact',
        targetId: contactId,
        metadata: { messageId: testResult.messageId, dryRun: testResult.dryRun }
      });
      sendJson(response, 200, { ok: true, test: true, result: testResult });
    } catch (sendErr) {
      sendJson(response, 502, { error: 'test_alert_failed', message: sendErr.message });
    }
    return true;
  }

  const contactDeleteMatch = pathname.match(/^\/api\/admin\/alert-contacts\/([0-9a-f-]+)$/i);
  if (contactDeleteMatch && request.method === 'DELETE') {
    if (!validateAdminMethod(request, response)) return true;
    const session = await getAdminSession(request, response);
    if (!session) return true;
    const contactId = contactDeleteMatch[1];
    const deleted = await pool.query('delete from public.staff_alert_contacts where id = $1 returning name', [contactId]);
    if (deleted.rowCount === 0) {
      sendJson(response, 404, { error: 'contact_not_found' });
      return true;
    }
    await recordAuditEvent(pool, {
      actorId: session.user.id,
      action: 'alert_contact.deleted',
      summary: `Deleted alert contact ${deleted.rows[0].name}.`,
      targetType: 'alert_contact',
      targetId: contactId
    });
    sendJson(response, 200, { ok: true, deleted: true });
    return true;
  }


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

export { authNodeHandler, pool, startAlertWorker, stopAlertWorker };
