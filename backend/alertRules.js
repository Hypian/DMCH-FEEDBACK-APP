/**
 * alertRules.js
 * Evaluates patient feedback and sentiment output to determine whether an immediate
 * staff WhatsApp alert is required, its severity level, and specific clinical/operational reasons.
 *
 * PRIVACY GUARANTEE:
 * This module inspects feedback to compute an alert decision, but the returned
 * reasons must be generic category labels suitable for transmission without patient PII.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const keywordsPath = path.join(__dirname, 'severityKeywords.json');
export const SEVERITY_KEYWORDS = JSON.parse(fs.readFileSync(keywordsPath, 'utf8'));

/**
 * Sentiment score mapping & threshold:
 * The existing sentiment analyzer returns categorical labels: 'negative', 'neutral', 'positive'
 * along with a boolean 'urgent' flag and keyword 'signals' array.
 * We map these into a normalized negative intensity score [0.0 - 1.0]:
 * - urgent = true                -> 1.00 (Maximum emergency/malpractice indicator)
 * - sentiment = 'negative'       -> 0.80 (Explicit dissatisfaction)
 * - sentiment = 'neutral'        -> 0.40 (Informational / ambiguous)
 * - sentiment = 'positive'       -> 0.10 (Praise / gratitude)
 *
 * Configurable threshold: NEGATIVE_SCORE_THRESHOLD defaults to 0.70.
 * Any score >= 0.70 satisfies the negative sentiment requirement for alerting.
 */
export const NEGATIVE_SCORE_THRESHOLD = 0.70;

/**
 * Normalizes text for robust multilingual keyword matching:
 * - Lowercase
 * - Strips accents/diacritics (crucial for French: "évanoüi" -> "evanoui", "déces" -> "deces")
 * - Normalizes whitespace and removes punctuation noise
 * @param {string} text Raw text string
 * @returns {string} Normalized string
 */
