// ─── Urgent Feedback Notification Hook ───────────────────────────────────────
// This module provides the central hook for real-time alerting whenever an urgent
// patient feedback submission is flagged by the sentiment & urgency classifier.

import { recordAuditEvent } from './audit-log.mjs';

/**
 * Dispatches an immediate alert for urgent patient feedback.
 *
 * PLUG-IN INSTRUCTIONS:
 * Connect your preferred notification provider inside this function:
 * 1. Slack / MS Teams Webhook:
 *    await fetch(process.env.SLACK_WEBHOOK_URL, {
 *      method: 'POST',
 *      headers: { 'Content-Type': 'application/json' },
 *      body: JSON.stringify({ text: `🚨 URGENT FEEDBACK: ${event.summary}\nReason: ${event.analysis.reason}` })
 *    });
 * 2. SMS (e.g. Africa's Talking or Twilio):
 *    await smsClient.send({ to: process.env.ADMIN_PHONE, message: `DMCH Alert: Urgent feedback #${event.feedbackId}` });
 * 3. Email (via nodemailer / resend):
 *    await sendEmail({ to: 'clinical-leads@dmchospital.org', subject: `🚨 Urgent Patient Feedback`, text: ... });
 *
 * @param {object} pool Database pool or client connection
 * @param {object} event Alert payload
 * @param {string} event.feedbackId UUID of the inserted feedback row
 * @param {string} event.departmentId ID of department
 * @param {string} event.departmentName Name of department
 * @param {string} event.language Language of the feedback
 * @param {string} event.text Verbatim feedback comment text
 * @param {object} event.analysis Analysis result { language, sentiment, urgent, reason, signals, analysis_source }
 */
export async function notifyUrgentFeedback(pool, event) {
  if (!event || !event.analysis?.urgent) return;

  const logMessage = `🚨 [URGENT FEEDBACK ALERT] ID: ${event.feedbackId || 'N/A'} | Dept: ${event.departmentName || 'N/A'} | Reason: ${event.analysis.reason}`;
  console.warn(logMessage);

  // 1. Record an immediate audit event in the database for tracking & reporting
  try {
    if (pool && typeof pool.query === 'function') {
      await recordAuditEvent(pool, {
        actorId: null, // System event
        action: 'feedback.urgent_alert',
        summary: `Urgent alert triggered: ${event.analysis.reason}`,
        targetType: 'feedback',
        targetId: event.feedbackId || null,
        metadata: {
          departmentName: event.departmentName,
          sentiment: event.analysis.sentiment,
          reason: event.analysis.reason,
          signals: event.analysis.signals,
          analysis_source: event.analysis.analysis_source
        }
      });
    }
  } catch (err) {
    console.error('Failed to log urgent alert audit event:', err.message);
  }

  // 2. Extensible external notification hook
  // If an external webhook is configured in the environment, dispatch it asynchronously:
  if (process.env.URGENT_ALERT_WEBHOOK_URL) {
    try {
      await fetch(process.env.URGENT_ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'urgent_feedback_alert',
          timestamp: new Date().toISOString(),
          feedbackId: event.feedbackId,
          department: event.departmentName,
          reason: event.analysis.reason,
          sentiment: event.analysis.sentiment,
          signals: event.analysis.signals,
          source: event.analysis.analysis_source
        }),
        signal: AbortSignal.timeout(5000)
      });
    } catch (webhookErr) {
      console.warn('Urgent alert webhook delivery failed:', webhookErr.message);
    }
  }
}
