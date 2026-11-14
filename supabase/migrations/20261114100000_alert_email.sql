-- Machine-alert email (Stage 6 of the production deployment).
--
-- The ADR-009 rule itself is unchanged: public.machine_alerts still decides
-- whether a machine is in alert (at least 2 of its last 3 analysed recordings
-- above threshold). This migration only records *when* an alert starts and
-- ends, so the owner can be emailed once per alert, and whether that email
-- was delivered.
--
-- 1. profiles.alert_emails: the owner's on/off preference (default on).
-- 2. machine_alert_episodes: one row per alert; a partial unique index allows
--    at most one open alert per machine, which is what prevents duplicates.
-- 3. sync_machine_alert(): called by the inference service after it stores a
--    prediction; opens or closes the episode and says whether it opened one.
-- 4. alert_email_target(): the owner's email, preference and machine name,
--    for the inference service only.

-- ---------------------------------------------------------------------------
-- 1. Preference
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column alert_emails boolean not null default true;

comment on column public.profiles.alert_emails is
  'Email the owner when one of their machines enters an ADR-009 alert.';

grant update (alert_emails) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Alert episodes and email delivery status
-- ---------------------------------------------------------------------------
create table public.machine_alert_episodes (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null,
  owner_id uuid not null,
  started_at timestamptz not null default now(),
  started_by_prediction_id uuid references public.predictions (id) on delete set null,
  ended_at timestamptz,
  email_status text not null default 'pending'
    check (email_status in ('pending', 'sent', 'failed', 'skipped_preference', 'skipped_unconfigured')),
  email_attempted_at timestamptz,
  email_error text check (char_length(email_error) <= 300),
  foreign key (machine_id, owner_id) references public.machines (id, owner_id) on delete cascade,
  check (ended_at is null or ended_at >= started_at)
);

comment on table public.machine_alert_episodes is
  'One row per ADR-009 machine alert, from the analysis that started it to the one that cleared it, with the owner email delivery status.';

create unique index machine_alert_episodes_one_open_idx
  on public.machine_alert_episodes (machine_id) where ended_at is null;
create index machine_alert_episodes_owner_id_idx on public.machine_alert_episodes (owner_id);
create index machine_alert_episodes_prediction_idx on public.machine_alert_episodes (started_by_prediction_id);

alter table public.machine_alert_episodes enable row level security;

-- Owners may read their own episodes (the app shows the delivery status).
-- Nobody but the inference service (service_role) writes them.
create policy machine_alert_episodes_select_own on public.machine_alert_episodes
  for select to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on public.machine_alert_episodes from anon, authenticated;
grant select on public.machine_alert_episodes to authenticated;
grant all on public.machine_alert_episodes to service_role;

-- ---------------------------------------------------------------------------
-- 3. Open or close a machine's alert episode after a new prediction
-- ---------------------------------------------------------------------------
-- Returns the id of the episode this call opened, or null when no episode was
-- opened (no alert, or the alert was already open). Concurrent calls cannot
-- open two episodes: the partial unique index makes the second insert a no-op.
create function public.sync_machine_alert(p_machine_id uuid, p_prediction_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert boolean;
  v_owner uuid;
  v_episode uuid;
begin
  select a.alert, a.owner_id into v_alert, v_owner
  from public.machine_alerts a
  where a.machine_id = p_machine_id;

  if coalesce(v_alert, false) then
    insert into public.machine_alert_episodes (machine_id, owner_id, started_by_prediction_id)
    values (p_machine_id, v_owner, p_prediction_id)
    on conflict (machine_id) where ended_at is null do nothing
    returning id into v_episode;
    return v_episode;
  end if;

  update public.machine_alert_episodes
  set ended_at = now()
  where machine_id = p_machine_id and ended_at is null;
  return null;
end;
$$;

revoke execute on function public.sync_machine_alert(uuid, uuid) from public, anon, authenticated;
grant execute on function public.sync_machine_alert(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Who to email about an episode
-- ---------------------------------------------------------------------------
create function public.alert_email_target(p_episode_id uuid)
returns table (
  email text,
  alert_emails boolean,
  machine_id uuid,
  machine_name text,
  above_threshold_count integer,
  analyses_considered integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select u.email::text, p.alert_emails, m.id, m.name,
         coalesce(a.above_threshold_count, 0), coalesce(a.analyses_considered, 0)
  from public.machine_alert_episodes e
  join public.machines m on m.id = e.machine_id and m.owner_id = e.owner_id
  join public.profiles p on p.id = e.owner_id
  join auth.users u on u.id = e.owner_id
  left join public.machine_alerts a on a.machine_id = e.machine_id
  where e.id = p_episode_id;
$$;

revoke execute on function public.alert_email_target(uuid) from public, anon, authenticated;
grant execute on function public.alert_email_target(uuid) to service_role;
