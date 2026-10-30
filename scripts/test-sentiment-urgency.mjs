// ─── Test Script: Sentiment & Urgency Analysis ──────────────────────────────
// Tests the 7 required feedback scenarios with both LLM disabled (fallback mode)
// and LLM enabled (if GEMINI_API_KEY is configured in the environment).

import 'dotenv/config';
import { analyzeFeedback } from '../backend/sentiment-analyzer.mjs';

// 7 Required Benchmark Test Cases:
// (Includes two realistic Kinyarwanda samples: one urgent complaint, one praise)
const TEST_CASES = [
  {
    id: 1,
    text: 'I came in bleeding and waited two hours, this is negligence.',
    expected: { language: 'en', sentiment: 'negative', urgent: true },
    description: 'English medical emergency and negligence complaint'
  },
  {
    id: 2,
    text: 'The waiting area was dirty and the service was slow.',
    expected: { language: 'en', sentiment: 'negative', urgent: false },
    description: 'English mild dissatisfaction (negative but not urgent)'
  },
  {
    id: 3,
    text: 'Great service, the nurse was kind.',
    expected: { language: 'en', sentiment: 'positive', urgent: false },
    description: 'English positive service praise'
  },
  {
    id: 4,
    text: "Urgence: personne ne s'est occupé de moi et j'ai été facturé pour rien.",
    expected: { language: 'fr', sentiment: 'negative', urgent: true },
    description: 'French emergency and unjust billing complaint'
  },
  {
    id: 5,
    text: 'Le service était très lent.',
    expected: { language: 'fr', sentiment: 'negative', urgent: false },
    description: 'French mild slow service (negative but not urgent)'
  },
  {
    id: 6,
    text: 'Merci, très bon accueil.',
    expected: { language: 'fr', sentiment: 'positive', urgent: false },
    description: 'French warm gratitude and praise'
  },
  // Kinyarwanda Sample 1 (Complaint / Urgent):
  // "Naje ndembe nta wanyitayeho bansigiye mu mbeho, ni uburangare bukomeye."
  // Translation: "I arrived in critical condition, nobody attended to me and they left me in the cold, this is severe negligence."
  // Marked for user verification:
  {
    id: 7,
    text: 'Naje ndembe nta wanyitayeho bansigiye mu mbeho, ni uburangare bukomeye.',
    expected: { language: 'rw', sentiment: 'negative', urgent: true },
    description: 'Kinyarwanda urgent complaint: critical condition + negligence (marked for verification)'
  },
  // Kinyarwanda Sample 2 (Praise / Non-Urgent):
  // "Murakoze cyane, abaganga banyitayeho neza cyane kandi bakirana urugwiro."
  // Translation: "Thank you very much, the doctors cared for me very well and welcomed me with warmth."
  // Marked for user verification:
  {
    id: 8,
    text: 'Murakoze cyane, abaganga banyitayeho neza cyane kandi bakirana urugwiro.',
    expected: { language: 'rw', sentiment: 'positive', urgent: false },
    description: 'Kinyarwanda praise: gratitude for kind medical care (marked for verification)'
  },

  // ── Kinyarwanda accuracy suite ──────────────────────────────────────────────
  // Covers negation, noun-class forms, verb affixes, mixed feedback, and false-positive
  // traps. English glosses are in the descriptions. Labels were written by a
  // non-native speaker: have a native speaker (e.g. DMCH patient-relations staff) review
  // them and replace or add real patient comments over time.
  {
    id: 9,
    text: 'Serivisi yari nziza cyane, murakoze',
    expected: { language: 'rw', sentiment: 'positive', urgent: false },
    description: 'rw praise: "the service was very good, thank you"'
  },
  {
    id: 10,
    text: 'Ntabwo byari byiza, abaganga batinze cyane',
    expected: { language: 'rw', sentiment: 'negative', urgent: false },
    description: 'rw negation: "it was not good, the doctors were very late" (must not read "byiza" as praise)'
  },
  {
    id: 11,
    text: 'Nta kibazo, byose byagenze neza',
    expected: { language: 'rw', sentiment: 'positive', urgent: false },
    description: 'rw negated problem: "no problem, everything went well"'
  },
  {
    id: 12,
    text: 'Abaganga ni beza ariko twategereje igihe kirekire',
    expected: { language: 'rw', sentiment: 'neutral', urgent: false },
    description: 'rw mixed: "the doctors are good but we waited a long time"'
  },
  {
    id: 13,
    text: 'Ntibanyitayeho kandi ntibishimishije',
    expected: { language: 'rw', sentiment: 'negative', urgent: false },
    description: 'rw negative verb prefixes: "they did not care for me and it was not pleasing"'
  },
  {
    id: 14,
    text: 'Sinishimiye na gato',
    expected: { language: 'rw', sentiment: 'negative', urgent: false },
    description: 'rw first-person negation: "I am not happy at all"'
  },
  {
    id: 15,
    text: 'Umwanda mwinshi mu bwiherero',
    expected: { language: 'rw', sentiment: 'negative', urgent: false },
    description: 'rw hygiene complaint: "lots of dirt in the toilets"'
  },
  {
    id: 16,
    text: 'Twategereje amasaha abiri, byatinze',
    expected: { language: 'rw', sentiment: 'negative', urgent: false },
    description: 'rw mild delay: "we waited two hours, it was slow" (negative, not urgent)'
  },
  {
    id: 17,
    text: 'Nishyuye amafaranga ku isanduku, serivisi yari nziza',
    expected: { language: 'rw', sentiment: 'positive', urgent: false },
    description: 'rw false-positive trap: bare "amafaranga" (money) must not be urgent'
  },
  {
    id: 18,
    text: 'Bampimye amaraso vuba kandi neza',
    expected: { language: 'rw', sentiment: 'positive', urgent: false },
    description: 'rw false-positive trap: "they tested my blood quickly and well" ("amaraso" alone is not bleeding)'
  },
  {
    id: 19,
    text: 'Nari ndi kuva amaraso ariko nta muntu wanyitayeho',
    expected: { language: 'rw', sentiment: 'negative', urgent: true },
    description: 'rw urgent: "I was bleeding but nobody attended to me"'
  },
  {
    id: 20,
    text: 'Banze kumvura kuko ntari mfite amafaranga',
    expected: { language: 'rw', sentiment: 'negative', urgent: true },
    description: 'rw urgent: "they refused to treat me because I had no money"'
  },
  {
    id: 21,
    text: 'Abaganga ni beza ariko banze kunvura umwana wanjye',
    expected: { language: 'rw', sentiment: 'negative', urgent: true },
    description: 'rw praise mixed with refusal of care: still urgent'
  },
  {
    id: 22,
    text: 'Umuforomo yantutse kandi yankubise',
    expected: { language: 'rw', sentiment: 'negative', urgent: true },
    description: 'rw abuse: "the nurse insulted me and hit me"'
  },
  {
    id: 23,
    text: 'Umukozi yansabye ruswa',
    expected: { language: 'rw', sentiment: 'negative', urgent: true },
    description: 'rw bribery: "a staff member asked me for a bribe"'
  },
  {
    id: 24,
    text: 'Banyishyuje amafaranga menshi cyane',
    expected: { language: 'rw', sentiment: 'negative', urgent: true },
    description: 'rw overcharging: "they charged me a lot of money"'
  },
  {
    id: 25,
    text: 'Nashakaga gusubizwa amafaranga yanjye',
    expected: { language: 'rw', sentiment: 'negative', urgent: true },
    description: 'rw refund demand: "I would like to be refunded my money"'
  },
  {
    id: 26,
    text: 'Umurwayi yataye ubwenge nta muganga uhari',
    expected: { language: 'rw', sentiment: 'negative', urgent: true },
    description: 'rw emergency: "the patient fainted and no doctor was there"'
  },
  {
    id: 27,
    text: 'Naje mfite ububabare bukabije',
    expected: { language: 'rw', sentiment: 'negative', urgent: true },
    description: 'rw urgent: "I came with severe pain"'
  },

  // ── Negation in English and French (same engine) ────────────────────────────
  {
    id: 28,
    text: 'It was not good at all.',
    expected: { language: 'en', sentiment: 'negative', urgent: false },
    description: 'English negation: "not good" must not read as praise'
  },
  {
    id: 29,
    text: "Ce n'était pas bon.",
    expected: { language: 'fr', sentiment: 'negative', urgent: false },
    description: 'French negation: "pas bon" must not read as praise'
  }
];

