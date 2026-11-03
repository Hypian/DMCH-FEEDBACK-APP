/**
 * alert-dispatcher.mjs
 * Implements the transactional Outbox Pattern, InTouch SMS and Nodemailer Email routing,
 * retry backoff, deduplication, rate-limiting, and escalation for hospital patient feedback.
 *
 * ROUTING RULES:
 * - Immediate Attention (Severity 'critical' or 'high'): Dispatches direct SMS via InTouch SMS (Rwanda).
 * - Normal Attention (Negative sentiment, no immediate clinical harm): Dispatches Email via Nodemailer.
 * - Positive or Neutral: No immediate alert dispatched.
 */

import { sendIntouchSms, isValidIntouchPhone, isValidE164, sanitizeE164, formatIntouchRecipient, extractFeedbackSummary } from './services/intouch.js';
import { sendAlertEmail, isValidEmail } from './services/mailer.js';
import { recordAuditEvent } from './audit-log.mjs';

export const BACKOFF_SCHEDULE_MINUTES = [1, 5, 15, 30, 60];
export const RATE_LIMIT_WINDOW_MINUTES = 30;

export function calculateRetryBackoff(attempt) {
  const index = Math.max(0, Math.min(Math.max(1, attempt) - 1, BACKOFF_SCHEDULE_MINUTES.length - 1));
  return BACKOFF_SCHEDULE_MINUTES[index] * 60 * 1000;
}

/**
 * Unified dispatch interface.
 * Routes to InTouch SMS or Nodemailer Email based on payload severity and channel.
 *
 * @param {object} recipient Staff contact { id, name, phone_e164, email }
 * @param {object} payload Alert details { feedbackId, severity, departmentName, reason, language, dashboardUrl, channel, provider }
 * @returns {Promise<{ ok: boolean, messageId?: string, dryRun?: boolean, error?: string }>}
 */
