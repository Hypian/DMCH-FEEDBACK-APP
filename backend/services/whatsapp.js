import crypto from 'node:crypto';

const GRAPH_API_VERSION = process.env.WA_API_VERSION || 'v21.0';

/**
 * Validates whether a phone number matches international E.164 standard.
 * Examples: +250788123456, +14155552671
 * @param {string} phone
 * @returns {boolean}
 */
export function isValidE164(phone) {
  if (typeof phone !== 'string') return false;
  const trimmed = phone.trim();
  return /^\+[1-9]\d{7,14}$/.test(trimmed);
}

/**
 * Sanitizes phone input into E.164 standard.
 * @param {string} phone
 * @returns {string}
 */
export function sanitizeE164(phone) {
  if (typeof phone !== 'string') return '';
  const cleaned = phone.replace(/[\s\-\(\)]/g, '').trim();
  if (!cleaned.startsWith('+') && cleaned.startsWith('250')) {
    return `+${cleaned}`;
  }
  return cleaned;
}

/**
 * Builds the Meta Graph API template request body enforcing strict patient privacy.
 * NO patient names, IDs, phone numbers, or raw feedback text are included.
 *
 * @param {object} recipient Staff contact { name, phone_e164 }
 * @param {object} payload Alert details { feedbackId, severity, departmentName, reason, language, dashboardUrl }
 * @returns {object}
 */
export function buildWhatsAppPayload(recipient, payload) {
  const phone = sanitizeE164(recipient.phone_e164 || recipient.phone);
  const waRecipient = phone.replace(/^\+/, '');

  const severityLabel = (payload.severity || 'NORMAL').toUpperCase();
  const departmentLabel = payload.departmentName || 'Out-Patient Department';
  const languageLabel = (payload.language || 'en').toUpperCase();
  const genericReason = payload.reason || 'General attention requested';
  const dashboardLink = payload.dashboardUrl || `${process.env.BETTER_AUTH_URL || 'https://dmc.rw'}#admin`;

  const templateName = payload.templateName || (payload.isEscalation ? 'feedback_escalation' : 'urgent_feedback_alert');

  const bodyParameters = [
    { type: 'text', text: severityLabel },
    { type: 'text', text: departmentLabel },
    { type: 'text', text: languageLabel },
    { type: 'text', text: genericReason },
    { type: 'text', text: dashboardLink }
  ];

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: waRecipient,
    type: 'template',
    template: {
      name: templateName,
      language: {
        code: 'en_US'
      },
      components: [
        {
          type: 'body',
          parameters: bodyParameters
        },
        {
          type: 'button',
          sub_type: 'quick_reply',
          index: '0',
          parameters: [
            {
              type: 'payload',
              payload: `ack_${payload.feedbackId || 'unknown'}`
            }
          ]
        }
      ]
    }
  };
}

/**
 * Generic provider abstraction for dispatching an alert.
 * Swappable interface: sendAlert(recipient, payload)
 *
 * @param {object} recipient Staff contact { id, name, phone_e164 }
 * @param {object} payload Alert details { feedbackId, severity, departmentName, reason, language, dashboardUrl }
 * @returns {Promise<{ ok: boolean, messageId?: string, dryRun?: boolean, error?: string }>}
 */
export async function sendAlert(recipient, payload) {
  const alertsEnabled = process.env.ALERTS_ENABLED === 'true' || process.env.ALERTS_ENABLED === '1';
  const isDryRun = process.env.ALERTS_DRY_RUN !== 'false' && process.env.ALERTS_DRY_RUN !== '0';

  const phone = sanitizeE164(recipient.phone_e164 || recipient.phone);
  if (!isValidE164(phone)) {
    throw new Error(`Invalid recipient E.164 phone number: ${recipient.phone_e164 || 'missing'}`);
  }

  const templateName = payload.templateName || (payload.isEscalation ? 'feedback_escalation' : 'urgent_feedback_alert');
  const severityLabel = (payload.severity || 'NORMAL').toUpperCase();
  const departmentLabel = payload.departmentName || 'Out-Patient Department';
  const genericReason = payload.reason || 'General attention requested';

  // DRY-RUN or DISABLED MODE: Do not make network calls to Meta
  if (!alertsEnabled || isDryRun) {
    const mockMessageId = `mock_wa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    console.log(
      `[WHATSAPP DRY RUN] To: ${phone} (${recipient.name || 'Staff'}) | Template: ${templateName} | Severity: ${severityLabel} | Dept: ${departmentLabel} | Reason: ${genericReason}`
    );
    return {
      ok: true,
      dryRun: true,
      messageId: mockMessageId
    };
  }

  // PRODUCTION MODE: Call Meta Graph API
  const phoneNumberId = process.env.WA_PHONE_NUMBER_ID;
  const accessToken = process.env.WA_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    throw new Error('Meta WhatsApp Cloud API credentials missing (WA_PHONE_NUMBER_ID or WA_ACCESS_TOKEN).');
  }

  const requestBody = buildWhatsAppPayload(recipient, payload);
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMsg = data?.error?.message || `Meta API HTTP error ${response.status}`;
      const errorCode = data?.error?.code || response.status;
      console.error(`[WHATSAPP ERROR] Meta API failed (${errorCode}): ${errorMsg}`);
      throw new Error(`Meta API error ${errorCode}: ${errorMsg}`);
    }

    const messageId = data?.messages?.[0]?.id || `wa_${Date.now()}`;
    return {
      ok: true,
      messageId
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('WhatsApp API request timed out after 8 seconds.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
