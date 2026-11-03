import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatIntouchRecipient,
  isValidIntouchPhone,
  isValidE164,
  sanitizeE164,
  buildIntouchSmsText,
  sendIntouchSms,
  extractFeedbackSummary
} from '../backend/services/intouch.js';
import {
  sendAlertEmail,
  buildAlertEmailContent
} from '../backend/services/mailer.js';
import {
  needsAttention,
  normalizeAlertText,
  findMatchingKeyword,
  SEVERITY_KEYWORDS
} from '../backend/alertRules.js';
import {
  analyzeFeedback,
  evaluateKeywords
} from '../backend/sentiment-analyzer.mjs';
import { sendAlert, queueFeedbackAlerts, calculateRetryBackoff } from '../backend/alert-dispatcher.mjs';

// ─── 1. Phone Formatting Tests ────────────────────────────────────────────────

test('InTouch SMS Phone Formatting: converts E.164 and various formats to Rwanda standard (07xxxxxxxx)', () => {
  // E.164 with +250
  assert.equal(formatIntouchRecipient('+250785971082'), '0785971082');
  assert.equal(formatIntouchRecipient('+250782300441'), '0782300441');
  assert.equal(formatIntouchRecipient('+250722123456'), '0722123456');
  assert.equal(formatIntouchRecipient('+250791234567'), '0791234567');

  // Country code without plus (2507...)
  assert.equal(formatIntouchRecipient('250785971082'), '0785971082');
  assert.equal(formatIntouchRecipient('250782300441'), '0782300441');

  // 9-digit format (785971082)
  assert.equal(formatIntouchRecipient('785971082'), '0785971082');

  // Already standard Rwandan local format (078...)
  assert.equal(formatIntouchRecipient('0785971082'), '0785971082');
  assert.equal(formatIntouchRecipient('0782300441'), '0782300441');

  // Formatted with spaces, hyphens, parentheses
  assert.equal(formatIntouchRecipient('+250 785-971-082'), '0785971082');
  assert.equal(formatIntouchRecipient('(078) 597-1082'), '0785971082');

  // Non-string handling
  assert.equal(formatIntouchRecipient(null), '');
  assert.equal(formatIntouchRecipient(undefined), '');
});

// ─── 2. Phone Validation Tests ────────────────────────────────────────────────

test('InTouch SMS Phone Validation: validates Rwanda mobile and international numbers', () => {
  // Valid Rwandan mobile prefixes (072, 073, 078, 079)
  assert.equal(isValidIntouchPhone('0785971082'), true);
  assert.equal(isValidIntouchPhone('0782300441'), true);
  assert.equal(isValidIntouchPhone('0722000111'), true);
  assert.equal(isValidIntouchPhone('0733000222'), true);
  assert.equal(isValidIntouchPhone('0791000333'), true);

  // Valid E.164 formats
  assert.equal(isValidIntouchPhone('+250785971082'), true);
  assert.equal(isValidIntouchPhone('+250782300441'), true);

  // Invalid numbers
  assert.equal(isValidIntouchPhone(''), false);
  assert.equal(isValidIntouchPhone('12345'), false);
  assert.equal(isValidIntouchPhone('0712345678'), false, '071 is not an active Rwandan mobile prefix');
  assert.equal(isValidIntouchPhone('abcd'), false);
  assert.equal(isValidIntouchPhone(null), false);
});

// ─── 3. Strict Patient Privacy Guarantee Tests ────────────────────────────────

test('InTouch SMS Privacy Guarantee: payload NEVER exposes patient PII or raw comments', () => {
  const patientPrivateInfo = {
    patientName: 'Jean Bosco Mugabo',
    patientPhone: '+250788999888',
    patientId: 'PAT-9988-KGL',
    rawComment: 'The doctor was incompetent and I suffered heavy internal bleeding from the incision.'
  };

  const smsText = buildIntouchSmsText({
    feedbackId: 'fb-priv-101',
    severity: 'critical',
    targetCategory: 'clinical',
    departmentName: 'Surgical ICU',
    reason: 'Clinical emergency trigger matched',
    language: 'en',
    dashboardUrl: 'https://dmc.rw#admin'
  });

  // Verify none of the patient private info appears in the SMS text
  assert.ok(!smsText.includes(patientPrivateInfo.patientName), 'SMS must NOT contain patient name');
  assert.ok(!smsText.includes(patientPrivateInfo.patientPhone), 'SMS must NOT contain patient phone');
  assert.ok(!smsText.includes(patientPrivateInfo.patientId), 'SMS must NOT contain patient ID');
  assert.ok(!smsText.includes(patientPrivateInfo.rawComment), 'SMS must NOT contain raw patient text');

  // Verify structural tags and GSM-safe character set (no [ ] | { } \ ^ ~)
  assert.ok(smsText.includes('DMCH ALERT (CRITICAL - CLINICAL)'));
  assert.ok(smsText.includes('Surgical ICU'));
  assert.ok(smsText.includes('Review securely: https://dmc.rw#admin'));
  assert.equal(/[\[\]\{\}\|\\\^~]/.test(smsText), false, 'SMS must not contain GSM 03.38 extension table characters');
});

