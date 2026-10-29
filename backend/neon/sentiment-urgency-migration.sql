-- ==============================================================================
-- DMCH Patient Feedback - Sentiment & Urgency Analysis Migration
-- Safe & idempotent: adds analysis columns and indexes to feedback_responses.
-- ==============================================================================

alter table public.feedback_responses
  add column if not exists sentiment text check (sentiment in ('positive', 'neutral', 'negative')),
  add column if not exists urgent boolean not null default false,
  add column if not exists urgent_reason text,
  add column if not exists urgent_signals jsonb not null default '[]'::jsonb,
  add column if not exists analysis_source text check (analysis_source in ('llm', 'fallback')),
  add column if not exists detected_language text check (detected_language in ('en', 'fr', 'rw', 'other'));

create index if not exists feedback_responses_urgent_idx
  on public.feedback_responses (urgent)
  where urgent = true;

create index if not exists feedback_responses_sentiment_idx
  on public.feedback_responses (sentiment);
