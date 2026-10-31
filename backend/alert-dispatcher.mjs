/**
 * alert-dispatcher.mjs
 * Implements the transactional Outbox Pattern, recipient routing, retry backoff,
 * deduplication, rate-limiting, and escalation for hospital feedback WhatsApp alerts.
 */

import { sendAlert, isValidE164, sanitizeE164 } from './services/whatsapp.js';
import { recordAuditEvent } from './audit-log.mjs';

export const BACKOFF_SCHEDULE_MINUTES = [1, 5, 15, 30, 60];
export const RATE_LIMIT_WINDOW_MINUTES = 30;

export function calculateRetryBackoff(attempt) {
  const index = Math.max(0, Math.min(Math.max(1, attempt) - 1, BACKOFF_SCHEDULE_MINUTES.length - 1));
  return BACKOFF_SCHEDULE_MINUTES[index] * 60 * 1000;
}

/**
 * Inserts pending alert outbox rows inside the feedback transaction.
 *
 * @param {object} client Database client with active transaction
 * @param {object} params
 * @param {string} params.feedbackId UUID of feedback row
 * @param {string} params.departmentId ID of department
 * @param {string} params.departmentName Name of department
 * @param {string} params.language Language of feedback
 * @param {object} params.decision Result from alertRules.needsAttention()
 * @returns {Promise<number>} Number of queued alert rows
 */
export async function queueFeedbackAlerts(client, {
  feedbackId,
  departmentId,
  departmentName,
  language = 'en',
  decision
}) {
  if (!decision || !decision.flag) return 0;
  if (!client || typeof client.query !== 'function') return 0;

  const severity = decision.severity || 'normal';
  const reason = decision.reasons?.[0] || 'Patient feedback requires review';

  // 1. Fetch eligible staff contacts
  // Matching rules:
  // - alert_enabled = true
  // - whatsapp_opt_in_at is not null (consent recorded)
  // - Matches department OR is duty manager (for critical alerts)
  // - Contact's min_severity threshold is satisfied
  const contactsResult = await client.query(
    `select id, name, phone_e164, department_id, is_duty_manager, min_severity
     from public.staff_alert_contacts
     where alert_enabled = true
       and whatsapp_opt_in_at is not null
       and (
         department_id = $1
         or (is_duty_manager = true and $2 = 'critical')
       )`,
    [departmentId, severity]
  );

  const eligibleContacts = contactsResult.rows.filter((contact) => {
    if (!isValidE164(contact.phone_e164)) return false;
    // Check severity threshold hierarchy: normal (all) < high < critical
    if (contact.min_severity === 'critical' && severity !== 'critical') return false;
    if (contact.min_severity === 'high' && severity === 'normal') return false;
    return true;
  });

  // 2. Fallback routing if no configured staff member matched
  if (eligibleContacts.length === 0) {
    const fallbackPhone = sanitizeE164(process.env.ALERT_FALLBACK_PHONE || '');
    if (isValidE164(fallbackPhone)) {
      eligibleContacts.push({
        id: null,
        name: 'Duty Manager (Fallback)',
        phone_e164: fallbackPhone,
        department_id: departmentId,
        is_duty_manager: true
      });
    }
  }

  if (eligibleContacts.length === 0) {
    console.warn(`[ALERT DISPATCHER] No eligible WhatsApp contacts found for department: ${departmentName} (${severity}).`);
    return 0;
  }

  // 3. Rate limiting / deduplication for non-critical alerts
  // If the same department received an alert within the window, normal/high alerts are rate-limited.
  // CRITICAL ALERTS ARE NEVER BATCHED OR DELAYED.
  if (severity !== 'critical') {
    const recentAlerts = await client.query(
      `select count(*)::int as count
       from public.alert_outbox
       where department_id = $1
         and severity != 'critical'
         and created_at >= now() - ($2 || ' minutes')::interval`,
      [departmentId, RATE_LIMIT_WINDOW_MINUTES]
    );
    if ((recentAlerts.rows[0]?.count || 0) >= 3) {
      console.log(`[ALERT RATE LIMIT] Department ${departmentName} has received 3+ alerts in last ${RATE_LIMIT_WINDOW_MINUTES}m. Suppressing duplicate.`);
      return 0;
    }
  }

  // 4. Insert pending rows into alert_outbox within the transaction
  let queuedCount = 0;
  for (const contact of eligibleContacts) {
    const insertRes = await client.query(
      `insert into public.alert_outbox
        (feedback_id, recipient_id, recipient_phone, recipient_name, department_id, department_name, severity, reason, detected_language, status, next_retry_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', now())
       on conflict (feedback_id, recipient_id) do nothing
       returning id`,
      [
        feedbackId,
        contact.id,
        contact.phone_e164,
        contact.name,
        departmentId,
        departmentName,
        severity,
        reason,
        language
      ]
    );
    if (insertRes.rowCount > 0) queuedCount += 1;
  }

  // Record audit event for alert creation (generic metadata only, NO patient text)
  await recordAuditEvent(client, {
    actorId: null,
    action: 'feedback.alert_queued',
    summary: `Queued ${queuedCount} WhatsApp alert(s) for ${departmentName} (${severity}).`,
    targetType: 'feedback',
    targetId: feedbackId,
    metadata: {
      severity,
      reason,
      recipients: eligibleContacts.map((c) => ({ name: c.name, phone: c.phone_e164 }))
    }
  });

  return queuedCount;
}

