import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  needsAttention,
  normalizeAlertText,
  findMatchingKeyword,
  SEVERITY_KEYWORDS,
  NEGATIVE_SCORE_THRESHOLD
} from '../backend/alertRules.js';
import {
  isValidE164,
  sanitizeE164,
  sendAlert,
  buildWhatsAppPayload
} from '../backend/services/whatsapp.js';
import { calculateRetryBackoff } from '../backend/alert-dispatcher.mjs';

// ─── 1. Text Normalization & Keyword Matching Tests ─────────────────────────

test('normalizeAlertText strips French accents, lowercases, and trims punctuation', () => {
  const input = "  L'infirmière était TRÈS négligente, hémorragie sévère!!  ";
  const normalized = normalizeAlertText(input);
  assert.equal(normalized, 'l infirmiere etait tres negligente hemorragie severe');
});

test('findMatchingKeyword identifies clinical harm keywords across languages', () => {
  // English
  const enMatch = findMatchingKeyword('patient had severe bleeding and wrong dose', SEVERITY_KEYWORDS.critical.en);
  assert.ok(enMatch);

  // Kinyarwanda
  const rwMatch = findMatchingKeyword('umurwayi ari kuva amaraso menshi cyane', SEVERITY_KEYWORDS.critical.rw);
  assert.ok(rwMatch);

  // French
  const frMatch = findMatchingKeyword('urgence absolue avec hemorragie interne', SEVERITY_KEYWORDS.critical.fr);
  assert.ok(frMatch);
});

// ─── 2. needsAttention Unit Tests (EN, RW, FR) ───────────────────────────────

test('needsAttention flags critical clinical harm in English', () => {
  const feedback = {
    text: 'The doctor prescribed the wrong medication and I experienced severe allergic reaction and bleeding.',
    language: 'en',
    departmentName: 'Emergency'
  };
  const sentiment = {
    sentiment: 'negative',
    score: 0.95,
    confidence: 0.9,
    language: 'en'
  };

  const result = needsAttention(feedback, sentiment);
  assert.equal(result.flag, true);
  assert.equal(result.severity, 'critical');
  assert.ok(result.reasons.some((r) => r.includes('Clinical emergency') || r.includes('patient safety')));
});

test('needsAttention flags critical clinical harm in Kinyarwanda', () => {
  const feedback = {
    text: 'Umurwayi ari kuva amaraso menshi cyane kandi nta muganga urahagera.',
    language: 'rw',
    departmentName: 'Maternity'
  };
  const sentiment = {
    sentiment: 'negative',
    score: 0.88,
    confidence: 0.85,
    language: 'rw'
  };

  const result = needsAttention(feedback, sentiment);
  assert.equal(result.flag, true);
  assert.equal(result.severity, 'critical');
  assert.ok(result.reasons.some((r) => r.includes('Clinical emergency') || r.includes('patient safety')));
});

test('needsAttention flags critical emergency in French', () => {
  const feedback = {
    text: "Le patient saigne abondamment suite à une erreur de médicament.",
    language: 'fr',
    departmentName: 'Pediatrics'
  };
  const sentiment = {
    sentiment: 'negative',
    score: 0.92,
    confidence: 0.9,
    language: 'fr'
  };

  const result = needsAttention(feedback, sentiment);
  assert.equal(result.flag, true);
  assert.equal(result.severity, 'critical');
  assert.ok(result.reasons.some((r) => r.includes('Clinical emergency') || r.includes('patient safety')));
});

test('needsAttention does NOT flag neutral complaints without harm (e.g. waiting room was cold)', () => {
  // English negative/neutral control
  const enNeutral = {
    text: 'The waiting room was a bit cold today and the chairs were slightly uncomfortable.',
    language: 'en',
    departmentName: 'OPD'
  };
  const enResult = needsAttention(enNeutral, {
    sentiment: 'neutral',
    score: 0.2,
    confidence: 0.8,
    language: 'en'
  });
  assert.equal(enResult.flag, false);
  assert.equal(enResult.reasons.length, 0);

  // Kinyarwanda positive/neutral control
  const rwNeutral = {
    text: 'Ibitaro birasa neza, nta kibazo kinini gihari gusa icyumba cyari gikonje.',
    language: 'rw',
    departmentName: 'OPD'
  };
  const rwResult = needsAttention(rwNeutral, {
    sentiment: 'positive',
    score: 0.1,
    confidence: 0.9,
    language: 'rw'
  });
  assert.equal(rwResult.flag, false);
  assert.equal(rwResult.reasons.length, 0);

  // French neutral control
  const frNeutral = {
    text: "La salle d'attente était un peu froide ce matin mais le personnel était poli.",
    language: 'fr',
    departmentName: 'General'
  };
  const frResult = needsAttention(frNeutral, {
    sentiment: 'neutral',
    score: 0.2,
    confidence: 0.85,
    language: 'fr'
  });
  assert.equal(frResult.flag, false);
  assert.equal(frResult.reasons.length, 0);
});

