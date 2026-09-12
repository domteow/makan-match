-- Phase 7: search for a location.
--
-- Until now the deck could only be built around where the host physically is,
-- which does not match how people plan: "we're meeting at Jewel later" is the
-- normal case, not the exception. So the host can now name a place and have the
-- deck built around that point instead.
--
-- Cost shape (see docs/COSTS.md): Autocomplete is the Essentials SKU and is
-- billed per request, so the 350ms debounce and 3-character minimum in the
-- client are the entire cost story. Place Details (Essentials) resolves the
-- chosen prediction to a lat/lng exactly once per place per TTL window, which
-- is what the cache below is for. No session tokens: they only start paying off
-- above 12 autocomplete requests per search and we average 3-4, where requests
-- are billed identically with or without one.

-- Resolved location cache. Mall and landmark names repeat heavily across
-- sessions (Jewel, VivoCity, Tampines Hub), so resolving each one once per
-- TTL window removes almost all repeat Place Details cost.
-- 30-day TTL matches the photo and summary caches: Google Maps Platform terms
-- allow indefinite storage of place_id but not of other place content.
create table if not exists place_locations (
  place_id    text primary key,
  name        text not null,
  address     text,
  lat         double precision not null,
  lng         double precision not null,
  resolved_at timestamptz not null default now()
);

alter table place_locations enable row level security;
-- No policies: service role only. Clients reach this through the Edge Function.

-- No index beyond the primary key: every read is a point lookup by place_id
-- with the TTL applied as a predicate on the row that comes back.

comment on table place_locations is
  'Global, cross-session cache of searched locations keyed by Google place_id. Rows older than 30 days are treated as absent and re-resolved on next use (Google Maps Platform caching terms). Written only by the place-search Edge Function.';

-- Record what the host searched for, so the lobby and results can show
-- "near Jewel Changi Airport" rather than a bare radius. NULL on the
-- geolocation path, which has no name to show and keeps the radius phrasing.
alter table sessions add column if not exists location_label text;

comment on column sessions.location_label is
  'Display name of the place the host searched for, or NULL when the location came from device geolocation. Presentation only — the deck is always built from lat/lng.';

-- IMPORTANT: as in 0006, adding a parameter to set_session_location creates an
-- OVERLOAD rather than replacing the function, leaving two callable versions
-- and an ambiguous call from the client. Drop the 0006 signature explicitly.
drop function if exists set_session_location(uuid, double precision, double precision, int, int, jsonb);

create or replace function set_session_location(
  p_session_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_radius_m int,
  p_deck_size int,
  p_filters jsonb,
  p_location_label text
)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  s sessions;
begin
  select * into s from sessions where id = p_session_id;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if s.host_id <> auth.uid() then raise exception 'NOT_HOST'; end if;
  if s.status <> 'lobby' then raise exception 'ALREADY_STARTED'; end if;
  update sessions
  set lat = p_lat,
      lng = p_lng,
      radius_m = greatest(300, least(coalesce(p_radius_m, 1500), 5000)),
      deck_size = greatest(5, least(coalesce(p_deck_size, 15), 20)),
      filters = coalesce(p_filters, '{}'::jsonb),
      -- Written unconditionally, including as NULL: a host who searched a place
      -- and then switched to "Use my location" must not keep the stale label.
      location_label = nullif(btrim(coalesce(p_location_label, '')), '')
  where id = p_session_id;
end;
$$;

-- get_session_state: the 0007 version with 'location_label' added to the
-- session object and nothing else changed. Everything 0003-0008 accumulated
-- (reveal context, hours, the active-deck position filter, the Phase 6 detail
-- columns) stays exactly as it is.
create or replace function get_session_state(p_code text)
returns json
language plpgsql stable security definer set search_path = public as $$
declare
  s sessions;
begin
  select * into s from sessions where code = upper(trim(p_code));
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if not is_participant(s.id) then raise exception 'NOT_A_PARTICIPANT'; end if;
  return json_build_object(
    'session', json_build_object(
      'id', s.id, 'code', s.code, 'status', s.status,
      'host_id', s.host_id, 'eatery_count', s.eatery_count,
      'radius_m', s.radius_m, 'filters', s.filters,
      'location_label', s.location_label,
      'deck_size', s.deck_size, 'deck_shuffled_at', s.deck_shuffled_at,
      'started_at', s.started_at,
      'revealed_at', s.revealed_at, 'revealed_by', s.revealed_by
    ),
    'participants', (
      select coalesce(json_agg(json_build_object(
        'user_id', p.user_id, 'display_name', p.display_name,
        'swipe_count', p.swipe_count, 'done_swiping', p.done_swiping,
        'joined_at', p.joined_at,
        'is_host', p.user_id = s.host_id
      ) order by p.joined_at), '[]'::json)
      from participants p where p.session_id = s.id
    ),
    'eateries', (
      select coalesce(json_agg(json_build_object(
        'id', e.id, 'name', e.name, 'cuisine', e.cuisine,
        'price_level', e.price_level, 'rating', e.rating,
        'distance_m', e.distance_m, 'address', e.address,
        'photo_ref', e.photo_ref, 'position', e.position,
        'open_now', e.open_now, 'closes_at', e.closes_at,
        'maps_uri', e.maps_uri,
        'summary_overview', e.summary_overview,
        'summary_description', e.summary_description,
        'summary_disclosure', e.summary_disclosure,
        'review_summary', e.review_summary,
        'review_summary_uri', e.review_summary_uri,
        'review_summary_disclosure', e.review_summary_disclosure,
        'price_range_text', e.price_range_text,
        'website_uri', e.website_uri,
        'attributes', e.attributes,
        'photo_refs', e.photo_refs
      ) order by e.position), '[]'::json)
      from eateries e
      where e.session_id = s.id and e.position <= s.eatery_count
    )
  );
end;
$$;
