-- Phase 4 support: the context the reveal screen and the deck's progress row
-- need. 0003 stores who revealed and when; nothing exposed it to the client,
-- and "joined late" was not derivable at all — participants.joined_at was
-- never returned, and there was no record of when swiping actually began.

alter table sessions add column if not exists started_at timestamptz;

-- Stamp the moment the deck goes live. The status flip happens in the
-- fetch-eateries Edge Function (service role), so this lives in the database
-- rather than in application code: a redeal sends the session back to 'lobby'
-- and must clear the stamp, or every participant would read as "joined late"
-- on the second round.
create or replace function stamp_session_started()
returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status = 'swiping' and old.status is distinct from 'swiping' then
    new.started_at := now();
  elsif new.status = 'lobby' and old.status is distinct from 'lobby' then
    new.started_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stamp_session_started on sessions;
create trigger trg_stamp_session_started
before update on sessions
for each row execute function stamp_session_started();

-- Redeal is a fresh round: the previous reveal must not linger in the
-- results header.
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
        revealed_at = null,
        revealed_by = null,
        radius_m = greatest(300, least(coalesce(p_radius_m, 3000), 5000))
    where id = p_session_id;
end;
$$;

-- get_session_state gains the reveal stamps, the session start time, and
-- each participant's joined_at. revealed_by is a bare uuid; the client
-- resolves it to a display name from the participants list it already has.
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
        'photo_ref', e.photo_ref, 'position', e.position
      ) order by e.position), '[]'::json)
      from eateries e where e.session_id = s.id
    )
  );
end;
$$;