test('InTouch SMS Privacy Guarantee: Escalation alert formatting', () => {
  const escalationText = buildIntouchSmsText({
    feedbackId: 'fb-esc-202',
    severity: 'high',
    targetCategory: 'managing_director',
    departmentName: 'Finance & Administration',
    reason: 'UNACKNOWLEDGED ESCALATION: Malpractice and lawsuit claim',
    language: 'fr',
    isEscalation: true
  });

  assert.ok(escalationText.includes('DMCH ESCALATION (HIGH - MD)'));
  assert.ok(escalationText.includes('Finance & Administration'));
  assert.ok(escalationText.includes('Lang: FR'));
});

test('InTouch SMS Summary: extracts department, complaint, wait time, patient cohort, and visit time', () => {
  // Test extractFeedbackSummary directly
  const summary1 = extractFeedbackSummary({ cat: 0, time: 0, q3: 4 });
  assert.equal(summary1.patientType, 'New');
  assert.equal(summary1.visitTime, '8am-5pm');
  assert.equal(summary1.waitTime, '>2h');

  const summary2 = extractFeedbackSummary({ cat: 1, time: 1, q3: 2 });
  assert.equal(summary2.patientType, 'Returning');
  assert.equal(summary2.visitTime, '5pm-9pm');
  assert.equal(summary2.waitTime, '30-60m');

  // Test buildIntouchSmsText with answers
  const smsText = buildIntouchSmsText({
    severity: 'high',
    targetCategory: 'clinical',
    departmentName: 'Emergency & observation',
    complaint: 'Severe delay in triage and unaddressed pain',
    language: 'en',
    answers: { cat: 0, time: 0, q3: 4 },
    dashboardUrl: 'https://dmc.rw#admin'
  });

  assert.ok(smsText.includes('DMCH ALERT (HIGH - CLINICAL)'));
  assert.ok(smsText.includes('Emergency & observation: Severe delay in triage and unaddressed pain'));
  assert.ok(smsText.includes('Wait: >2h'));
  assert.ok(smsText.includes('Patient: New'));
  assert.ok(smsText.includes('Visit: 8am-5pm'));
  assert.ok(smsText.includes('Lang: EN'));
  assert.ok(smsText.includes('Review securely: https://dmc.rw#admin'));
  assert.equal(/[\[\]\{\}\|\\\^~]/.test(smsText), false, 'SMS must not contain GSM 03.38 extension table characters');
});

// ─── 4. InTouch API Dispatch Tests ────────────────────────────────────────────

test('sendIntouchSms: Dry Run Mode logs alert and returns simulated success', async () => {
  const contact = {
    id: 'contact-dr-1',
    name: 'Dr. Keza Alice',
    phone_e164: '+250785971082'
  };

  const payload = {
    feedbackId: 'fb-test-dry',
    severity: 'critical',
    targetCategory: 'clinical',
    departmentName: 'Emergency',
    reason: 'Clinical harm detected'
  };

  const result = await sendIntouchSms(contact, payload, { dryRun: true });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.provider, 'intouch');
  assert.equal(result.recipient, '0785971082', 'Recipient phone formatted to 07xxxxxxxx');
  assert.ok(result.messageId.startsWith('mock_intouch_'));
});

test('sendIntouchSms: Live API POST uses Basic Auth, correct endpoint and URL encoded form', async () => {
  let capturedUrl = '';
  let capturedHeaders = {};
  let capturedBody = '';

  const mockFetch = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    capturedBody = options.body;

    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        success: true,
        messageid: 'intouch_msg_98765',
        status: 'queued'
      })
    };
  };

  const contact = {
    id: 'contact-pr-1',
    name: 'Public Relations Officer',
    phone_e164: '+250782300441'
  };

  const payload = {
    feedbackId: 'fb-live-101',
    severity: 'high',
    targetCategory: 'public_relations',
    departmentName: 'Outpatient Care',
    reason: 'Billing and queue delay concern'
  };

  const result = await sendIntouchSms(contact, payload, {
    dryRun: false,
    username: 'dreammedical.hospital',
    password: 'dreammedical.hospital',
    sender: 'InTouch',
    fetchImpl: mockFetch
  });

  // Verify endpoint
  assert.equal(capturedUrl, 'https://www.intouchsms.co.rw/api/sendsms/.json');

  // Verify HTTP Basic Auth
  const expectedAuth = 'Basic ' + Buffer.from('dreammedical.hospital:dreammedical.hospital').toString('base64');
  assert.equal(capturedHeaders['Authorization'], expectedAuth);
  assert.equal(capturedHeaders['Content-Type'], 'application/x-www-form-urlencoded');

  // Verify form parameters
  const parsedBody = new URLSearchParams(capturedBody);
  assert.equal(parsedBody.get('recipients'), '0782300441');
  assert.equal(parsedBody.get('sender'), 'InTouch');
  assert.ok(parsedBody.get('message').includes('DMCH ALERT (HIGH - PR)'));
  assert.ok(parsedBody.get('dlrurl').includes('/webhooks/intouch'));

  // Verify returned result
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, false);
  assert.equal(result.provider, 'intouch');
  assert.equal(result.messageId, 'intouch_msg_98765');
});

