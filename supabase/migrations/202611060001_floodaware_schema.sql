create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 60),
  preferred_language text not null default 'en' check (preferred_language in ('en', 'hi')),
  notification_opt_in boolean not null default false,
  role text not null default 'member' check (role in ('member', 'moderator', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.flood_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users (id) on delete set null,
  reporter_name text check (reporter_name is null or char_length(reporter_name) <= 60),
  report_type text not null default 'street_flooding' check (report_type in ('street_flooding', 'underpass', 'drain_blockage', 'river_rise')),
  severity text not null check (severity in ('Ankle-deep', 'Knee-deep', 'Waist-deep', 'Impassable')),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  description text not null check (char_length(description) between 10 and 500),
  photo_path text,
  status text not null default 'active' check (status in ('active', 'resolved', 'removed')),
  is_demo boolean not null default false,
  demo_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_confirmed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '6 hours'),
  resolved_at timestamptz
);

create table public.report_votes (
  report_id uuid not null references public.flood_reports (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  vote_type text not null check (vote_type in ('confirm', 'cleared')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (report_id, user_id)
);

create table public.report_comments (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.flood_reports (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.saved_places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 60),
  category text not null default 'custom' check (category in ('home', 'work', 'school', 'custom')),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  radius_meters integer not null default 1500 check (radius_meters between 250 and 10000),
  created_at timestamptz not null default now(),
  unique (user_id, label)
);

create table public.saved_routes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  route_mode text not null default 'drive' check (route_mode in ('drive', 'two-wheeler', 'walk')),
  start_latitude double precision not null check (start_latitude between -90 and 90),
  start_longitude double precision not null check (start_longitude between -180 and 180),
  end_latitude double precision not null check (end_latitude between -90 and 90),
  end_longitude double precision not null check (end_longitude between -180 and 180),
  route_geojson jsonb not null,
  distance_meters double precision not null check (distance_meters >= 0),
  duration_seconds double precision not null check (duration_seconds >= 0),
  risk_score integer not null check (risk_score between 0 and 100),
  created_at timestamptz not null default now()
);

create table public.alert_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  notify_on_reports boolean not null default true,
  notify_on_forecast boolean not null default false,
  minimum_severity text not null default 'Knee-deep' check (minimum_severity in ('Ankle-deep', 'Knee-deep', 'Waist-deep', 'Impassable')),
  radius_meters integer not null default 1500 check (radius_meters between 250 and 10000),
  updated_at timestamptz not null default now()
);