export function normalizeAlertText(text) {
  if (typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritical marks
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks whether any keyword in a list is present in the normalized text.
 * Multi-word phrases match as substrings; single words match as whole tokens or word stems.
 * @param {string} normText Normalized feedback text
 * @param {string[]} keywords List of target keywords
 * @returns {string | null} The first matched keyword or null
 */
export function findMatchingKeyword(normText, keywords = []) {
  if (!normText || !Array.isArray(keywords)) return null;
  const padded = ` ${normText} `;
  for (const kw of keywords) {
    const normKw = normalizeAlertText(kw);
    if (!normKw) continue;
    if (normKw.includes(' ')) {
      if (padded.includes(` ${normKw} `) || normText.includes(normKw)) return kw;
    } else {
      const regex = new RegExp(`\\b${normKw}[a-z]*\\b`, 'i');
      if (regex.test(normText)) return kw;
    }
  }
  return null;
}

/**
 * Primary attention rule function.
 * Evaluates feedback text, ratings, and sentiment outputs to determine:
 * 1. flag: boolean (whether staff alerting is required)
 * 2. severity: 'critical' | 'high' | 'normal'
 * 3. reasons: string[] (generic category descriptions; never contains raw patient text)
 *
 * @param {object} feedback Feedback submission object { answers, text, comment, language, departmentName }
 * @param {object|null} sentiment Output of analyzeFeedback() { sentiment, urgent, reason, signals, language, analysis_source }
 * @returns {{ flag: boolean, severity: 'critical' | 'high' | 'normal', reasons: string[] }}
 */
export function needsAttention(feedback = {}, sentiment = null) {
  const reasons = [];
  let severity = 'normal';
  let flag = false;

  // Extract combined textual comments
  const rawText = [
    feedback.answers?.q10,
    feedback.answers?.q9,
    feedback.text,
    feedback.comment
  ]
    .filter((v) => typeof v === 'string' && v.trim().length > 0)
    .join(' ');
  const normText = normalizeAlertText(rawText);

  // 1. Check for lowest / 1-star rating in overall quality (q8 === 0 or lowest satisfaction rating)
  const q8Answer = feedback.answers?.q8;
  const isLowestRating = q8Answer === 0 || q8Answer === '0';
  if (isLowestRating) {
    flag = true;
    severity = 'high';
    reasons.push('Lowest overall satisfaction rating submitted (1-star / Very Poor)');
  }

  // 2. Keyword check across all supported languages (EN, RW, FR)
  // Even if sentiment analyzer fails, keyword matching operates autonomously.
  let matchedCriticalKw = null;
  let matchedHighKw = null;
  let matchedNormalKw = null;

  for (const lang of ['en', 'rw', 'fr']) {
    if (!matchedCriticalKw) {
      matchedCriticalKw = findMatchingKeyword(normText, SEVERITY_KEYWORDS.critical?.[lang]);
    }
    if (!matchedHighKw) {
      matchedHighKw = findMatchingKeyword(normText, SEVERITY_KEYWORDS.high?.[lang]);
    }
    if (!matchedNormalKw) {
      matchedNormalKw = findMatchingKeyword(normText, SEVERITY_KEYWORDS.normal?.[lang]);
    }
  }

  // 3. Evaluate existing sentiment outputs
  const sentimentLabel = sentiment?.sentiment || 'unknown';
  const isUrgentSentiment = Boolean(sentiment?.urgent);
  const signals = Array.isArray(sentiment?.signals) ? sentiment.signals : [];

  let negativeScore = 0.40; // neutral default
  if (isUrgentSentiment) negativeScore = 1.00;
  else if (sentimentLabel === 'negative') negativeScore = 0.80;
  else if (sentimentLabel === 'positive') negativeScore = 0.10;

  const isNegative = negativeScore >= NEGATIVE_SCORE_THRESHOLD;

  // 4. Fail-safe rule: If sentiment call errored or language could not be determined with text present
  const hasSentimentError = signals.some((s) => s.startsWith('llm_error') || s === 'error');
  const isUndeterminedLang = sentiment?.language === 'other' || (!sentiment?.language && Boolean(normText));
  if ((hasSentimentError || isUndeterminedLang) && normText.length > 10) {
    flag = true;
    reasons.push('Fail-safe human review: low confidence, missing sentiment, or undetermined language');
  }

  // 5. Severity escalation logic:
  // CRITICAL:
  // - Safety/clinical-harm keyword matched
  // - Existing sentiment flagged urgent = true
  // - Very negative sentiment combined with clinical keyword
  if (matchedCriticalKw) {
    flag = true;
    severity = 'critical';
    reasons.push('Clinical emergency or patient safety trigger matched');
  } else if (isUrgentSentiment) {
    flag = true;
    severity = 'critical';
    reasons.push('Urgent malpractice or clinical safety concern detected by AI classifier');
  }

  // HIGH:
  // - High severity keyword matched (abuse, severe pain, negligence, bribery)
  // - Lowest rating (already marked severity = 'high')
  // - Strongly negative sentiment (negative label with multiple negative signals)
  if (severity !== 'critical') {
    if (matchedHighKw) {
      flag = true;
      severity = 'high';
      reasons.push('High-priority operational concern or staff conduct complaint');
    } else if (isLowestRating) {
      // already severity = high
    } else if (isNegative && signals.filter((s) => s.startsWith('keyword:negative')).length >= 2) {
      flag = true;
      severity = 'high';
      reasons.push('Multiple negative service indicators detected in feedback');
    }
  }

  // NORMAL:
  // - Negative sentiment only (still flagged if above threshold)
  if (!flag && isNegative) {
    flag = true;
    severity = 'normal';
    if (matchedNormalKw) {
      reasons.push('Service delay, facility condition, or billing inquiry detected');
    } else {
      reasons.push('Negative patient sentiment detected');
    }
  }

  return {
    flag,
    severity,
    reasons: flag ? (reasons.length > 0 ? reasons : ['General review']) : []
  };
}