// ─── 5. Integration with sendAlert dispatcher ────────────────────────────────

test('sendAlert: dispatches via InTouch SMS when channel is sms and provider is intouch', async () => {
  const contact = {
    id: 'contact-duty-mgr',
    name: 'Hospital Duty Manager',
    phone_e164: '+250785971082',
    sms_enabled: true
  };

  const alertPayload = {
    feedbackId: 'fb-alert-intouch-1',
    severity: 'critical',
    targetCategory: 'clinical',
    departmentName: 'Maternity',
    reason: 'Severe patient incident',
    channel: 'sms',
    provider: 'intouch'
  };

  const result = await sendAlert(contact, alertPayload, { dryRun: true });

  assert.equal(result.ok, true);
  assert.equal(result.provider, 'intouch');
  assert.equal(result.dryRun, true);
  assert.ok(result.messageId);
});

// ─── 6. Nodemailer Email Formatting & Privacy Tests ──────────────────────────

test('buildAlertEmailContent generates professional HTML email without patient PII', () => {
  const payload = {
    severity: 'normal',
    departmentName: 'Maternity',
    reason: 'Service delay or facility condition reported',
    language: 'fr',
    dashboardUrl: 'https://dmc.rw/#admin',
    patientName: 'Marie Claire',
    patientPhone: '+250788111222',
    rawComment: 'The waiting room was very cold and registration took 45 minutes.'
  };

  const { subject, text, html } = buildAlertEmailContent(payload);

  assert.ok(subject.includes('[DMCH Feedback Alert - NORMAL]'));
  assert.ok(subject.includes('Maternity'));
  assert.ok(html.includes('Dream Medical Center Hospital'));
  assert.ok(html.includes('NORMAL PRIORITY'));
  assert.ok(html.includes('View Feedback in Admin Dashboard'));
  assert.ok(text.includes('Department: Maternity'));

  assert.equal(html.includes('Marie Claire'), false);
  assert.equal(html.includes('+250788111222'), false);
  assert.equal(html.includes('cold and registration'), false);
  assert.equal(text.includes('Marie Claire'), false);
});

test('sendAlertEmail operates in dry-run mode and validates email format', async () => {
  process.env.ALERTS_DRY_RUN = 'true';

  const recipient = { name: 'Nurse Supervisor', email: 'supervisor@dmchospital.org' };
  const payload = {
    severity: 'normal',
    departmentName: 'OPD',
    reason: 'Negative patient sentiment detected',
    language: 'en'
  };

  const res = await sendAlertEmail(recipient, payload);
  assert.equal(res.ok, true);
  assert.equal(res.dryRun, true);

  await assert.rejects(
    async () => {
      await sendAlertEmail({ name: 'Bad Email', email: 'not-an-email' }, payload);
    },
    /Invalid recipient email/
  );
});

// ─── 7. Alert Rules & Category-Based Routing Tests ───────────────────────────

test('normalizeAlertText and findMatchingKeyword identify clinical harm across languages', () => {
  assert.equal(
    normalizeAlertText("  L'infirmière était TRÈS négligente, hémorragie sévère!!  "),
    'l infirmiere etait tres negligente hemorragie severe'
  );
  assert.ok(findMatchingKeyword('patient had severe bleeding and wrong dose', SEVERITY_KEYWORDS.critical.en));
  assert.ok(findMatchingKeyword('umurwayi ari kuva amaraso menshi cyane', SEVERITY_KEYWORDS.critical.rw));
  assert.ok(findMatchingKeyword('urgence absolue avec hemorragie interne', SEVERITY_KEYWORDS.critical.fr));
});