create table public.user_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  report_id uuid references public.flood_reports (id) on delete set null,
  saved_place_id uuid references public.saved_places (id) on delete set null,
  title text not null check (char_length(title) <= 120),
  body text not null check (char_length(body) <= 500),
  severity text check (severity is null or severity in ('Ankle-deep', 'Knee-deep', 'Waist-deep', 'Impassable')),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  report_id uuid references public.flood_reports (id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table private.report_rate_events (
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
create index report_rate_events_created_at_idx on private.report_rate_events (ip_hash, created_at desc);

create index flood_reports_created_at_idx on public.flood_reports (created_at desc);
create index flood_reports_status_expiry_idx on public.flood_reports (status, expires_at);
create index flood_reports_location_idx on public.flood_reports (latitude, longitude);
create index report_votes_report_type_idx on public.report_votes (report_id, vote_type);
create index report_comments_report_created_idx on public.report_comments (report_id, created_at desc);
create index saved_places_user_idx on public.saved_places (user_id);
create index user_alerts_user_created_idx on public.user_alerts (user_id, created_at desc);
create index saved_routes_user_created_idx on public.saved_routes (user_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger votes_set_updated_at before update on public.report_votes
for each row execute function public.set_updated_at();
create trigger comments_set_updated_at before update on public.report_comments
for each row execute function public.set_updated_at();
create trigger preferences_set_updated_at before update on public.alert_preferences
for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'FloodAware member')
  )
  on conflict (id) do nothing;
  insert into public.alert_preferences (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create or replace function public.apply_report_vote_effects()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report_id uuid;
  v_vote_type text;
  v_confirmations integer;
  v_cleared integer;
begin
  if tg_op = 'DELETE' then
    v_report_id := old.report_id;
    v_vote_type := null;
  else
    v_report_id := new.report_id;
    v_vote_type := new.vote_type;
  end if;

  select
    count(*) filter (where vote_type = 'confirm')::integer,
    count(*) filter (where vote_type = 'cleared')::integer
  into v_confirmations, v_cleared
  from public.report_votes
  where report_id = v_report_id;

  update public.flood_reports
  set
    last_confirmed_at = case when v_vote_type = 'confirm' then now() else last_confirmed_at end,
    expires_at = case when v_vote_type = 'confirm' then now() + interval '6 hours' else expires_at end,
    status = case
      when v_cleared >= 3 then 'resolved'
      when status = 'resolved' and expires_at > now() then 'active'
      else status
    end,
    resolved_at = case
      when v_cleared >= 3 then coalesce(resolved_at, now())
      when status = 'resolved' and expires_at > now() then null
      else resolved_at
    end,
    updated_at = now()
  where id = v_report_id;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger report_vote_effects
  after insert or update or delete on public.report_votes
  for each row execute function public.apply_report_vote_effects();

create or replace function public.consume_report_rate_limit(p_ip_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recent_count integer;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_rate_limit_key' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_ip_hash, 0));
  delete from private.report_rate_events where created_at < now() - interval '24 hours';
  select count(*)::integer into v_recent_count
  from private.report_rate_events
  where ip_hash = p_ip_hash and created_at > now() - interval '10 minutes';
  if v_recent_count >= 5 then
    raise exception 'rate_limit_exceeded' using errcode = 'P0001';
  end if;
  insert into private.report_rate_events (ip_hash) values (p_ip_hash);
end;
$$;
revoke all on function public.consume_report_rate_limit(text) from public, anon, authenticated;
grant execute on function public.consume_report_rate_limit(text) to service_role;

create or replace function public.create_flood_report(
  p_report_id uuid,
  p_reporter_id uuid,
  p_reporter_name text,
  p_report_type text,
  p_severity text,
  p_latitude double precision,
  p_longitude double precision,
  p_description text,
  p_photo_path text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_severity not in ('Ankle-deep', 'Knee-deep', 'Waist-deep', 'Impassable') then
    raise exception 'invalid_severity' using errcode = '22023';
  end if;
  if p_latitude is null or p_latitude not between -90 and 90 or p_longitude is null or p_longitude not between -180 and 180 then
    raise exception 'invalid_coordinates' using errcode = '22023';
  end if;
  if p_description is null or char_length(btrim(p_description)) not between 10 and 500 then
    raise exception 'invalid_description' using errcode = '22023';
  end if;
  if p_reporter_name is not null and char_length(p_reporter_name) > 60 then
    raise exception 'invalid_reporter_name' using errcode = '22023';
  end if;
  if p_report_type not in ('street_flooding', 'underpass', 'drain_blockage', 'river_rise') then
    raise exception 'invalid_report_type' using errcode = '22023';
  end if;
  if p_photo_path is not null and p_photo_path !~ '^reports/[0-9a-f-]+\.(jpg|png|webp)$' then
    raise exception 'invalid_photo_path' using errcode = '22023';
  end if;

  insert into public.flood_reports (
    id, reporter_id, reporter_name, report_type, severity, latitude, longitude,
    description, photo_path, status, is_demo, last_confirmed_at, expires_at
  ) values (
    p_report_id, p_reporter_id, nullif(btrim(p_reporter_name), ''), p_report_type, p_severity,
    p_latitude, p_longitude, btrim(p_description), p_photo_path, 'active', false,
    now(), now() + interval '6 hours'
  );

  insert into public.user_alerts (user_id, report_id, saved_place_id, title, body, severity)
  select distinct
    places.user_id,
    p_report_id,
    places.id,
    'Flood report near ' || places.label,
    'A new ' || p_severity || ' waterlogging report is near ' || places.label || '.',
    p_severity
  from public.saved_places as places
  join public.alert_preferences as preferences on preferences.user_id = places.user_id
  where preferences.notify_on_reports
    and (case p_severity when 'Ankle-deep' then 1 when 'Knee-deep' then 2 when 'Waist-deep' then 3 else 4 end) >= (case preferences.minimum_severity when 'Ankle-deep' then 1 when 'Knee-deep' then 2 when 'Waist-deep' then 3 else 4 end)
    and places.user_id is distinct from p_reporter_id
    and 6371000 * 2 * asin(least(1, sqrt(
      power(sin(radians(places.latitude - p_latitude) / 2), 2) +
      cos(radians(p_latitude)) * cos(radians(places.latitude)) *
      power(sin(radians(places.longitude - p_longitude) / 2), 2)
    ))) <= least(places.radius_meters, preferences.radius_meters);

  return p_report_id;
end;
$$;

revoke all on function public.create_flood_report(uuid, uuid, text, text, text, double precision, double precision, text, text) from public, anon, authenticated;
grant execute on function public.create_flood_report(uuid, uuid, text, text, text, double precision, double precision, text, text) to service_role;

create or replace function public.moderate_flood_report(p_report_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists (select 1 from public.profiles where id = v_actor and role in ('moderator', 'admin')) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_status not in ('active', 'removed') then
    raise exception 'invalid_moderation_status' using errcode = '22023';
  end if;
  update public.flood_reports
  set status = p_status, updated_at = now()
  where id = p_report_id and status <> 'resolved';
  if not found then raise exception 'report_not_found_or_resolved' using errcode = 'P0002'; end if;
  insert into public.admin_audit_log (actor_id, action, report_id)
  values (v_actor, case when p_status = 'removed' then 'remove_report' else 'restore_report' end, p_report_id);
end;
$$;
revoke all on function public.moderate_flood_report(uuid, text) from public, anon;
grant execute on function public.moderate_flood_report(uuid, text) to authenticated;

create or replace view public.flood_report_summary
with (security_invoker = false)
as
select
  reports.id,
  case when reports.reporter_id = auth.uid() then reports.reporter_id else null end as reporter_id,
  reports.reporter_name,
  reports.report_type,
  reports.severity,
  reports.latitude,
  reports.longitude,
  reports.description,
  reports.photo_path,
  reports.status,
  reports.is_demo,
  reports.created_at,
  reports.updated_at,
  reports.last_confirmed_at,
  reports.expires_at,
  reports.resolved_at,
  count(votes.user_id) filter (where votes.vote_type = 'confirm')::integer as confirmations,
  count(votes.user_id) filter (where votes.vote_type = 'cleared')::integer as cleared_votes
from public.flood_reports as reports
left join public.report_votes as votes on votes.report_id = reports.id
where reports.status <> 'removed' and (reports.status <> 'active' or reports.expires_at > now())
group by reports.id;

grant select on public.flood_report_summary to anon, authenticated;

alter table public.profiles enable row level security;
alter table public.flood_reports enable row level security;
alter table public.report_votes enable row level security;
alter table public.report_comments enable row level security;
alter table public.saved_places enable row level security;
alter table public.saved_routes enable row level security;
alter table public.alert_preferences enable row level security;
alter table public.user_alerts enable row level security;
alter table public.admin_audit_log enable row level security;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, preferred_language, notification_opt_in) on public.profiles to authenticated;
create policy profiles_select_own on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy flood_reports_public_read on public.flood_reports for select to anon, authenticated
using (status <> 'removed' and (status <> 'active' or expires_at > now()));
revoke all on public.flood_reports from anon, authenticated;
grant select (id, status, expires_at) on public.flood_reports to anon, authenticated;
grant update (status) on public.flood_reports to authenticated;
create policy flood_reports_moderator_update on public.flood_reports for update to authenticated
using (exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('moderator', 'admin')))
with check (exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('moderator', 'admin')));

create policy report_votes_select_own on public.report_votes for select to authenticated using (user_id = (select auth.uid()));
create policy report_votes_insert_own on public.report_votes for insert to authenticated with check (user_id = (select auth.uid()));
create policy report_votes_update_own on public.report_votes for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy report_votes_delete_own on public.report_votes for delete to authenticated using (user_id = (select auth.uid()));
revoke select on public.report_votes from anon, authenticated;
grant select on public.report_votes to authenticated;
grant insert, update, delete on public.report_votes to authenticated;

create policy report_comments_public_read on public.report_comments for select to anon, authenticated
using (exists (select 1 from public.flood_reports where id = report_id and status <> 'removed'));
create policy report_comments_insert_own on public.report_comments for insert to authenticated
with check (user_id = (select auth.uid()) and exists (select 1 from public.flood_reports where id = report_id and status = 'active' and expires_at > now()));
create policy report_comments_delete_own_or_mod on public.report_comments for delete to authenticated
using (user_id = (select auth.uid()) or exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('moderator', 'admin')));
revoke all on public.report_comments from anon, authenticated;
grant select (id, report_id, body, created_at, updated_at) on public.report_comments to anon, authenticated;
grant insert (report_id, user_id, body) on public.report_comments to authenticated;
grant delete on public.report_comments to authenticated;

create policy saved_places_own on public.saved_places for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.saved_places to authenticated;

create policy saved_routes_own on public.saved_routes for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.saved_routes to authenticated;

create policy alert_preferences_own on public.alert_preferences for all to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.alert_preferences to authenticated;

create policy user_alerts_read_own on public.user_alerts for select to authenticated using (user_id = (select auth.uid()));
create policy user_alerts_mark_read_own on public.user_alerts for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select on public.user_alerts to authenticated;
grant update (read_at) on public.user_alerts to authenticated;

create policy admin_audit_read_mod on public.admin_audit_log for select to authenticated
using (exists (select 1 from public.profiles where id = (select auth.uid()) and role in ('moderator', 'admin')));
grant select on public.admin_audit_log to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-photos', 'report-photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

insert into public.flood_reports (demo_key, report_type, severity, latitude, longitude, description, status, is_demo, created_at, updated_at, last_confirmed_at, expires_at, resolved_at)
values
  ('hyd-demo-01', 'street_flooding', 'Knee-deep', 17.4372, 78.4482, 'Water is pooling across the service lane after the rain.', 'active', true, now() - interval '18 minutes', now() - interval '18 minutes', now() - interval '8 minutes', now() + interval '5 hours 52 minutes', null),
  ('hyd-demo-02', 'street_flooding', 'Waist-deep', 17.4067, 78.4772, 'Floodwater is covering the lower part of the road.', 'active', true, now() - interval '32 minutes', now() - interval '32 minutes', now() - interval '22 minutes', now() + interval '5 hours 38 minutes', null),
  ('hyd-demo-03', 'street_flooding', 'Ankle-deep', 17.3926, 78.4901, 'Standing water near the junction; traffic is moving slowly.', 'active', true, now() - interval '47 minutes', now() - interval '47 minutes', now() - interval '37 minutes', now() + interval '5 hours 23 minutes', null),
  ('hyd-demo-04', 'underpass', 'Impassable', 17.4213, 78.4517, 'Vehicles cannot pass through the underpass right now.', 'active', true, now() - interval '61 minutes', now() - interval '61 minutes', now() - interval '51 minutes', now() + interval '5 hours 9 minutes', null),
  ('hyd-demo-05', 'street_flooding', 'Knee-deep', 17.3668, 78.4753, 'Water is spilling onto the footpath and left lane.', 'active', true, now() - interval '74 minutes', now() - interval '74 minutes', now() - interval '64 minutes', now() + interval '4 hours 56 minutes', null),
  ('hyd-demo-06', 'street_flooding', 'Ankle-deep', 17.4421, 78.5015, 'A shallow but growing pool is forming at the road edge.', 'active', true, now() - interval '89 minutes', now() - interval '89 minutes', null, now() + interval '4 hours 31 minutes', null),
  ('hyd-demo-07', 'street_flooding', 'Waist-deep', 17.3891, 78.4385, 'Water has reached the door line of parked cars.', 'active', true, now() - interval '103 minutes', now() - interval '103 minutes', now() - interval '93 minutes', now() + interval '4 hours 17 minutes', null),
  ('hyd-demo-08', 'underpass', 'Knee-deep', 17.4548, 78.3834, 'The low point under the bridge is waterlogged.', 'active', true, now() - interval '116 minutes', now() - interval '116 minutes', now() - interval '106 minutes', now() + interval '4 hours 4 minutes', null),
  ('hyd-demo-09', 'street_flooding', 'Ankle-deep', 17.3734, 78.5141, 'Water is collecting around the curb and crossing.', 'active', true, now() - interval '129 minutes', now() - interval '129 minutes', now() - interval '119 minutes', now() + interval '3 hours 51 minutes', null),
  ('hyd-demo-10', 'street_flooding', 'Waist-deep', 17.4157, 78.4932, 'Two lanes are under water; use the parallel road.', 'active', true, now() - interval '145 minutes', now() - interval '145 minutes', now() - interval '135 minutes', now() + interval '3 hours 35 minutes', null),
  ('hyd-demo-11', 'street_flooding', 'Knee-deep', 17.3527, 78.4484, 'A deep puddle is slowing buses and smaller vehicles.', 'active', true, now() - interval '164 minutes', now() - interval '164 minutes', now() - interval '154 minutes', now() + interval '3 hours 16 minutes', null),
  ('hyd-demo-12', 'street_flooding', 'Ankle-deep', 17.4286, 78.4778, 'Water is flowing across the street from the side drain.', 'active', true, now() - interval '183 minutes', now() - interval '183 minutes', null, now() + interval '2 hours 57 minutes', null),
  ('hyd-demo-13', 'underpass', 'Impassable', 17.3972, 78.5266, 'The road dip is fully covered; please do not enter.', 'active', true, now() - interval '205 minutes', now() - interval '205 minutes', now() - interval '195 minutes', now() + interval '2 hours 35 minutes', null),
  ('hyd-demo-14', 'street_flooding', 'Knee-deep', 17.4634, 78.4558, 'Water is over the road markings at this low stretch.', 'active', true, now() - interval '227 minutes', now() - interval '227 minutes', now() - interval '217 minutes', now() + interval '2 hours 13 minutes', null),
  ('hyd-demo-15', 'street_flooding', 'Ankle-deep', 17.3811, 78.4618, 'Shallow water is moving slowly through the junction.', 'active', true, now() - interval '249 minutes', now() - interval '249 minutes', now() - interval '239 minutes', now() + interval '1 hour 51 minutes', null),
  ('hyd-demo-16', 'street_flooding', 'Waist-deep', 17.4356, 78.5194, 'Water is above the wheel hubs on the lowest section.', 'active', true, now() - interval '273 minutes', now() - interval '273 minutes', now() - interval '263 minutes', now() + interval '1 hour 27 minutes', null),
  ('hyd-demo-17', 'street_flooding', 'Knee-deep', 17.3588, 78.4972, 'Water is receding; one lane remains difficult to use.', 'resolved', true, now() - interval '296 minutes', now() - interval '296 minutes', now() - interval '286 minutes', now() + interval '1 hour 4 minutes', now() - interval '284 minutes'),
  ('hyd-demo-18', 'street_flooding', 'Ankle-deep', 17.4042, 78.4213, 'The reported pooling has cleared and the road is passable.', 'resolved', true, now() - interval '322 minutes', now() - interval '322 minutes', now() - interval '312 minutes', now() + interval '38 minutes', now() - interval '310 minutes')
on conflict (demo_key) do nothing;

DO $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'flood_reports') then
      alter publication supabase_realtime add table public.flood_reports;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'report_votes') then
      alter publication supabase_realtime add table public.report_votes;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_alerts') then
      alter publication supabase_realtime add table public.user_alerts;
    end if;
  end if;
end;
$$;
