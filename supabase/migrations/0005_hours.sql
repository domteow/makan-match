-- Phase 4.5: opening hours.
-- open_now: true = open at fetch time, false = closed, NULL = Google has no
-- hours data for this place (common for hawker stalls and small shops).
alter table eateries add column if not exists open_now boolean;
alter table eateries add column if not exists closes_at timestamptz;

-- Both RPCs below are the 0004 / 0003 versions with the two new eatery
-- columns added and nothing else changed.

-- get_session_state: the deck needs open_now/closes_at to render the
-- "hours unknown" and "closes 9:00pm" chips on the swipe cards.
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
      from eateries e where e.session_id = s.id
    )
  );
end;
$$;

-- get_results: closing time matters most here — this is the screen the group
-- acts on, minutes after the fetch that stamped open_now.
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
