-- Phase 6b: we write the summaries ourselves.
--
-- Google's generativeSummary / reviewSummary / editorialSummary return nothing
-- for Singapore places (verified against Place Details: only displayName comes
-- back). Raw `reviews` do come back, so fetch-eateries now sends them to Claude
-- and keeps the one-line result here. Two things this buys over Google's
-- version, beyond it actually existing: we control the voice — "Zi char spot
-- known for chilli crab and butter prawns, big round tables" rather than
-- "Casual eatery serving seafood" — and the cache is ours to age out.
--
-- Compliance: Google Maps Platform terms let us store `place_id` indefinitely
-- and almost nothing else. So this table holds a *derived* summary, never the
-- review text it came from, and every row carries an expiry — rows older than
-- 30 days are treated as absent and regenerated. The place-photo Storage cache
-- was specced as permanent, which was wrong for the same reason; it now
-- carries the same 30-day TTL.

create table if not exists place_summaries (
  place_id     text primary key,
  overview     text not null,
  detail       text,
  review_count int not null default 0,
  model        text not null,
  generated_at timestamptz not null default now()
);

-- RLS on with no policies: nothing reachable from the anon/authenticated keys,
-- which is what we want. Clients never read this table — fetch-eateries copies
-- the summary into eateries.summary_overview / summary_description, and those
-- ride out through get_session_state and get_results as before. Only the Edge
-- Function's service-role client writes here.
alter table place_summaries enable row level security;

-- The lookup is "these ~20 place_ids, generated within the TTL window".
create index if not exists idx_place_summaries_generated
  on place_summaries(generated_at);

comment on table place_summaries is
  'Global, cross-session cache of Claude-written eatery summaries keyed by Google place_id. Rows older than 30 days are stale and regenerated on next use (Google Maps Platform caching terms). Never store review text here — only the derived summary.';
comment on column place_summaries.overview is
  'One sentence, <=110 chars, dish-first. Copied into eateries.summary_overview.';
comment on column place_summaries.detail is
  'Two or three sentences for the detail sheet. Copied into eateries.summary_description.';
comment on column place_summaries.review_count is
  'How many reviews the summary was written from. Places with fewer than 2 are never summarised.';