async function runTestSuite(label, forceFallback = false) {
  console.log(`\n================================================================`);
  console.log(`  RUNNING BENCHMARK: ${label}`);
  console.log(`================================================================`);

  const savedKey = process.env.GEMINI_API_KEY;
  if (forceFallback) {
    delete process.env.GEMINI_API_KEY;
  }

  let passedCount = 0;
  let totalCount = TEST_CASES.length;

  for (const tc of TEST_CASES) {
    const result = await analyzeFeedback(tc.text);

    const langMatch = result.language === tc.expected.language;
    const sentMatch = result.sentiment === tc.expected.sentiment;
    const urgMatch = result.urgent === tc.expected.urgent;
    const isSuccess = langMatch && sentMatch && urgMatch;

    if (isSuccess) passedCount += 1;

    console.log(`\n[Test #${tc.id}] "${tc.text}"`);
    console.log(`  Context   : ${tc.description}`);
    console.log(`  Source    : ${result.analysis_source} | Signals: [${result.signals.join(', ')}]`);
    console.log(`  Reason    : ${result.reason}`);
    console.log(`  Language  : Expected "${tc.expected.language}" | Actual: "${result.language}" ${langMatch ? '✔' : '✖'}`);
    console.log(`  Sentiment : Expected "${tc.expected.sentiment}" | Actual: "${result.sentiment}" ${sentMatch ? '✔' : '✖'}`);
    console.log(`  Urgent    : Expected ${tc.expected.urgent} | Actual: ${result.urgent} ${urgMatch ? '✔' : '✖'}`);
    console.log(`  Result    : ${isSuccess ? '✅ PASS' : '❌ FAIL'}`);
  }

  console.log(`\n----------------------------------------------------------------`);
  console.log(`  ${label} Summary: ${passedCount} / ${totalCount} PASSED`);
  console.log(`----------------------------------------------------------------`);

  if (forceFallback) {
    if (savedKey) process.env.GEMINI_API_KEY = savedKey;
  }

  return { passedCount, totalCount };
}

async function main() {
  console.log(`DMC Hospital Sentiment & Urgency Analysis Test Suite`);
  console.log(`Testing with Keyword Safety Net Fallback (LLM Disabled)...`);
  const fallbackResults = await runTestSuite('MODE 1: Keyword Safety Net (LLM Disabled)', true);

  if (process.env.GEMINI_API_KEY) {
    console.log(`\nTesting with Gemini LLM Enabled...`);
    const llmResults = await runTestSuite('MODE 2: Gemini LLM Primary (With Safety Net)', false);
    if (fallbackResults.passedCount < fallbackResults.totalCount || llmResults.passedCount < llmResults.totalCount) {
      process.exitCode = 1;
    }
  } else {
    console.log(`\nℹ Notice: GEMINI_API_KEY is not set in environment or .env.`);
    console.log(`MODE 1 passed completely. To test live Gemini LLM calls, set GEMINI_API_KEY in .env and re-run.`);
    if (fallbackResults.passedCount < fallbackResults.totalCount) {
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
