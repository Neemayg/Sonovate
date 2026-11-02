-- App foundation: profiles, machines, recordings, context readings,
-- model versions, predictions, and the private recordings bucket.
--
-- Access model: every row belongs to exactly one user (owner_id). Child
-- tables carry owner_id too, tied to the parent by a composite foreign key,
-- so RLS checks are a single indexed comparison and a child row can never
-- point at another user's parent row.
--
-- Users may NOT write model_versions or predictions. Those are written only
-- by the inference service with the service-role key, so a user cannot
-- fabricate a score through the Data API.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 120),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

create policy profiles_update_own on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- A profile row is created for every new auth user. The function must be
-- security definer (it runs as the auth service role), so it lives in the
-- unexposed private schema and nobody else may execute it.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

revoke execute on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- shared helper
-- ---------------------------------------------------------------------------
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- machines
-- ---------------------------------------------------------------------------
create table public.machines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  machine_type text check (char_length(machine_type) <= 80),
  location text check (char_length(location) <= 200),
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Target of the composite foreign keys below.
  unique (id, owner_id)
);

create index machines_owner_id_idx on public.machines (owner_id);

create trigger machines_set_updated_at
  before update on public.machines
  for each row execute function private.set_updated_at();

alter table public.machines enable row level security;

create policy machines_select_own on public.machines
  for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy machines_insert_own on public.machines
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy machines_update_own on public.machines
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy machines_delete_own on public.machines
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- ---------------------------------------------------------------------------
-- recordings
-- ---------------------------------------------------------------------------
-- kind = 'baseline' is reserved for future per-machine normal reference
-- recordings; no enrollment flow exists yet. 'analysis' is the default.
create type public.recording_kind as enum ('baseline', 'analysis');

create table public.recordings (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null,
  owner_id uuid not null default auth.uid(),
  kind public.recording_kind not null default 'analysis',
  -- Object name inside the 'recordings' bucket: <owner_id>/<machine_id>/<id>.wav
  storage_path text not null unique,
  original_filename text check (char_length(original_filename) <= 255),
  size_bytes bigint check (size_bytes > 0),
  -- Read from the WAV header by the client for display only. The inference
  -- service re-validates the stored bytes and never trusts these values.
  duration_seconds double precision check (duration_seconds > 0),
  sample_rate_hz integer check (sample_rate_hz > 0),
  channels smallint check (channels > 0),
  recorded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (machine_id, owner_id)
    references public.machines (id, owner_id) on delete cascade,
  constraint recordings_storage_path_format check (
    storage_path = owner_id::text || '/' || machine_id::text || '/' || id::text || '.wav'
  )
);

create index recordings_owner_id_idx on public.recordings (owner_id);
create index recordings_machine_id_owner_id_idx on public.recordings (machine_id, owner_id);
create index recordings_machine_created_idx on public.recordings (machine_id, created_at desc);

alter table public.recordings enable row level security;

create policy recordings_select_own on public.recordings
  for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy recordings_insert_own on public.recordings
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy recordings_update_own on public.recordings
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy recordings_delete_own on public.recordings
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- ---------------------------------------------------------------------------
-- context_readings
-- ---------------------------------------------------------------------------
create table public.context_readings (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null,
  owner_id uuid not null default auth.uid(),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  value double precision not null check (value = value and value not in ('Infinity', '-Infinity')),
  unit text not null check (char_length(btrim(unit)) between 1 and 30),
  -- Only manual entry exists today; sensor sources would be added later.
  source text not null default 'user_entered' check (source in ('user_entered')),
  created_at timestamptz not null default now(),
  unique (recording_id, name),
  foreign key (recording_id, owner_id)
    references public.recordings (id, owner_id) on delete cascade
);

create index context_readings_owner_id_idx on public.context_readings (owner_id);
create index context_readings_recording_id_owner_id_idx on public.context_readings (recording_id, owner_id);

alter table public.context_readings enable row level security;

create policy context_readings_select_own on public.context_readings
  for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy context_readings_insert_own on public.context_readings
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy context_readings_update_own on public.context_readings
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy context_readings_delete_own on public.context_readings
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- ---------------------------------------------------------------------------
-- model_versions (global catalog, read-only to users, empty by default)
-- ---------------------------------------------------------------------------
create table public.model_versions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version text not null,
  preprocessing_version text not null,
  -- Reference to the experiment that validated this model (e.g. EXP-00N).
  evidence_ref text not null,
  created_at timestamptz not null default now(),
  unique (name, version)
);

alter table public.model_versions enable row level security;

create policy model_versions_select_authenticated on public.model_versions
  for select to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- predictions (written only by the inference service)
-- ---------------------------------------------------------------------------
create table public.predictions (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null,
  owner_id uuid not null,
  model_version_id uuid not null references public.model_versions (id) on delete restrict,
  -- Uncalibrated anomaly score: not a probability, not a diagnosis.
  score double precision not null check (score = score),
  threshold double precision not null check (threshold = threshold),
  decision text not null check (decision in ('below_threshold', 'above_threshold')),
  created_at timestamptz not null default now(),
  foreign key (recording_id, owner_id)
    references public.recordings (id, owner_id) on delete cascade
);

create index predictions_owner_id_idx on public.predictions (owner_id);
create index predictions_recording_id_owner_id_idx on public.predictions (recording_id, owner_id);
create index predictions_model_version_id_idx on public.predictions (model_version_id);

alter table public.predictions enable row level security;

create policy predictions_select_own on public.predictions
  for select to authenticated
  using ((select auth.uid()) = owner_id);

-- ---------------------------------------------------------------------------
-- Table privileges: least privilege on top of RLS. anon gets nothing;
-- authenticated gets only the operations and columns the app needs.
-- ---------------------------------------------------------------------------
revoke all on public.profiles, public.machines, public.recordings,
  public.context_readings, public.model_versions, public.predictions
  from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

grant select, insert, delete on public.machines to authenticated;
grant update (name, machine_type, location, notes) on public.machines to authenticated;

grant select, insert, delete on public.recordings to authenticated;
grant update (kind, recorded_at) on public.recordings to authenticated;

grant select, insert, delete on public.context_readings to authenticated;
grant update (name, value, unit) on public.context_readings to authenticated;

grant select on public.model_versions to authenticated;
grant select on public.predictions to authenticated;

grant all on public.profiles, public.machines, public.recordings,
  public.context_readings, public.model_versions, public.predictions
  to service_role;

-- ---------------------------------------------------------------------------
-- Storage: private bucket for recordings
-- ---------------------------------------------------------------------------
-- 10 s of 16 kHz mono audio is ~320 KB at 16-bit and ~640 KB at 32-bit float;
-- 2 MiB leaves room for header chunks while rejecting anything far larger.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recordings', 'recordings', false, 2097152,
  array['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave']
);

-- Objects live under <owner_id>/..., and may only be uploaded for a
-- recordings row the uploader already owns with exactly that path.
create policy recordings_objects_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy recordings_objects_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.recordings r
      where r.storage_path = objects.name
        and r.owner_id = (select auth.uid())
    )
  );

create policy recordings_objects_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- No update policy: stored recordings are immutable (no upsert/overwrite).
