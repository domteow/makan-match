-- MakanMatch initial schema, Phase 2
-- Design notes:
-- * All client access to cross-user data goes through SECURITY DEFINER RPCs.
--   Direct table policies are deliberately narrow.
-- * sessions are looked up by code only via join_session/get_session_state,
--   never by direct select, to prevent session enumeration.
-- * Raw swipes of other users are never selectable; results only via
--   get_results after session is done. Progress is exposed as a counter on
--   participants, maintained by trigger.

-- ---------- Tables ----------

create table sessions (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  host_id uuid not null,
  status text not null default 'lobby' check (status in ('lobby','swiping','done')),
  lat double precision,
  lng double precision,
  radius_m int not null default 1500,
  filters jsonb not null default '{}',
  eatery_count int not null default 0,
  created_at timestamptz not null default now()
);

create table participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  user_id uuid not null,
  display_name text not null check (char_length(display_name) between 1 and 30),
  swipe_count int not null default 0,
  done_swiping boolean not null default false,
  joined_at timestamptz not null default now(),
  unique (session_id, user_id)
);

create table eateries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  place_id text not null,
  name text not null,
  cuisine text,
  price_level int,
  rating numeric,
  distance_m int,
  address text,
  photo_ref text,
  position int not null,
  unique (session_id, position)
);

create table swipes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  eatery_id uuid not null references eateries(id) on delete cascade,
  user_id uuid not null,
  liked boolean not null,
  created_at timestamptz not null default now(),
  unique (eatery_id, user_id)
);

create index idx_participants_session on participants(session_id);
create index idx_eateries_session on eateries(session_id, position);
create index idx_swipes_session on swipes(session_id);

-- ---------- Helpers ----------

-- Membership check used by RLS policies. SECURITY DEFINER so policies on
-- participants can use it without recursive RLS evaluation.
create or replace function is_participant(p_session_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from participants
    where session_id = p_session_id and user_id = auth.uid()
  );
$$;

create or replace function generate_session_code()
returns text
language plpgsql volatile set search_path = public as $$
declare
  chars constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I/L
  v_code text;
begin
  loop
    v_code := (
      select string_agg(substr(chars, 1 + floor(random() * length(chars))::int, 1), '')
      from generate_series(1, 6)
    );
    exit when not exists (select 1 from sessions s where s.code = v_code);
  end loop;
  return v_code;
end;
$$;

-- Maintain participants.swipe_count so progress can be shown without
-- exposing raw swipes.
create or replace function bump_swipe_count()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update participants
  set swipe_count = (
    select count(*) from swipes
    where session_id = new.session_id and user_id = new.user_id
  )
  where session_id = new.session_id and user_id = new.user_id;
  return new;
end;
$$;

create trigger trg_bump_swipe_count
after insert or update on swipes
for each row execute function bump_swipe_count();

-- ---------- RPCs (the only write/lookup paths the client uses) ----------

create or replace function create_session(p_display_name text)
returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  s sessions;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into sessions (code, host_id)
  values (generate_session_code(), auth.uid())
  returning * into s;
  insert into participants (session_id, user_id, display_name)
  values (s.id, auth.uid(), p_display_name);
  return json_build_object('session_id', s.id, 'code', s.code, 'status', s.status);
end;
$$;

create or replace function join_session(p_code text, p_display_name text)
returns json
language plpgsql volatile security definer set search_path = public as $$
declare
  s sessions;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into s from sessions where code = upper(trim(p_code));
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if s.status <> 'lobby' then raise exception 'SESSION_ALREADY_STARTED'; end if;
  insert into participants (session_id, user_id, display_name)
  values (s.id, auth.uid(), p_display_name)
  on conflict (session_id, user_id) do update set display_name = excluded.display_name;
  return json_build_object('session_id', s.id, 'code', s.code, 'status', s.status);
end;
$$;

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
      'host_id', s.host_id, 'eatery_count', s.eatery_count
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

