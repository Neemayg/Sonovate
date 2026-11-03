-- Deployment hardening and the over-time machine alert.
--
-- 1. Model versions become reference data in a migration (they were only in
--    the local seed, so a production push would have broken every analysis).
-- 2. Server-side caps: 50 baseline recordings per machine, 500 recordings per
--    user, enforced by a trigger that serialises inserts per user.
-- 3. machine_alerts view (ADR-009): a machine alert when at least 2 of its
--    last 3 analysed recordings are above its baseline threshold.

-- ---------------------------------------------------------------------------
-- 1. Model versions (service-role reference data; users can only read them)
-- ---------------------------------------------------------------------------
-- Model versions for the two research-prototype bundles (ADR-007). The ids
-- and bundle.json sha256 values must match ALLOWED_BUNDLES in
-- backend/app/bundle.py; limitations are copied from each bundle.json.
-- Superseded by AST (ADR-008) but kept so older predictions still resolve.
insert into public.model_versions (
  id, name, version, preprocessing_version, evidence_ref, machine_type, bundle_sha256, limitations
) values
(
  '5e1d0000-0000-4000-8000-00000000b001', 'sonovate-autoencoder-bearing', '0.1.0', 'logmel-128-frames-5-v1',
  'EXP-002 (model), EXP-005 (per-machine baseline threshold); research prototype per ADR-007; bundle.json sha256 3357651c3aca0eec136e31d6626981d292870c8e1a4c1fdc2525011e2ab70a73',
  'bearing', '3357651c3aca0eec136e31d6626981d292870c8e1a4c1fdc2525011e2ab70a73',
  array[
    'Trained on MIMII DG lab bearings only; other machines are out of scope.',
    'At the baseline threshold, detection was at chance level on bearing section 00 (EXP-005).',
    'Below threshold does not mean healthy.'
  ]
),
(
  '5e1d0000-0000-4000-8000-00000000b002', 'sonovate-autoencoder-gearbox', '0.1.0', 'logmel-128-frames-5-v1',
  'EXP-002 (model), EXP-005 (per-machine baseline threshold); research prototype per ADR-007; bundle.json sha256 ca9ad32773c4e0fd5979cb4b2132f4c9611568f9fc8a202b7674502f95ed89cd',
  'gearbox', 'ca9ad32773c4e0fd5979cb4b2132f4c9611568f9fc8a202b7674502f95ed89cd',
  array[
    'Trained on MIMII DG lab gearboxes only; other machines are out of scope.',
    'At the baseline threshold, it caught 17-30% of anomalies on gearbox section 00 with 5-7% false alarms (EXP-005).',
    'Below threshold does not mean healthy.'
  ]
)
on conflict (id) do nothing;

-- Frozen AST with nearest-neighbour scoring against each machine's own
-- baselines (ADR-008). Serves bearing and gearbox, so machine_type is null.
-- The id and bundle.json sha256 must match ALLOWED_BUNDLES in
-- backend/app/bundle.py; limitations are copied verbatim from bundle.json.
insert into public.model_versions (
  id, name, version, preprocessing_version, evidence_ref, machine_type, bundle_sha256, limitations
) values (
  '5e1d0000-0000-4000-8000-00000000b003', 'sonovate-ast-knn', '0.2.0', 'ast-feature-extractor@sonovate-ast-knn-0.2.0',
  'EXP-007 (frozen AST encoder), EXP-009 (final test vs autoencoder), EXP-010 (10-baseline references and leave-one-out threshold); research prototype per ADR-007 and ADR-008; bundle.json sha256 ee073744c900ba035d00bac819919b990df0f197a26d8ee8077645a68b487509',
  null, 'ee073744c900ba035d00bac819919b990df0f197a26d8ee8077645a68b487509',
  array[
    'Validated only on MIMII DG / DCASE 2022 lab bearings and gearboxes; other machines are out of scope.',
    'On untouched evaluation data, AST was better than the autoencoder on gearbox (AUC 0.730 vs 0.654) but not on bearing (0.626 vs 0.646) (EXP-009).',
    'At the baseline threshold it caught only about 3-24% of anomalies with 2-7% false alarms (EXP-010).',
    'Below threshold does not mean healthy.'
  ]
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Caps on recordings
-- ---------------------------------------------------------------------------
-- Security invoker: a user's own rows are all visible to them under RLS, so
-- the counts are complete; the service role sees everything anyway. The
-- advisory lock serialises concurrent inserts for one user so two uploads
-- cannot both pass a count at the limit.
create function private.enforce_recording_caps()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  max_recordings constant integer := 500;
  max_baselines constant integer := 50;
begin
  perform pg_advisory_xact_lock(hashtextextended('recording_caps:' || new.owner_id::text, 0));

  if tg_op = 'INSERT'
     and (select count(*) from public.recordings r where r.owner_id = new.owner_id) >= max_recordings then
    raise exception using
      errcode = 'P0001',
      message = 'recording_limit_reached',
      detail = format('An account can hold at most %s recordings.', max_recordings);
  end if;

  if new.kind = 'baseline'
     and (tg_op = 'INSERT' or old.kind is distinct from 'baseline')
     and (select count(*) from public.recordings r
          where r.machine_id = new.machine_id and r.kind = 'baseline' and r.id <> new.id) >= max_baselines then
    raise exception using
      errcode = 'P0001',
      message = 'baseline_limit_reached',
      detail = format('A machine can have at most %s baseline recordings.', max_baselines);
  end if;

  return new;
end;
$$;

revoke execute on function private.enforce_recording_caps() from public, anon, authenticated;

create trigger recordings_enforce_caps
  before insert or update of kind on public.recordings
  for each row execute function private.enforce_recording_caps();

-- ---------------------------------------------------------------------------
-- 3. Machine alert (ADR-009, EXP-011)
-- ---------------------------------------------------------------------------
-- One decision per analysed recording (its latest prediction, so re-running
-- an analysis does not count twice); the machine's last 3 such recordings,
-- by analysis time. security_invoker keeps the RLS of the underlying tables.
create view public.machine_alerts
with (security_invoker = true)
as
with latest_per_recording as (
  select distinct on (p.recording_id)
    r.machine_id,
    r.owner_id,
    p.recording_id,
    p.decision,
    p.created_at
  from public.predictions p
  join public.recordings r on r.id = p.recording_id and r.owner_id = p.owner_id
  where r.kind = 'analysis'
  order by p.recording_id, p.created_at desc
),
ranked as (
  select l.*, row_number() over (partition by l.machine_id order by l.created_at desc) as recency
  from latest_per_recording l
)
select
  machine_id,
  owner_id,
  count(*)::integer as analyses_considered,
  count(*) filter (where decision = 'above_threshold')::integer as above_threshold_count,
  (count(*) filter (where decision = 'above_threshold') >= 2) as alert,
  max(created_at) as last_analysed_at
from ranked
where recency <= 3
group by machine_id, owner_id;

comment on view public.machine_alerts is
  'ADR-009: alert = at least 2 of the machine''s last 3 analysed recordings above its baseline threshold. Chosen on simulated timelines (EXP-011); misses most faults.';

revoke all on public.machine_alerts from anon, authenticated;
grant select on public.machine_alerts to authenticated;
