-- Phase 3: real eateries. Removes the Phase 2 mock seeding path.
-- The host's Start action now goes through the fetch-eateries Edge Function
-- (service role) instead of a start_session RPC.

drop function if exists start_session(uuid);
drop function if exists seed_mock_eateries(uuid);

alter table eateries add column if not exists lat double precision;
alter table eateries add column if not exists lng double precision;
alter table eateries add column if not exists maps_uri text;

-- Host sets location + filters before starting.
create or replace function set_session_location(
  p_session_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_radius_m int,
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
      filters = coalesce(p_filters, '{}'::jsonb)
  where id = p_session_id;
end;
$$;

-- Host can widen the radius and redeal after a zero-match result.
create or replace function reset_session_for_redeal(p_session_id uuid, p_radius_m int)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  s sessions;
begin
  select * into s from sessions where id = p_session_id;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if s.host_id <> auth.uid() then raise exception 'NOT_HOST'; end if;
  delete from eateries where session_id = p_session_id;  -- cascades swipes
  update participants
    set done_swiping = false, swipe_count = 0
    where session_id = p_session_id;
  update sessions
    set status = 'lobby',
        eatery_count = 0,
        radius_m = greatest(300, least(coalesce(p_radius_m, 3000), 5000))
    where id = p_session_id;
end;
$$;

-- get_session_state now also returns session filters + radius so all clients
-- can apply the (documented, client-side) price_max filter identically.
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
      'radius_m', s.radius_m, 'filters', s.filters
    ),
    'participants', (
      select coalesce(json_agg(json_build_object(
        'user_id', p.user_id, 'display_name', p.display_name,
        'swipe_count', p.swipe_count, 'done_swiping', p.done_swiping,
        'is_host', p.user_id = s.host_id
      ) order by p.joined_at), '[]'::json)
      from participants p where p.session_id = s.id
    ),
    'eateries', (
      select coalesce(json_agg(json_build_object(
        'id', e.id, 'name', e.name, 'cuisine', e.cuisine,
        'price_level', e.price_level, 'rating', e.rating,
        'distance_m', e.distance_m, 'address', e.address,
        'photo_ref', e.photo_ref, 'position', e.position
      ) order by e.position), '[]'::json)
      from eateries e where e.session_id = s.id
    )
  );
end;
$$;

-- get_results now also returns maps_uri for the "Open in Maps" link.
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
        count(*) filter (where sw.liked) as yes_count,
        n as participant_count,
        (count(*) filter (where sw.liked)) = n as unanimous
      from eateries e
      left join swipes sw on sw.eatery_id = e.id
      where e.session_id = p_session_id
      group by e.id
      having count(*) filter (where sw.liked) >= ceil(n / 2.0)
      order by yes_count desc, e.rating desc nulls last
    ) r
  );
end;
$$;

-- Public bucket backing the place-photo Edge Function's read-through cache.
-- Keys are derived from Google's photo resource name, so cached images are
-- shared across sessions. Only the service role writes to it.
insert into storage.buckets (id, name, public)
values ('place-photos', 'place-photos', true)
on conflict (id) do nothing;
