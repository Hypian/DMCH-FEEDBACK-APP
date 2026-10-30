import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeText,
  redactPII,
  evaluateKeywords,
  analyzeFeedback
} from '../backend/sentiment-analyzer.mjs';

test('Kinyarwanda agglutinative stems match inflected positive and negative verbs', () => {
  const praise = evaluateKeywords('Murakoze cyane, abaganga banyitayeho neza cyane kandi bakirana urugwiro.');
  assert.equal(praise.language, 'rw');
  assert.equal(praise.sentiment, 'positive');
  assert.equal(praise.urgent, false);
  assert.ok(praise.signals.includes('keyword:positive:rw:itayeho'));

  const waitComplaint = evaluateKeywords('Batinze kumpa imiti, nategereje amasaha menshi.');
  assert.equal(waitComplaint.language, 'rw');
  assert.equal(waitComplaint.sentiment, 'negative');
  assert.equal(waitComplaint.urgent, false);
  assert.ok(waitComplaint.signals.includes('keyword:negative:rw:tinze'));
  assert.ok(waitComplaint.signals.includes('keyword:negative:rw:tegereje'));
});

test('Kinyarwanda negation words (ntabwo, nta, si) flip sentiment polarity within clause', () => {
  const negatedGood = evaluateKeywords('Ntabwo byari byiza na gato');
  assert.equal(negatedGood.language, 'rw');
  assert.equal(negatedGood.sentiment, 'negative');
  assert.equal(negatedGood.urgent, false);
  assert.ok(negatedGood.signals.includes('keyword:negative:rw:not-byiza'));

  const negatedProblem = evaluateKeywords('Nta kibazo, byose byagenze neza');
  assert.equal(negatedProblem.language, 'rw');
  assert.equal(negatedProblem.sentiment, 'positive');
  assert.equal(negatedProblem.urgent, false);
  assert.ok(negatedProblem.signals.includes('keyword:positive:rw:not-kibazo'));
});

test('Kinyarwanda morphological negative verb prefixes (nti-, sin-) flip positive stems to negative', () => {
  const ignored = evaluateKeywords('Ntibanyitayeho kandi serivisi yari mbi');
  assert.equal(ignored.language, 'rw');
  assert.equal(ignored.sentiment, 'negative');
  assert.ok(ignored.signals.includes('keyword:negative:rw:not-itayeho'));

  const dissatisfied = evaluateKeywords('Sinishimiye uko banyakiye');
  assert.equal(dissatisfied.language, 'rw');
  assert.equal(dissatisfied.sentiment, 'negative');
  assert.ok(dissatisfied.signals.includes('keyword:negative:rw:sinishimiye'));
});

test('Kinyarwanda clause breaker (ariko) isolates negation to its own clause', () => {
  const mixed = evaluateKeywords('Abaganga banyitayeho neza ariko nategereje igihe kirekire');
  assert.equal(mixed.language, 'rw');
  assert.equal(mixed.sentiment, 'neutral');
  assert.equal(mixed.urgent, false);
});

test('Kinyarwanda false-positive traps (amafaranga, amaraso, bibiri) do not trigger false urgent/negative', () => {
  const paidMoney = evaluateKeywords('Nishyuye amafaranga kuri caisse kandi banyitayeho neza');
  assert.equal(paidMoney.language, 'rw');
  assert.equal(paidMoney.sentiment, 'positive');
  assert.equal(paidMoney.urgent, false);

  const bloodTest = evaluateKeywords('Bampimye amaraso muri laboratoire kandi ibisubizo byaje vuba');
  assert.equal(bloodTest.language, 'rw');
  assert.equal(bloodTest.sentiment, 'positive');
  assert.equal(bloodTest.urgent, false);

  const twoHours = evaluateKeywords('Ibintu bibiri byagenze neza cyane');
  assert.equal(twoHours.language, 'rw');
  assert.equal(twoHours.sentiment, 'positive');
  assert.ok(!twoHours.signals.includes('keyword:negative:rw:bibi'));
});

test('Kinyarwanda contextual urgent medical and misconduct patterns trigger urgent', () => {
  const bleeding = evaluateKeywords('Naje mva amaraso menshi nta muganga wanyitayeho');
  assert.equal(bleeding.language, 'rw');
  assert.equal(bleeding.sentiment, 'negative');
  assert.equal(bleeding.urgent, true);

  const refusalOfCare = evaluateKeywords('Banze kuvura umurwayi urembye');
  assert.equal(refusalOfCare.language, 'rw');
  assert.equal(refusalOfCare.sentiment, 'negative');
  assert.equal(refusalOfCare.urgent, true);

  const overcharged = evaluateKeywords('Banyishyuje amafaranga menshi cyane');
  assert.equal(overcharged.language, 'rw');
  assert.equal(overcharged.sentiment, 'negative');
  assert.equal(overcharged.urgent, true);

  const fainted = evaluateKeywords('Umurwayi yataye ubwenge nta muganga uhari');
  assert.equal(fainted.language, 'rw');
  assert.equal(fainted.sentiment, 'negative');
  assert.equal(fainted.urgent, true);
});

test('analyzeFeedback reconciles LLM output with safety-net language and clear Kinyarwanda polarity', async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              language: 'en',
              sentiment: 'neutral',
              urgent: false,
              reason: 'Neutral text.'
            })
          }]
        }
      }]
    })
  });

  const result = await analyzeFeedback(
    'Murakoze cyane, abaganga banyitayeho neza cyane kandi bakirana urugwiro.',
    { apiKey: 'test-key', fetchImpl: fakeFetch }
  );

  assert.equal(result.language, 'rw');
  assert.equal(result.sentiment, 'positive');
  assert.equal(result.urgent, false);
  assert.equal(result.analysis_source, 'llm');
});

test('redactPII masks email addresses and Rwandan phone numbers', () => {
  const input = 'Call me at +250 788 123 456 or email patient@example.com';
  const redacted = redactPII(input);
  assert.ok(!redacted.includes('788 123 456'));
  assert.ok(!redacted.includes('patient@example.com'));
  assert.ok(redacted.includes('[REDACTED_PHONE]'));
  assert.ok(redacted.includes('[REDACTED_EMAIL]'));
});
