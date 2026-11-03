/**
 * intouch.js
 * InTouch SMS (Rwanda) API integration for Dream Medical Center Hospital.
 * Portal: https://portal.intouchsms.co.rw
 * API Documentation: POST https://www.intouchsms.co.rw/api/sendsms/.json
 *
 * PRIVACY GUARANTEE:
 * SMS message payloads NEVER contain patient names, patient phones, patient IDs,
 * diagnoses, or raw clinical feedback commentary.
 */

/**
 * Formats a phone number for the InTouch SMS gateway (Rwanda standard: 07xxxxxxxx).
 * Handles:
 * - E.164 (+250788123456 -> 0788123456)
 * - Country code without plus (250788123456 -> 0788123456)
 * - 9-digit format (788123456 -> 0788123456)
 * - Already standard local (0788123456 -> 0788123456)
 *
 * @param {string} phone
 * @returns {string}
 */
export function formatIntouchRecipient(phone) {
  if (typeof phone !== 'string') return '';
  const cleaned = phone.replace(/[\s\-\(\)\.]/g, '').trim();

  if (cleaned.startsWith('+2507') && cleaned.length === 13) {
    return '0' + cleaned.slice(4);
  }
  if (cleaned.startsWith('2507') && cleaned.length === 12) {
    return '0' + cleaned.slice(3);
  }
  if (cleaned.startsWith('7') && cleaned.length === 9) {
    return '0' + cleaned;
  }
  return cleaned;
}

/**
 * Validates whether a phone number matches international E.164 standard.
 * @param {string} phone
 * @returns {boolean}
 */
