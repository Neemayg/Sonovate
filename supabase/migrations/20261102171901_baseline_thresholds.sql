-- Per-machine baseline thresholds for the research-prototype models (ADR-007).
--
-- * model_versions gains the machine type it serves, the bundle's
--   limitations (shown beside every result) and the bundle.json sha256.
-- * predictions now store the log score next to the raw score; threshold is
--   in log space and the decision must agree with log_score > threshold.
-- * machine_thresholds holds one threshold per machine and model version,
--   computed by the inference service from the machine's baseline
--   recordings with the EXP-005 rule. Users can read their own rows but not
--   write them, so a threshold cannot be forged through the Data API.

alter table public.model_versions
  add column machine_type public.machine_type,
  add column limitations text[] not null default '{}',
  add column bundle_sha256 text check (bundle_sha256 ~ '^[0-9a-f]{64}$');

alter table public.predictions
  add column log_score double precision check (log_score = log_score),
  add column baseline_count integer check (baseline_count >= 10),
  add constraint predictions_decision_matches_log_score check (
    log_score is null
    or decision = case when log_score > threshold then 'above_threshold' else 'below_threshold' end
  );

create table public.machine_thresholds (
  machine_id uuid not null,
  owner_id uuid not null,
  model_version_id uuid not null references public.model_versions (id) on delete restrict,
  -- mean(log s) + spread * std(log s) over the baseline recordings.
  threshold double precision not null check (threshold = threshold),
  log_mean double precision not null check (log_mean = log_mean),
  log_std double precision not null check (log_std >= 0),
  spread double precision not null check (spread > 0),
  baseline_count integer not null check (baseline_count >= 10),
  -- The exact recordings used, so a change in baselines triggers a recompute.
  baseline_recording_ids uuid[] not null
    check (cardinality(baseline_recording_ids) = baseline_count),
  computed_at timestamptz not null default now(),
  primary key (machine_id, model_version_id),
  foreign key (machine_id, owner_id)
    references public.machines (id, owner_id) on delete cascade
);

create index machine_thresholds_owner_id_idx on public.machine_thresholds (owner_id);
create index machine_thresholds_machine_id_owner_id_idx on public.machine_thresholds (machine_id, owner_id);
create index machine_thresholds_model_version_id_idx on public.machine_thresholds (model_version_id);

alter table public.machine_thresholds enable row level security;

create policy machine_thresholds_select_own on public.machine_thresholds
  for select to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on public.machine_thresholds from anon, authenticated;
grant select on public.machine_thresholds to authenticated;
grant all on public.machine_thresholds to service_role;
