import nodemailer from 'nodemailer';
import { extractFeedbackSummary } from './intouch.js';

/**
 * Validates basic email format.
 * @param {string} email
 * @returns {boolean}
 */
export function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Escapes HTML special characters to prevent markup injection in HTML emails.
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Builds clean, responsive, DMC-branded HTML email for staff feedback alerts.
 * PRIVACY GUARANTEE:
 * Verbatim patient text, names, and identifiers are strictly excluded.
 *
 * @param {object} payload Alert details { feedbackId, severity, departmentName, reason, language, dashboardUrl, isEscalation }
 * @returns {{ subject: string, text: string, html: string }}
 */
export function buildAlertEmailContent(payload = {}) {
  const severity = (payload.severity || 'NORMAL').toUpperCase();
  const department = payload.departmentName || 'General';
  const language = (payload.language || 'en').toUpperCase();
  const reason = payload.reason || 'Staff review requested';
  const dashboardLink = payload.dashboardUrl || `${process.env.BETTER_AUTH_URL || 'https://dmc.rw'}#admin`;
  const isEscalation = Boolean(payload.isEscalation);

  const categoryLabel = payload.targetCategory
    ? (payload.targetCategory === 'managing_director' ? 'Managing Director' : payload.targetCategory === 'public_relations' ? 'Public Relations' : 'Clinical')
    : null;

  const subjectPrefix = isEscalation
    ? `[DMCH ESCALATION - ${severity}]`
    : `[DMCH Feedback Alert - ${severity}${categoryLabel ? ' | ' + categoryLabel.toUpperCase() : ''}]`;
  const subject = `${subjectPrefix} ${department}: ${reason}`;

  const badgeColor = severity === 'CRITICAL'
    ? '#dc2626'
    : severity === 'HIGH'
      ? '#ea580c'
      : '#2563eb';

  const extracted = extractFeedbackSummary(payload.answers || payload.metadata || {});
  const waitTime = payload.waitTime || extracted.waitTime;
  const patientType = payload.patientType || extracted.patientType;
  const visitTime = payload.visitTime || extracted.visitTime;

  const plainText = `${subject}

Department: ${department}
${categoryLabel ? `Audience / Category: ${categoryLabel}\n` : ''}Severity: ${severity}
Complaint / Reason: ${reason}
${waitTime ? `Wait Time: ${waitTime}\n` : ''}${patientType ? `Patient Category: ${patientType}\n` : ''}${visitTime ? `Visit Time: ${visitTime}\n` : ''}Detected Language: ${language}

Review this feedback securely on the DMC Admin Dashboard:
${dashboardLink}

Notice: To protect patient privacy, patient identification and verbatim clinical comments are restricted to authenticated staff inside the secure hospital portal.`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b;">
  <table role="presentation" style="width: 100%; max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.04);">
    <tr>
      <td style="padding: 28px 32px; background: #ffffff; border-bottom: 2px solid #f1f5f9;">
        <h2 style="margin: 0; font-size: 20px; font-weight: 700; color: #0f172a; letter-spacing: -0.02em;">
          Dream Medical Center Hospital
        </h2>
        <p style="margin: 4px 0 0; font-size: 13px; color: #64748b; font-weight: 500;">
          Patient Experience & Quality Assurance Alert System
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding: 32px;">
        <div style="display: inline-block; padding: 4px 12px; font-size: 12px; font-weight: 700; color: #ffffff; background-color: ${badgeColor}; border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 16px;">
          ${isEscalation ? 'ESCALATION • ' : ''}${escapeHtml(severity)} PRIORITY${categoryLabel ? ' • ' + escapeHtml(categoryLabel.toUpperCase()) : ''}
        </div>

        <h3 style="margin: 0 0 16px; font-size: 18px; font-weight: 600; color: #0f172a;">
          New patient feedback requires review
        </h3>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px; width: 140px; font-weight: 500;">Department:</td>
            <td style="padding: 8px 0; color: #0f172a; font-size: 14px; font-weight: 600;">${escapeHtml(department)}</td>
          </tr>
          ${categoryLabel ? `<tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px; font-weight: 500;">Target Audience:</td>
            <td style="padding: 8px 0; color: #0f172a; font-size: 14px; font-weight: 600;">${escapeHtml(categoryLabel)}</td>
          </tr>` : ''}
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px; font-weight: 500;">Complaint / Reason:</td>
            <td style="padding: 8px 0; color: #0f172a; font-size: 14px; font-weight: 600;">${escapeHtml(reason)}</td>
          </tr>
          ${waitTime ? `<tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px; font-weight: 500;">Wait Time:</td>
            <td style="padding: 8px 0; color: #0f172a; font-size: 14px; font-weight: 600;">${escapeHtml(waitTime)}</td>
          </tr>` : ''}
          ${patientType ? `<tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px; font-weight: 500;">Patient Category:</td>
            <td style="padding: 8px 0; color: #0f172a; font-size: 14px; font-weight: 600;">${escapeHtml(patientType)} Patient</td>
          </tr>` : ''}
          ${visitTime ? `<tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px; font-weight: 500;">Visit Time:</td>
            <td style="padding: 8px 0; color: #0f172a; font-size: 14px; font-weight: 600;">${escapeHtml(visitTime)}</td>
          </tr>` : ''}
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px; font-weight: 500;">Detected Language:</td>
            <td style="padding: 8px 0; color: #0f172a; font-size: 14px; font-weight: 600;">${escapeHtml(language)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px; font-weight: 500;">Timestamp:</td>
            <td style="padding: 8px 0; color: #0f172a; font-size: 14px; font-weight: 500;">${new Date().toUTCString()}</td>
          </tr>
        </table>

        <div style="text-align: center; margin: 32px 0 24px;">
          <a href="${escapeHtml(dashboardLink)}" style="display: inline-block; background-color: #E54B2B; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 14px; box-shadow: 0 4px 12px rgba(229, 75, 43, 0.28);">
            View Feedback in Admin Dashboard
          </a>
        </div>

        <div style="padding: 16px; background-color: #f8fafc; border-radius: 8px; border-left: 3px solid #94a3b8; font-size: 12px; line-height: 1.5; color: #64748b;">
          <strong>Confidentiality Notice:</strong> Patient identifying details and clinical commentary are kept strictly confidential under DMC Hospital policy. Please authenticate via the dashboard above to inspect and acknowledge this response.
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding: 20px 32px; background: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center; font-size: 12px; color: #94a3b8;">
        Dream Medical Center Hospital • Kigali, Rwanda
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text: plainText, html };
}