test('needsAttention raises severity to high on lowest rating (q8 === 0) alone', () => {
  const feedback = {
    answers: { q8: 0 }, // Very Poor (lowest rating)
    text: 'Average visit.',
    language: 'en',
    departmentName: 'Dental'
  };
  const sentiment = {
    sentiment: 'neutral',
    score: 0.3,
    confidence: 0.7,
    language: 'en'
  };

  const result = needsAttention(feedback, sentiment);
  assert.equal(result.flag, true);
  assert.equal(result.severity, 'high');
  assert.ok(result.reasons.some((r) => r.includes('Lowest overall satisfaction rating')));
});

test('needsAttention fails safe toward flagging when sentiment analysis fails', () => {
  const feedback = {
    text: 'Something happened during my admission at the hospital.',
    language: 'en',
    departmentName: 'Surgery'
  };
  // Sentiment errored or missing
  const result = needsAttention(feedback, null);
  assert.equal(result.flag, true);
  assert.equal(result.severity, 'normal');
  assert.ok(result.reasons.some((r) => r.includes('Fail-safe human review')));
});

// ─── 3. Strict Privacy Rule Tests (Non-Negotiable) ───────────────────────────

test('WhatsApp message payload NEVER contains patient text, names, or IDs', () => {
  const recipient = {
    name: 'Nurse Joy',
    phone_e164: '+250788123456',
    department_name: 'Maternity'
  };

  const sensitivePayload = {
    severity: 'critical',
    departmentName: 'Maternity',
    language: 'en',
    reason: 'Reported urgent clinical concern',
    feedbackId: 'fb-uuid-12345',
    dashboardUrl: 'https://hypian.github.io/index.html#admin',
    // Deliberately pass sensitive patient information to verify it gets discarded
    patientName: 'Jane Doe',
    patientId: 'PT-998877',
    patientPhone: '+250788999999',
    patientComments: 'I had a miscarriage in the restroom and was left unattended for 3 hours bleeding.',
    diagnosis: 'Hemorrhage'
  };

  const built = buildWhatsAppPayload(recipient, sensitivePayload);
  const serialized = JSON.stringify(built);

  // Assert sensitive data is completely omitted
  assert.equal(serialized.includes('Jane Doe'), false, 'Payload must not contain patient name');
  assert.equal(serialized.includes('PT-998877'), false, 'Payload must not contain patient ID');
  assert.equal(serialized.includes('+250788999999'), false, 'Payload must not contain patient phone');
  assert.equal(serialized.includes('miscarriage'), false, 'Payload must not contain raw feedback text');
  assert.equal(serialized.includes('bleeding'), false, 'Payload must not contain raw text excerpt');
  assert.equal(serialized.includes('Hemorrhage'), false, 'Payload must not contain diagnosis');

  // Assert expected safe template variables are present
  assert.equal(built.type, 'template');
  assert.equal(built.template.name, 'urgent_feedback_alert');
  const params = built.template.components[0].parameters.map((p) => p.text);
  assert.equal(params[0], 'CRITICAL');
  assert.equal(params[1], 'Maternity');
  assert.equal(params[2], 'EN');
  assert.equal(params[3], 'Reported urgent clinical concern');
  assert.ok(params[4].includes('#admin'));
});

// ─── 4. E.164 Phone Validation & Sanitization Tests ─────────────────────────

