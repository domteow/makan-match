-- Phase 5b: deck options + shuffle.
--
-- Two ideas drive this migration:
--
-- 1. Order is a property of the SESSION, never of a participant. The vote maths
--    is per-eatery so order does not affect counting, but participation is
--    routinely partial (host reveals early, people join late) — and with an
--    identical order everyone's partial progress covers the same cards, so the
--    votes overlap. Per-person shuffle would spread half-finished decks across
--    different subsets and leave every eatery with one or two votes.
--
-- 2. Places bills per call, not per result, so fetch-eateries always asks for
--    the maximum 20 and stores every survivor. Only the first `deck_size` by
--    position are served to clients; the rest are free reserve. That reserve is
--    what makes reshuffle_deck cost nothing.

alter table sessions add column if not exists deck_size int not null default 15
  check (deck_size between 5 and 20);

-- Bumped by reshuffle_deck. Reshuffling only touches `eateries` rows, and
-- clients subscribe to `sessions` UPDATEs — without a column changing here,
-- everyone but the host would sit on a stale deck preview.
alter table sessions add column if not exists deck_shuffled_at timestamptz;

-- IMPORTANT: this changes the signature of set_session_location. In Postgres,
-- `create or replace function` with a different parameter list creates an
-- OVERLOAD rather than replacing, leaving two callable versions. Drop the old
-- one explicitly first.
drop function if exists set_session_location(uuid, double precision, double precision, int, jsonb);

create or replace function set_session_location(
  p_session_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_radius_m int,
  p_deck_size int,
  p_filters jsonb
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
      filters = coalesce(p_filters, '{}'::jsonb)
  where id = p_session_id;
end;
$$;

-- Reshuffle: reassigns positions across ALL stored eateries, so a different
-- subset surfaces in the deck. Costs no Places call.
-- Lobby only: reshuffling after swiping starts would strand existing swipes on
-- eateries that are no longer in the deck.
create or replace function reshuffle_deck(p_session_id uuid)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  s sessions;
begin
  select * into s from sessions where id = p_session_id;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if s.host_id <> auth.uid() then raise exception 'NOT_HOST'; end if;
  if s.status <> 'lobby' then raise exception 'NOT_IN_LOBBY'; end if;

  -- Two-step because unique(session_id, position) is checked per row, so a
  -- single reassignment would collide mid-statement. 1000 is safely past the
  -- 20-row ceiling, so the parked range never overlaps the live one.
  update eateries set position = position + 1000 where session_id = p_session_id;

  update eateries e
  set position = r.rn
  from (
    select id, row_number() over (order by random()) as rn
    from eateries where session_id = p_session_id
  ) r
  where e.id = r.id;

  -- The realtime nudge (see the column comment above). Everyone re-runs
  -- get_session_state off this UPDATE, so nobody previews a stale order.
  update sessions set deck_shuffled_at = now() where id = p_session_id;
end;
$$;

-- get_session_state: the 0005 version, plus deck_size / deck_shuffled_at on the
-- session and the active-deck filter on the eateries subquery. Reserve rows stay
-- in the table but are never sent to clients — which is what keeps the deck the
-- host asked for, and keeps reshuffle able to draw from places already found.
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
        'open_now', e.open_now, 'closes_at', e.closes_at
      ) order by e.position), '[]'::json)
      from eateries e
      where e.session_id = s.id and e.position <= s.eatery_count
    )
  );
end;
$$;

-- get_results: the 0005 version with the same active-deck filter. A reserve
-- eatery has no swipes on it and so could never clear the majority test, but
-- the filter is stated rather than relied on — reserve rows are not part of the
-- deck the group voted on, and must not be able to appear in its results.
create or replace function get_results(p_session_id uuid)
returns json
language plpgsql stable security definer set search_path = public as $$
declare
  n int;
begin
  if not is_participant(p_session_id) then raise exception 'NOT_A_PARTICIPANT'; end if;
  if (select status from sessions where id = p_session_id) <> 'done' then
    raise exception 'SESSION_NOT_DONE';
  end if;
  select count(*) into n from participants where session_id = p_session_id;
  return (
    select coalesce(json_agg(row_to_json(r)), '[]'::json) from (
      select
        e.id, e.name, e.cuisine, e.price_level, e.rating,
        e.distance_m, e.address, e.photo_ref, e.maps_uri,
        e.open_now, e.closes_at,
        count(sw.*) filter (where sw.liked)          as yes_count,
        count(sw.*)                                   as vote_count,
        n                                             as participant_count,
        -- Full match: everyone in the session voted, and all said yes.
        (count(sw.*) = n and count(sw.*) filter (where sw.liked) = n) as unanimous,
        -- Clean sweep: everyone who saw it said yes, but not all voted.
        (count(sw.*) < n
         and count(sw.*) >= 2
         and count(sw.*) filter (where sw.liked) = count(sw.*))       as clean_sweep
      from eateries e
      left join swipes sw on sw.eatery_id = e.id
      where e.session_id = p_session_id
        and e.position <= (select eatery_count from sessions where id = p_session_id)
      group by e.id
      having count(sw.*) filter (where sw.liked) >= 1
         and count(sw.*) filter (where sw.liked) >= ceil(count(sw.*) / 2.0)
      order by
        unanimous desc,
        clean_sweep desc,
        yes_count desc,
        (count(sw.*) filter (where sw.liked))::numeric
          / nullif(count(sw.*), 0) desc,
        e.rating desc nulls last
    ) r
  );
end;
$$;
