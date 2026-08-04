-- Phase 6: know what you're swiping on.
--
-- The card offered a photo and a price level, which is not enough to decide on.
-- Places has no menu field — there is no menu in the API at all — so the
-- closest honest substitutes are what we store here: Google's generative
-- summaries (which name dishes), the review summary (which names what people
-- actually order), a real dollar range, extra photos, and a link out.
-- Nothing in this migration is ever labelled "Menu" in the UI.
--
-- Every column is optional and every one of them is frequently NULL. Coverage
-- for Singapore hawker stalls, coffeeshop units and small tenants is poor to
-- nonexistent. The UI contract is that an absent field renders as *nothing* —
-- no empty box, no "no information available" placeholder.

alter table eateries add column if not exists summary_overview text;
alter table eateries add column if not exists summary_description text;
alter table eateries add column if not exists review_summary text;
alter table eateries add column if not exists review_summary_uri text;
alter table eateries add column if not exists price_range_text text;
alter table eateries add column if not exists website_uri text;
alter table eateries add column if not exists attributes jsonb not null default '{}';
alter table eateries add column if not exists photo_refs text[] not null default '{}';

-- Attribution, required by Google's policies for AI-generated content, and
-- stored rather than hardcoded so wording changes on Google's side flow
-- through without a deploy. `summary_disclosure` covers both summary_overview
-- and summary_description (one disclosureText per generativeSummary).
alter table eateries add column if not exists summary_disclosure text;
alter table eateries add column if not exists review_summary_disclosure text;

comment on column eateries.photo_ref is
  'Primary card image. Always requested on deck load — one place-photo call per card.';
comment on column eateries.photo_refs is
  'Up to 5 photo resource names including the primary. Photos 2-5 are only ever requested when a detail sheet is opened, never on deck load.';
comment on column eateries.attributes is
  'Serving/venue flags from Places: vegetarian, breakfast, lunch, dinner, dine_in, takeout, groups. Values are true/false/null; only true is rendered.';

-- Both RPCs below are the 0006 versions with the new eatery columns added to
-- their payloads and nothing else changed. They are edited, not rewritten:
-- 0003-0006 accumulated the reveal context, the hours columns, the active-deck
-- position filter and the per-eatery match maths, all of which stay as they
-- are.

-- get_session_state: the deck needs the detail columns to render the summary
-- line on the card face and the detail sheet behind the "More info" affordance.
-- maps_uri joins the payload here for the first time — get_results has always
-- returned it, but the sheet's "Open in Maps" link needs it mid-session too.
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

-- get_results: same additions. The results rows reuse the same card and sheet
-- components, so they need the same columns to render identically.
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
        e.summary_overview, e.summary_description, e.summary_disclosure,
        e.review_summary, e.review_summary_uri, e.review_summary_disclosure,
        e.price_range_text, e.website_uri, e.attributes, e.photo_refs,
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