export function isValidE164(phone) {
  if (typeof phone !== 'string') return false;
  return /^\+[1-9]\d{7,14}$/.test(phone.trim());
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
 * Validates whether a phone number is acceptable for InTouch SMS (Rwanda mobile or valid E.164).
 * @param {string} phone
 * @returns {boolean}
 */
export function isValidIntouchPhone(phone) {
  if (typeof phone !== 'string') return false;
  const formatted = formatIntouchRecipient(phone);
  // Rwandan local mobile format (072, 073, 078, 079 + 7 digits)
  if (/^07[2389]\d{7}$/.test(formatted)) return true;
  // International E.164 format (+250... or other international)
  const stripped = phone.replace(/[\s\-\(\)\.]/g, '').trim();
  return /^\+[1-9]\d{7,14}$/.test(stripped);
}

/**
 * Extracts human-readable summary metrics from patient survey answers.
 *
 * @param {object} answers Raw answers map from survey submission { cat, time, q3, ... }
 * @returns {{ patientType: string, visitTime: string, waitTime: string }}
 */
export function extractFeedbackSummary(answers = {}) {
  if (!answers || typeof answers !== 'object') {
    return { patientType: '', visitTime: '', waitTime: '' };
  }

  // 1. Patient cohort (cat: 0 = New patient, 1 = Returning patient)
  let patientType = '';
  const rawCat = answers.cat;
  if (rawCat === 0 || rawCat === '0' || (typeof rawCat === 'string' && rawCat.toLowerCase().includes('new'))) {
    patientType = 'New';
  } else if (rawCat === 1 || rawCat === '1' || (typeof rawCat === 'string' && rawCat.toLowerCase().includes('return'))) {
    patientType = 'Returning';
  }

  // 2. Visit time window (time: 0 = 8am-5pm, 1 = 5pm-9pm, 2 = 9pm-8am)
  let visitTime = '';
  const rawTime = answers.time;
  if (rawTime === 0 || rawTime === '0') {
    visitTime = '8am-5pm';
  } else if (rawTime === 1 || rawTime === '1') {
    visitTime = '5pm-9pm';
  } else if (rawTime === 2 || rawTime === '2') {
    visitTime = '9pm-8am';
  } else if (typeof rawTime === 'string' && rawTime.trim()) {
    visitTime = rawTime.trim();
  }

  // 3. Wait time before doctor (q3: 0 = <15m, 1 = 15-30m, 2 = 30-60m, 3 = 1-2h, 4 = >2h)
  let waitTime = '';
  const rawWait = answers.q3;
  if (rawWait === 0 || rawWait === '0') {
    waitTime = '<15m';
  } else if (rawWait === 1 || rawWait === '1') {
    waitTime = '15-30m';
  } else if (rawWait === 2 || rawWait === '2') {
    waitTime = '30-60m';
  } else if (rawWait === 3 || rawWait === '3') {
    waitTime = '1-2h';
  } else if (rawWait === 4 || rawWait === '4') {
    waitTime = '>2h';
  } else if (typeof rawWait === 'string' && rawWait.trim()) {
    waitTime = rawWait.trim();
  }

  return { patientType, visitTime, waitTime };
}

/**
 * Sanitizes text for the standard single-byte GSM 03.38 7-bit alphabet.
 * Characters in the GSM 03.38 extension table ([ ] { } | \ ^ ~ €) require a 0x1B
 * escape byte, which InTouch/SMPP carrier gateways in Rwanda corrupt into "e<", "e>", "e@".
 *
 * @param {string} text
 * @returns {string}
 */
export function sanitizeGsmText(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\s*\|\s*/g, ' - ')
    .replace(/\\/g, '/')
    .replace(/[\^~]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Builds the SMS message text enforcing strict patient privacy.
 * PRIVACY GUARANTEE:
 * NO patient name, ID, phone number, diagnosis, or raw feedback text is included.
 * Uses pure single-byte GSM 03.38 characters (no [ ] | extension characters) to prevent
 * SMPP carrier gateway corruption ("e@", "e<", "e>").
 *
 * @param {object} payload Alert details { feedbackId, severity, departmentName, reason, complaint, answers, metadata, waitTime, patientType, visitTime, language, dashboardUrl, isEscalation, targetCategory }
 * @returns {string} Clean SMS text
 */
export function buildIntouchSmsText(payload = {}) {
  const severityLabel = (payload.severity || 'HIGH').toUpperCase();
  const departmentLabel = payload.departmentName || 'General';
  const categorySuffix = payload.targetCategory
    ? ` - ${payload.targetCategory === 'managing_director' ? 'MD' : payload.targetCategory === 'public_relations' ? 'PR' : 'CLINICAL'}`
    : '';
  const languageLabel = (payload.language || 'en').toUpperCase();
  const genericComplaint = payload.complaint || payload.reason || 'Immediate attention requested';
  const dashboardLink = payload.dashboardUrl || `${process.env.BETTER_AUTH_URL || 'https://dmc.rw'}#admin`;

  const header = payload.isEscalation
    ? `DMCH ESCALATION (${severityLabel}${categorySuffix})`
    : `DMCH ALERT (${severityLabel}${categorySuffix})`;

  const extracted = extractFeedbackSummary(payload.answers || payload.metadata || {});
  const waitTime = payload.waitTime || extracted.waitTime;
  const patientType = payload.patientType || extracted.patientType;
  const visitTime = payload.visitTime || extracted.visitTime;

  const summaryParts = [];
  if (waitTime) summaryParts.push(`Wait: ${waitTime}`);
  if (patientType) summaryParts.push(`Patient: ${patientType}`);
  if (visitTime) summaryParts.push(`Visit: ${visitTime}`);

  const summarySuffix = summaryParts.length ? `. ${summaryParts.join(', ')}` : '';

  return sanitizeGsmText(
    `${header} ${departmentLabel}: ${genericComplaint}${summarySuffix}. Lang: ${languageLabel}. Review securely: ${dashboardLink}`
  );
}

/**
 * Dispatches an SMS alert using the InTouch SMS Rwanda API.
 *
 * @param {object} recipient Staff contact { id, name, phone_e164, phone }
 * @param {object} payload Alert details { feedbackId, severity, departmentName, reason, language, dashboardUrl, isEscalation, targetCategory }
 * @param {object} [options] Custom options or test mocks
 * @returns {Promise<{ ok: boolean, messageId?: string, dryRun?: boolean, provider: string, error?: string }>}
 */
export async function sendIntouchSms(recipient, payload = {}, options = {}) {
  const isDryRun = options.dryRun ?? (process.env.ALERTS_DRY_RUN !== 'false' && process.env.ALERTS_DRY_RUN !== '0');
  const rawPhone = recipient.phone_e164 || recipient.phone;

  if (!isValidIntouchPhone(rawPhone)) {
    throw new Error(`Invalid recipient phone for InTouch SMS: ${rawPhone}`);
  }

  const formattedPhone = formatIntouchRecipient(rawPhone);
  const messageText = buildIntouchSmsText(payload);

  if (isDryRun) {
    const mockId = `mock_intouch_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    console.log(`[INTOUCH SMS DRY RUN] To: ${formattedPhone} (${recipient.name || 'Staff'}) | Text: "${messageText}"`);
    return {
      ok: true,
      messageId: mockId,
      dryRun: true,
      provider: 'intouch',
      recipient: formattedPhone
    };
  }

  const username = options.username || process.env.INTOUCH_SMS_USERNAME;
  const password = options.password || process.env.INTOUCH_SMS_PASSWORD;
  const sender = options.sender || process.env.INTOUCH_SMS_SENDER || 'InTouch';
  const baseUrl = process.env.BETTER_AUTH_URL || 'https://dmc.rw';
  const dlrurl = options.dlrurl || process.env.INTOUCH_DLR_URL || `${baseUrl.replace(/\/+$/, '')}/webhooks/intouch`;

  if (!username || !password) {
    throw new Error('InTouch SMS credentials (INTOUCH_SMS_USERNAME, INTOUCH_SMS_PASSWORD) not configured.');
  }

  const fetchFn = options.fetchImpl || fetch;
  const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');

  const formData = new URLSearchParams();
  formData.append('recipients', formattedPhone);
  formData.append('message', messageText);
  formData.append('sender', sender);
  if (dlrurl) {
    formData.append('dlrurl', dlrurl);
  }

  const url = options.apiUrl || 'https://www.intouchsms.co.rw/api/sendsms/.json';

  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formData.toString(),
    signal: AbortSignal.timeout(options.timeoutMs || 25000)
  });

  const resText = await res.text().catch(() => '');
  let resJson = null;
  try {
    resJson = JSON.parse(resText);
  } catch {
    // text fallback
  }

  if (!res.ok) {
    throw new Error(`InTouch SMS API HTTP ${res.status}: ${resText.slice(0, 200)}`);
  }

  if (resJson && resJson.success === false) {
    const errorDetail = resJson.response?.[0]?.errors?.error || resJson.response?.[0]?.errors?.action || resJson.message || resText;
    throw new Error(`InTouch SMS API error: ${errorDetail}`);
  }

  const messageId =
    resJson?.details?.[0]?.messageid ||
    resJson?.messageid ||
    resJson?.id ||
    resJson?.details?.messageid ||
    `intouch_${Date.now()}`;

  return {
    ok: true,
    messageId: String(messageId),
    dryRun: false,
    provider: 'intouch',
    response: resJson || resText
  };
}
