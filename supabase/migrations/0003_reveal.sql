-- Phase 4: host-controlled reveal, late joins, per-eatery match maths.

alter table sessions add column if not exists revealed_at timestamptz;
alter table sessions add column if not exists revealed_by uuid;

-- Late joins: allow joining a session that is already swiping.
create or replace function join_session(p_code text, p_display_name text)
returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  s sessions;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into s from sessions where code = upper(trim(p_code));
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if s.status = 'done' then raise exception 'SESSION_FINISHED'; end if;
  insert into participants (session_id, user_id, display_name)
  values (s.id, auth.uid(), p_display_name)
  on conflict (session_id, user_id) do update set display_name = excluded.display_name;
  return json_build_object('session_id', s.id, 'code', s.code, 'status', s.status);
end;
$$;

-- Host reveal, available at any point during swiping.
create or replace function reveal_now(p_session_id uuid)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  s sessions;
begin
  select * into s from sessions where id = p_session_id;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if s.host_id <> auth.uid() then raise exception 'NOT_HOST'; end if;
  if s.status <> 'swiping' then raise exception 'NOT_SWIPING'; end if;
  update sessions
    set status = 'done', revealed_at = now(), revealed_by = auth.uid()
    where id = p_session_id;
end;
$$;

-- Results: strength is measured against votes actually cast on each eatery,
-- not against session headcount. With partial participation (host reveals
-- early, or someone joined late), headcount would understate agreement:
-- a card three people loved would read 3/5 only because two never saw it.
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