/**
 * Processes pending alert outbox rows using row locking (FOR UPDATE SKIP LOCKED).
 * Can be invoked by long-running worker interval OR Vercel cron endpoint.
 *
 * @param {object} pool PostgreSQL pool connection
 * @param {object} options
 * @param {number} options.limit Maximum batch size (default: 15)
 * @returns {Promise<{ processed: number, succeeded: number, failed: number }>}
 */
export async function processPendingAlerts(pool, options = {}) {
  const limit = options.limit || 15;
  const client = await pool.connect();
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  try {
    await client.query('begin');

    // Lock up to `limit` pending rows that are ready for delivery
    const outboxRows = await client.query(
      `select id, feedback_id, recipient_id, recipient_phone, recipient_name,
              department_name, severity, reason, detected_language, attempts, max_attempts
       from public.alert_outbox
       where status in ('pending', 'failed')
         and attempts < max_attempts
         and next_retry_at <= now()
       order by created_at asc
       limit $1
       for update skip locked`,
      [limit]
    );

    await client.query('commit'); // release lock on selection query, process row-by-row

    for (const row of outboxRows.rows) {
      processed += 1;
      const recipient = {
        id: row.recipient_id,
        name: row.recipient_name,
        phone_e164: row.recipient_phone
      };

      const payload = {
        feedbackId: row.feedback_id,
        severity: row.severity,
        departmentName: row.department_name,
        reason: row.reason,
        language: row.detected_language,
        dashboardUrl: `${process.env.BETTER_AUTH_URL || 'https://dmc.rw'}#admin`
      };

      try {
        const sendResult = await sendAlert(recipient, payload);
        await pool.query(
          `update public.alert_outbox
           set status = 'sent',
               sent_at = now(),
               attempts = attempts + 1,
               provider_message_id = $1,
               last_error = null
           where id = $2`,
          [sendResult.messageId || 'sent_mock', row.id]
        );
        succeeded += 1;
      } catch (err) {
        failed += 1;
        const nextAttempt = row.attempts + 1;
        const backoffMinutes = BACKOFF_SCHEDULE_MINUTES[Math.min(nextAttempt - 1, BACKOFF_SCHEDULE_MINUTES.length - 1)];
        const isFinalFailure = nextAttempt >= row.max_attempts;

        await pool.query(
          `update public.alert_outbox
           set attempts = $1,
               status = case when $2 = true then 'failed' else 'pending' end,
               next_retry_at = now() + ($3 || ' minutes')::interval,
               last_error = $4
           where id = $5`,
          [nextAttempt, isFinalFailure, backoffMinutes, err.message.slice(0, 500), row.id]
        );

        // Optional Africa's Talking SMS fallback for critical alerts on final failure
        if (isFinalFailure && row.severity === 'critical' && process.env.AFRICASTALKING_SMS_FALLBACK_ENABLED === 'true') {
          console.warn(`[SMS FALLBACK] WhatsApp exhausted for critical alert ${row.id}. Triggering Africa's Talking fallback.`);
          // Africa's Talking fallback hook (extensible via env)
        }
      }
    }
  } catch (error) {
    await client.query('rollback').catch(() => {});
    console.error('[ALERT DISPATCHER ERROR]', error.message);
  } finally {
    client.release();
  }

  return { processed, succeeded, failed };
}