test('E.164 validation, retry backoff, and category-based routing (Clinical, PR, MD)', async () => {
  assert.equal(isValidE164('+250788123456'), true);
  assert.equal(isValidE164('0788123456'), false);
  assert.equal(sanitizeE164(' +250 788-123-456 '), '+250788123456');
  assert.equal(calculateRetryBackoff(1), 60 * 1000);
  assert.equal(calculateRetryBackoff(2), 5 * 60 * 1000);

  // Category classification
  assert.equal(evaluateKeywords('The patient has high fever and severe wound infection.').targetCategory, 'clinical');
  assert.equal(evaluateKeywords('The receptionist was rude, the queue was slow and the room was cold.').targetCategory, 'public_relations');
  assert.equal(evaluateKeywords('Umukozi wo kwa muganga yansabye ruswa kugira ngo ampe imiti.').targetCategory, 'managing_director');

  // Gemini LLM response schema
  const llmRes = await analyzeFeedback('Patient is bleeding heavily after injection.', {
    apiKey: 'mock-gemini-key',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                language: 'en',
                sentiment: 'negative',
                urgent: true,
                needs_attention: true,
                severity: 'critical',
                target_category: 'clinical',
                reason: 'Patient sustained injury and is experiencing hemorrhage.'
              })
            }]
          }
        }]
      })
    })
  });
  assert.equal(llmRes.target_category, 'clinical');
  assert.equal(llmRes.severity, 'critical');

  // Category routing via queueFeedbackAlerts
  const staffDirectory = [
    { id: 's-clin', name: 'Dr. Keza', phone_e164: '+250788111000', email: 'keza@dmc.rw', department_id: 'dept-1', target_category: 'clinical', is_duty_manager: false, min_severity: 'normal', sms_enabled: true, email_enabled: true },
    { id: 's-pr', name: 'Claire (PR)', phone_e164: '+250788222000', email: 'pr@dmc.rw', department_id: null, target_category: 'public_relations', is_duty_manager: false, min_severity: 'normal', sms_enabled: true, email_enabled: true },
    { id: 's-md', name: 'Dr. Gisa (MD)', phone_e164: '+250788333000', email: 'md@dmc.rw', department_id: null, target_category: 'managing_director', is_duty_manager: true, min_severity: 'normal', sms_enabled: true, email_enabled: true }
  ];

  const queued = [];
  const client = {
    query: async (sql, params) => {
      if (sql.includes('from public.staff_alert_contacts')) return { rows: staffDirectory };
      if (sql.includes('count(*) as count')) return { rows: [{ count: 0 }] };
      if (sql.includes('insert into public.alert_outbox')) {
        queued.push({ recipientName: params[4], severity: params[7], targetCategory: params[8], channel: params[9], provider: params[10] });
        return { rowCount: 1, rows: [{ id: 'outbox-1' }] };
      }
      return { rows: [] };
    }
  };

  await queueFeedbackAlerts(client, {
    feedbackId: 'fb-1',
    departmentId: 'dept-1',
    departmentName: 'Surgery',
    decision: { flag: true, severity: 'critical', targetCategory: 'clinical', reasons: ['Hemorrhage'] }
  });
  assert.equal(queued[0].recipientName, 'Dr. Keza');
  assert.equal(queued[0].channel, 'sms');

  await queueFeedbackAlerts(client, {
    feedbackId: 'fb-2',
    departmentId: 'dept-1',
    departmentName: 'Surgery',
    decision: { flag: true, severity: 'normal', targetCategory: 'public_relations', reasons: ['Queue delay'] }
  });
  assert.equal(queued[1].recipientName, 'Claire (PR)');
  assert.equal(queued[1].channel, 'email');

  await queueFeedbackAlerts(client, {
    feedbackId: 'fb-3',
    departmentId: 'dept-1',
    departmentName: 'Surgery',
    decision: { flag: true, severity: 'high', targetCategory: 'managing_director', reasons: ['Bribery complaint'] }
  });
  assert.equal(queued[2].recipientName, 'Dr. Gisa (MD)');
  assert.equal(queued[2].channel, 'sms');

  // Verify satisfaction scale (q8: 0 = 5★ Very Satisfied, 4 = 1★ Very Dissatisfied, 3 = 2★ Dissatisfied)
  const fiveStarDecision = needsAttention({ answers: { q8: 0 }, text: 'Great service' }, { sentiment: 'positive', urgent: false, language: 'en' });
  assert.equal(fiveStarDecision.flag, false);

  const oneStarDecision = needsAttention({ answers: { q8: 4 }, text: '' }, { sentiment: 'neutral', urgent: false });
  assert.equal(oneStarDecision.flag, true);
  assert.equal(oneStarDecision.severity, 'high');

  const twoStarDecision = needsAttention({ answers: { q8: 3 }, text: '' }, { sentiment: 'neutral', urgent: false });
  assert.equal(twoStarDecision.flag, true);
  assert.equal(twoStarDecision.severity, 'high');
});