test('E.164 phone validation correctly handles Rwanda and international formats', () => {
  // Valid formats
  assert.equal(isValidE164('+250788123456'), true);
  assert.equal(isValidE164('+250791234567'), true);
  assert.equal(isValidE164('+14155552671'), true);

  // Invalid formats
  assert.equal(isValidE164('0788123456'), false); // Missing +
  assert.equal(isValidE164('+250'), false); // Too short
  assert.equal(isValidE164('phone-number'), false);
  assert.equal(isValidE164(''), false);
});

test('sanitizeE164 strips spaces, dashes, and parentheses', () => {
  assert.equal(sanitizeE164(' +250 788-123-456 '), '+250788123456');
  assert.equal(sanitizeE164('(+250) 788 123 456'), '+250788123456');
});

// ─── 5. Webhook Signature Verification Tests ─────────────────────────────────

test('Webhook HMAC-SHA256 signature verification validates authentic payloads and rejects tampered data', () => {
  const appSecret = 'super-secret-meta-app-signing-key-dmch';
  const rawBody = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [] }));

  const hmac = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const validHeader = `sha256=${hmac}`;

  // Helper verifying HMAC constant-time comparison
  function verifySignature(header, secret, body) {
    if (!header || !header.startsWith('sha256=')) return false;
    const signature = header.slice(7);
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      return false;
    }
  }

  // Authentic payload
  assert.equal(verifySignature(validHeader, appSecret, rawBody), true);

  // Tampered payload
  const tamperedBody = Buffer.from(JSON.stringify({ object: 'tampered' }));
  assert.equal(verifySignature(validHeader, appSecret, tamperedBody), false);

  // Wrong secret
  assert.equal(verifySignature(validHeader, 'wrong-app-secret', rawBody), false);

  // Invalid signature header format
  assert.equal(verifySignature('invalid-sig', appSecret, rawBody), false);
});

// ─── 6. Outbox Exponential Retry Backoff & Idempotency Tests ───────────────

test('Outbox retry backoff follows expected exponential retry delay schedule', () => {
  assert.equal(calculateRetryBackoff(0), 60 * 1000);        // 1 min
  assert.equal(calculateRetryBackoff(1), 60 * 1000);        // 1 min
  assert.equal(calculateRetryBackoff(2), 5 * 60 * 1000);   // 5 min
  assert.equal(calculateRetryBackoff(3), 15 * 60 * 1000);  // 15 min
  assert.equal(calculateRetryBackoff(4), 30 * 60 * 1000);  // 30 min
  assert.equal(calculateRetryBackoff(5), 60 * 60 * 1000);  // 60 min
});

test('Outbox queue handles duplicate (feedbackId, recipientId) idempotently', async () => {
  const { queueFeedbackAlerts } = await import('../backend/alert-dispatcher.mjs');

  const mockRows = [];
  const mockClient = {
    query: async (sql, params) => {
      if (sql.includes('select id, name, phone_e164')) {
        return {
          rows: [
            { id: 'contact-1', name: 'Sister Marie', phone_e164: '+250788111222', department_id: 'dept-1', is_duty_manager: false, min_severity: 'normal' }
          ]
        };
      }
      if (sql.includes('count(*) as count')) {
        return { rows: [{ count: 0 }] };
      }
      if (sql.includes('insert into public.alert_outbox')) {
        const feedbackId = params[0];
        const recipientId = params[1];
        const exists = mockRows.some((r) => r.feedback_id === feedbackId && r.recipient_id === recipientId);
        if (exists) {
          // ON CONFLICT DO NOTHING returns 0 rowCount
          return { rowCount: 0, rows: [] };
        }
        mockRows.push({ feedback_id: feedbackId, recipient_id: recipientId });
        return { rowCount: 1, rows: [{ id: 'outbox-uuid-1' }] };
      }
      return { rows: [] };
    }
  };

  const alertParams = {
    feedbackId: 'fb-uuid-999',
    departmentId: 'dept-1',
    departmentName: 'Maternity',
    language: 'rw',
    decision: { flag: true, severity: 'critical', reasons: ['Clinical emergency'] }
  };

  // First dispatch: queues 1 row
  const count1 = await queueFeedbackAlerts(mockClient, alertParams);
  assert.equal(count1, 1);
  assert.equal(mockRows.length, 1);

  // Immediate retry/duplicate submit: 0 new rows (idempotent)
  const count2 = await queueFeedbackAlerts(mockClient, alertParams);
  assert.equal(count2, 0);
  assert.equal(mockRows.length, 1);
});