let cachedTransporter = null;

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host) {
    return null;
  }

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined
  });

  return cachedTransporter;
}

/**
 * Dispatches an email alert using Nodemailer.
 *
 * @param {object} recipient Staff contact { id, name, email }
 * @param {object} payload Alert details { feedbackId, severity, departmentName, reason, language, dashboardUrl, isEscalation }
 * @returns {Promise<{ ok: boolean, messageId?: string, dryRun?: boolean, error?: string }>}
 */
export async function sendAlertEmail(recipient, payload = {}, options = {}) {
  const alertsEnabled = process.env.ALERTS_ENABLED === 'true' || process.env.ALERTS_ENABLED === '1';
  const isDryRun = options.dryRun !== undefined
    ? Boolean(options.dryRun)
    : (process.env.ALERTS_DRY_RUN !== 'false' && process.env.ALERTS_DRY_RUN !== '0');

  const email = (recipient.email || '').trim();
  if (!isValidEmail(email)) {
    throw new Error(`Invalid recipient email address: ${recipient.email || 'missing'}`);
  }

  const { subject, text, html } = buildAlertEmailContent(payload);

  // DRY-RUN or DISABLED MODE: Do not make network calls to SMTP server
  if (!alertsEnabled || isDryRun) {
    const mockMsgId = `mock_mail_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@dmchospital.org`;
    console.log(
      `[NODEMAILER EMAIL DRY RUN] To: ${email} (${recipient.name || 'Staff'}) | Subject: "${subject}"`
    );
    return {
      ok: true,
      dryRun: true,
      messageId: mockMsgId
    };
  }

  // PRODUCTION MODE: Send through SMTP transporter
  const transporter = getTransporter();
  if (!transporter) {
    throw new Error('SMTP configuration missing (SMTP_HOST required in environment).');
  }

  const fromAddress = process.env.EMAIL_FROM || '"DMCH Patient Alerts" <alerts@dmchospital.org>';

  const info = await transporter.sendMail({
    from: fromAddress,
    to: email,
    subject,
    text,
    html
  });

  return {
    ok: true,
    messageId: info.messageId || `mail_${Date.now()}`
  };
}