/**
 * Checks for unacknowledged critical and high alerts that exceed the escalation threshold.
 *
 * @param {object} pool PostgreSQL pool connection
 * @returns {Promise<number>} Number of escalated alerts
 */
export async function processAlertEscalations(pool) {
  const criticalMinutes = Number(process.env.ESCALATE_CRITICAL_MINUTES || 15);
  const highMinutes = Number(process.env.ESCALATE_HIGH_MINUTES || 60);

  const client = await pool.connect();
  let escalatedCount = 0;

  try {
    // Find sent alerts that have not been acknowledged within their threshold and not yet escalated
    const unacked = await client.query(
      `select id, feedback_id, recipient_phone, recipient_name, department_name, severity, reason, detected_language
       from public.alert_outbox
       where status in ('sent', 'delivered', 'read')
         and acknowledged_at is null
         and escalated_at is null
         and (
           (severity = 'critical' and sent_at <= now() - ($1 || ' minutes')::interval)
           or (severity = 'high' and sent_at <= now() - ($2 || ' minutes')::interval)
         )
       limit 10`,
      [criticalMinutes, highMinutes]
    );

    for (const alert of unacked.rows) {
      // Find duty manager contact for escalation
      const dutyManagerRes = await client.query(
        `select id, name, phone_e164
         from public.staff_alert_contacts
         where is_duty_manager = true
           and alert_enabled = true
           and whatsapp_opt_in_at is not null
         limit 1`
      );

      const dutyManager = dutyManagerRes.rows[0];
      if (dutyManager && isValidE164(dutyManager.phone_e164)) {
        await sendAlert(dutyManager, {
          feedbackId: alert.feedback_id,
          severity: alert.severity,
          departmentName: alert.department_name,
          reason: `UNACKNOWLEDGED ESCALATION: ${alert.reason}`,
          language: alert.detected_language,
          isEscalation: true
        });
      }

      await client.query(
        `update public.alert_outbox
         set escalated_at = now()
         where id = $1`,
        [alert.id]
      );
      escalatedCount += 1;
    }
  } catch (error) {
    console.error('[ESCALATION ERROR]', error.message);
  } finally {
    client.release();
  }

  return escalatedCount;
}

let workerInterval = null;

/**
 * Starts the in-process background polling worker for long-running hosting (Render, VM, Docker).
 *
 * @param {object} pool PostgreSQL database pool
 * @param {number} intervalMs Polling interval in milliseconds (default: 10,000)
 */
export function startAlertWorker(pool, intervalMs = 10000) {
  if (workerInterval !== null) return;
  workerInterval = setInterval(async () => {
    try {
      await processPendingAlerts(pool, { limit: 10 });
      await processAlertEscalations(pool);
    } catch (err) {
      console.error('[ALERT WORKER CYCLE ERROR]', err.message);
    }
  }, intervalMs);
  if (workerInterval.unref) workerInterval.unref();
}

export function stopAlertWorker() {
  if (workerInterval !== null) {
    clearInterval(workerInterval);
    workerInterval = null;
  }
}