-- Phase 2 only: seed the mock deck. Phase 3 replaces this with the
-- fetch-eateries Edge Function.
create or replace function seed_mock_eateries(p_session_id uuid)
returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if exists (select 1 from eateries where session_id = p_session_id) then return; end if;
  insert into eateries (session_id, place_id, name, cuisine, price_level, rating, distance_m, address, position) values
    (p_session_id, 'mock-1', 'Tian Tian Chicken Rice', 'Hainanese', 1, 4.6, 450,  'Maxwell Food Centre', 1),
    (p_session_id, 'mock-2', 'Koh Grill & Sushi Bar',  'Japanese',  2, 4.4, 1200, 'Wisma Atria', 2),
    (p_session_id, 'mock-3', '328 Katong Laksa',       'Peranakan', 1, 4.5, 800,  'East Coast Rd', 3),
    (p_session_id, 'mock-4', 'Burnt Ends',             'Modern BBQ',4, 4.7, 2100, 'Dempsey Hill', 4),
    (p_session_id, 'mock-5', 'Nakhon Kitchen',         'Thai',      2, 4.3, 650,  'Holland Village', 5),
    (p_session_id, 'mock-6', 'Muthu''s Curry',         'Indian',    2, 4.4, 1500, 'Race Course Rd', 6),
    (p_session_id, 'mock-7', 'Haidilao Hot Pot',       'Sichuan',   3, 4.5, 900,  'Clarke Quay', 7),
    (p_session_id, 'mock-8', 'Two Men Bagel House',    'Brunch',    2, 4.5, 1100, 'Icon Village', 8);
  update sessions set eatery_count = 8 where id = p_session_id;
end;
$$;

create or replace function start_session(p_session_id uuid)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  s sessions;
begin
  select * into s from sessions where id = p_session_id;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if s.host_id <> auth.uid() then raise exception 'NOT_HOST'; end if;
  if s.status <> 'lobby' then raise exception 'ALREADY_STARTED'; end if;
  perform seed_mock_eateries(p_session_id);  -- Phase 3: replace with Edge Function call from client
  update sessions set status = 'swiping' where id = p_session_id;
end;
$$;

create or replace function record_swipe(p_eatery_id uuid, p_liked boolean)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  e eateries;
begin
  select * into e from eateries where id = p_eatery_id;
  if not found then raise exception 'EATERY_NOT_FOUND'; end if;
  if not is_participant(e.session_id) then raise exception 'NOT_A_PARTICIPANT'; end if;
  if (select status from sessions where id = e.session_id) <> 'swiping' then
    raise exception 'SESSION_NOT_SWIPING';
  end if;
  insert into swipes (session_id, eatery_id, user_id, liked)
  values (e.session_id, p_eatery_id, auth.uid(), p_liked)
  on conflict (eatery_id, user_id) do update set liked = excluded.liked;
end;
$$;

create or replace function finish_swiping(p_session_id uuid)
returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not is_participant(p_session_id) then raise exception 'NOT_A_PARTICIPANT'; end if;
  update participants set done_swiping = true
  where session_id = p_session_id and user_id = auth.uid();
  -- If everyone is done, close the session.
  if not exists (
    select 1 from participants
    where session_id = p_session_id and done_swiping = false
  ) then
    update sessions set status = 'done' where id = p_session_id;
  end if;
end;
$$;

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
        e.distance_m, e.address, e.photo_ref,
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

-- ---------- RLS ----------

alter table sessions     enable row level security;
alter table participants enable row level security;
alter table eateries     enable row level security;
alter table swipes       enable row level security;

-- sessions: participants may select (needed for realtime status updates).
-- No insert/update/delete policies: all writes go through RPCs.
create policy sessions_select on sessions
  for select to authenticated
  using (is_participant(id));

-- participants: visible to co-participants (lobby list + realtime).
create policy participants_select on participants
  for select to authenticated
  using (is_participant(session_id));

-- eateries: visible to participants (deck load).
create policy eateries_select on eateries
  for select to authenticated
  using (is_participant(session_id));

-- swipes: a user may see only their own swipes. Others' raw swipes are
-- never selectable; aggregate results come from get_results after 'done'.
create policy swipes_select_own on swipes
  for select to authenticated
  using (user_id = auth.uid());

-- ---------- Realtime ----------
-- Realtime respects RLS; participants receive changes for their sessions only.
alter publication supabase_realtime add table sessions;
alter publication supabase_realtime add table participants;
