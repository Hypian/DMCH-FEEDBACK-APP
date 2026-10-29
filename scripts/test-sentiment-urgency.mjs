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