export async function sendAlert(recipient, payload = {}, options = {}) {
  const severity = payload.severity || 'normal';
  const isImmediateAttention = severity === 'critical' || severity === 'high';
  const channel = payload.channel || (isImmediateAttention ? 'sms' : 'email');

  if (channel === 'email') {
    return sendAlertEmail(recipient, payload, options);
  }

  return sendIntouchSms(recipient, payload, options);
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
  decision,
  answers = {},
  metadata = {}
}) {
  if (!decision || !decision.flag) return 0;
  if (!client || typeof client.query !== 'function') return 0;

  const severity = decision.severity || 'normal';
  const reason = decision.reasons?.[0] || 'Patient feedback requires review';
  const targetCategory = decision.targetCategory || 'clinical';

  const surveySummary = extractFeedbackSummary(answers);
  const alertMetadata = {
    ...(metadata || {}),
    ...surveySummary,
    ...(answers && typeof answers === 'object' ? { answers } : {})
  };

  // Immediate attention ('critical' | 'high') -> INTOUCH SMS (Rwanda)
  // Normal attention ('normal') -> NODEMAILER EMAIL (falls back to SMS when staff only have phone numbers configured)
  const isImmediateAttention = severity === 'critical' || severity === 'high';
  let channel = isImmediateAttention ? 'sms' : 'email';
  let provider = isImmediateAttention ? (process.env.SMS_PROVIDER || 'intouch') : 'nodemailer';

  // 1. Fetch eligible staff contacts
  const contactsResult = await client.query(
    `select id, name, phone_e164, coalesce(email, '') as email, department_id, is_duty_manager, min_severity,
            coalesce(target_category, 'clinical') as target_category,
            coalesce(sms_enabled, true) as sms_enabled, coalesce(email_enabled, true) as email_enabled
     from public.staff_alert_contacts
     where alert_enabled = true
       and (
         department_id = $1
         or department_id is null
         or (is_duty_manager = true and ($2 = 'critical' or $3 = 'managing_director'))
         or target_category = 'managing_director'
         or target_category = 'public_relations'
       )`,
    [departmentId, severity, targetCategory]
  ).catch(async () => {
    // Fallback if target_category not yet applied
    return client.query(
      `select id, name, phone_e164, coalesce(email, '') as email, department_id, is_duty_manager, min_severity,
              'clinical' as target_category,
              coalesce(sms_enabled, true) as sms_enabled, coalesce(email_enabled, true) as email_enabled
       from public.staff_alert_contacts
       where alert_enabled = true
         and (
           department_id = $1
           or (is_duty_manager = true and $2 = 'critical')
         )`,
      [departmentId, severity]
    ).catch(async () => {
      // Fallback if email columns not yet applied
      return client.query(
        `select id, name, phone_e164, '' as email, department_id, is_duty_manager, min_severity,
                'clinical' as target_category,
                true as sms_enabled, true as email_enabled
         from public.staff_alert_contacts
         where alert_enabled = true
           and (
             department_id = $1
             or (is_duty_manager = true and $2 = 'critical')
           )`,
        [departmentId, severity]
      );
    });
  });

  const filterContacts = (requireCategoryMatch, targetChannel) => contactsResult.rows.filter((contact) => {
    const contactCat = contact.target_category || 'clinical';
    if (requireCategoryMatch) {
      const categoryMatches =
        contactCat === 'all' ||
        contactCat === targetCategory ||
        (targetCategory === 'managing_director' && contact.is_duty_manager);
      if (!categoryMatches) return false;
    }

    // Clinical contacts are department-specific unless they have no department assigned (hospital-wide) or are duty managers.
    if (contactCat === 'clinical' && contact.department_id && contact.department_id !== departmentId && !contact.is_duty_manager) {
      return false;
    }

    // Check severity threshold hierarchy: normal (all) < high < critical
    if (contact.min_severity === 'critical' && severity !== 'critical') return false;
    if (contact.min_severity === 'high' && severity === 'normal') return false;

    if (targetChannel === 'sms') {
      return (contact.sms_enabled !== false) && (isValidIntouchPhone(contact.phone_e164) || isValidE164(contact.phone_e164));
    }
    // targetChannel === 'email'
    return (contact.email_enabled !== false) && isValidEmail(contact.email);
  });

  let eligibleContacts = filterContacts(true, channel);

  // If normal severity attempted email but matched contacts only have phone numbers (no email configured), fall back to SMS
  if (eligibleContacts.length === 0 && channel === 'email') {
    const smsMatches = filterContacts(true, 'sms');
    if (smsMatches.length > 0) {
      channel = 'sms';
      provider = process.env.SMS_PROVIDER || 'intouch';
      eligibleContacts = smsMatches;
    }
  }

  // If no contacts exist for the specific category (e.g. only clinical staff registered), route to any active staff contact
  if (eligibleContacts.length === 0) {
    eligibleContacts = filterContacts(false, channel);
    if (eligibleContacts.length === 0 && channel === 'email') {
      const smsFallbackMatches = filterContacts(false, 'sms');
      if (smsFallbackMatches.length > 0) {
        channel = 'sms';
        provider = process.env.SMS_PROVIDER || 'intouch';
        eligibleContacts = smsFallbackMatches;
      }
    }
  }

  // 2. Fallback routing if no configured staff member matched
  if (eligibleContacts.length === 0) {
    if (channel === 'sms') {
      const fallbackPhone = formatIntouchRecipient(process.env.ALERT_FALLBACK_PHONE || '') || sanitizeE164(process.env.ALERT_FALLBACK_PHONE || '');
      if (isValidIntouchPhone(fallbackPhone) || isValidE164(fallbackPhone)) {
        eligibleContacts.push({
          id: null,
          name: 'Duty Manager (Fallback)',
          phone_e164: fallbackPhone,
          email: '',
          department_id: departmentId,
          target_category: targetCategory,
          is_duty_manager: true
        });
      }
    } else {
      const fallbackEmail = (process.env.ALERT_FALLBACK_EMAIL || process.env.EMAIL_FROM || '').trim();
      if (isValidEmail(fallbackEmail)) {
        eligibleContacts.push({
          id: null,
          name: 'Quality Lead (Fallback)',
          phone_e164: '',
          email: fallbackEmail,
          department_id: departmentId,
          target_category: targetCategory,
          is_duty_manager: true
        });
      }
    }
  }

  if (eligibleContacts.length === 0) {
    console.warn(`[ALERT DISPATCHER] No eligible ${channel.toUpperCase()} contacts found for department: ${departmentName} (${severity} / ${targetCategory}).`);
    return 0;
  }

  // 3. Rate limiting / deduplication for non-critical alerts
  // CRITICAL ALERTS ARE NEVER BATCHED OR DELAYED.
  if (severity !== 'critical') {
    const recentAlerts = await client.query(
      `select count(*)::int as count
       from public.alert_outbox
       where department_id = $1
         and severity != 'critical'
         and created_at >= now() - ($2 || ' minutes')::interval`,
      [departmentId, RATE_LIMIT_WINDOW_MINUTES]
    ).catch(() => ({ rows: [] }));

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
        (feedback_id, recipient_id, recipient_phone, recipient_email, recipient_name, department_id, department_name, severity, target_category, channel, provider, reason, detected_language, status, next_retry_at, metadata)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending', now(), $14::jsonb)
       on conflict do nothing
       returning id`,
      [
        feedbackId,
        contact.id,
        contact.phone_e164 || '',
        contact.email || '',
        contact.name,
        departmentId,
        departmentName,
        severity,
        targetCategory,
        channel,
        provider,
        reason,
        language,
        JSON.stringify(alertMetadata)
      ]
    ).catch(async () => {
      // Fallback query if metadata column is not yet migrated
      return client.query(
        `insert into public.alert_outbox
          (feedback_id, recipient_id, recipient_phone, recipient_email, recipient_name, department_id, department_name, severity, target_category, channel, provider, reason, detected_language, status, next_retry_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending', now())
         on conflict do nothing
         returning id`,
        [
          feedbackId,
          contact.id,
          contact.phone_e164 || '',
          contact.email || '',
          contact.name,
          departmentId,
          departmentName,
          severity,
          targetCategory,
          channel,
          provider,
          reason,
          language
        ]
      ).catch(async () => {
        // Fallback query if target_category is not yet migrated
        return client.query(
          `insert into public.alert_outbox
            (feedback_id, recipient_id, recipient_phone, recipient_email, recipient_name, department_id, department_name, severity, channel, provider, reason, detected_language, status, next_retry_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending', now())
           on conflict do nothing
           returning id`,
          [
            feedbackId,
            contact.id,
            contact.phone_e164 || '',
            contact.email || '',
            contact.name,
            departmentId,
            departmentName,
            severity,
            channel,
            provider,
            reason,
            language
          ]
        );
      });
    });

    if (insertRes.rowCount > 0) queuedCount += 1;
  }

  // Record audit event for alert creation (generic metadata only, NO patient text)
  await recordAuditEvent(client, {
    actorId: null,
    action: 'feedback.alert_queued',
    summary: `Queued ${queuedCount} ${channel.toUpperCase()} alert(s) via ${provider} for ${departmentName} (${severity} / ${targetCategory}).`,
    targetType: 'feedback',
    targetId: feedbackId,
    metadata: {
      severity,
      targetCategory,
      channel,
      provider,
      reason,
      recipients: eligibleContacts.map((c) => ({ name: c.name, phone: c.phone_e164, email: c.email, category: c.target_category }))
    }
  });

  return queuedCount;
}

/**
 * Processes pending alert outbox rows using row locking (FOR UPDATE SKIP LOCKED).
 *
 * @param {object} pool PostgreSQL pool connection
 * @param {object} options
 * @param {number} options.limit Maximum batch size (default: 15)
 * @returns {Promise<{ processed: number, succeeded: number, failed: number }>}
 */
export async function processPendingAlerts(pool, options = {}) {
  const limit = options.limit || 15;
  const defaultSmsProvider = process.env.SMS_PROVIDER || 'intouch';
  const client = await pool.connect();
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  try {
    await client.query('begin');

    // Lock up to `limit` pending rows that are ready for delivery
    const outboxRows = await client.query(
      `select id, feedback_id, recipient_id, recipient_phone,
              coalesce(recipient_email, '') as recipient_email, recipient_name,
              department_name, severity, coalesce(target_category, 'clinical') as target_category,
              coalesce(channel, case when severity in ('critical', 'high') then 'sms' else 'email' end) as channel,
              coalesce(provider, case when severity in ('critical', 'high') then $2 else 'nodemailer' end) as provider,
              reason, detected_language, attempts, max_attempts,
              coalesce(metadata, '{}'::jsonb) as metadata
       from public.alert_outbox
       where status in ('pending', 'failed')
         and attempts < max_attempts
         and next_retry_at <= now()
       order by created_at asc
       limit $1
       for update skip locked`,
      [limit, defaultSmsProvider]
    ).catch(async () => {
      await client.query('rollback').catch(() => {});
      await client.query('begin');
      return client.query(
        `select id, feedback_id, recipient_id, recipient_phone,
                coalesce(recipient_email, '') as recipient_email, recipient_name,
                department_name, severity, coalesce(target_category, 'clinical') as target_category,
                coalesce(channel, case when severity in ('critical', 'high') then 'sms' else 'email' end) as channel,
                coalesce(provider, case when severity in ('critical', 'high') then $2 else 'nodemailer' end) as provider,
                reason, detected_language, attempts, max_attempts,
                '{}'::jsonb as metadata
         from public.alert_outbox
         where status in ('pending', 'failed')
           and attempts < max_attempts
           and next_retry_at <= now()
         order by created_at asc
         limit $1
         for update skip locked`,
        [limit, defaultSmsProvider]
      ).catch(async () => {
        await client.query('rollback').catch(() => {});
        await client.query('begin');
        return client.query(
          `select id, feedback_id, recipient_id, recipient_phone,
                  '' as recipient_email, recipient_name,
                  department_name, severity, 'clinical' as target_category, 'sms' as channel,
                  coalesce(provider, 'intouch') as provider,
                  reason, detected_language, attempts, max_attempts,
                  '{}'::jsonb as metadata
           from public.alert_outbox
           where status in ('pending', 'failed')
             and attempts < max_attempts
             and next_retry_at <= now()
           order by created_at asc
           limit $1
           for update skip locked`,
          [limit]
        );
      });
    });

    await client.query('commit'); // release transaction lock

    // Dispatch all locked alerts in parallel for minimal end-to-end SMS latency
    await Promise.allSettled(
      outboxRows.rows.map(async (row) => {
        processed += 1;
        const recipient = {
          id: row.recipient_id,
          name: row.recipient_name,
          phone_e164: row.recipient_phone,
          email: row.recipient_email
        };

        const meta = (row.metadata && typeof row.metadata === 'object') ? row.metadata : {};
        const payload = {
          feedbackId: row.feedback_id,
          severity: row.severity,
          targetCategory: row.target_category,
          departmentName: row.department_name,
          reason: row.reason,
          complaint: row.reason,
          waitTime: meta.waitTime || '',
          patientType: meta.patientType || '',
          visitTime: meta.visitTime || '',
          answers: meta.answers || meta,
          metadata: meta,
          language: row.detected_language,
          dashboardUrl: `${process.env.BETTER_AUTH_URL || 'https://dmc.rw'}#admin`,
          channel: row.channel,
          provider: row.provider
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
        }
      })
    );
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
    // Find sent SMS alerts that have not been acknowledged within their threshold and not yet escalated
    const unacked = await client.query(
      `select id, feedback_id, recipient_phone, coalesce(recipient_email, '') as recipient_email, recipient_name, department_name, severity, reason, detected_language
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
        `select id, name, phone_e164, coalesce(email, '') as email
         from public.staff_alert_contacts
         where is_duty_manager = true
           and alert_enabled = true
         limit 1`
      );

      const dutyManager = dutyManagerRes.rows[0];
      if (dutyManager && (isValidIntouchPhone(dutyManager.phone_e164) || isValidE164(dutyManager.phone_e164))) {
        await sendAlert(dutyManager, {
          feedbackId: alert.feedback_id,
          severity: alert.severity,
          departmentName: alert.department_name,
          reason: `UNACKNOWLEDGED ESCALATION: ${alert.reason}`,
          language: alert.detected_language,
          isEscalation: true,
          channel: 'sms',
          provider: process.env.SMS_PROVIDER || 'intouch'
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

export function startAlertWorker(pool, intervalMs = 5000) {
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
