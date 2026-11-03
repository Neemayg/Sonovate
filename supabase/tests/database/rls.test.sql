-- Row-level security and storage isolation between two users.
-- Run with: npx supabase@2.122.0 test db
begin;
create extension if not exists pgtap with schema extensions;

select plan(74);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres, bypassing RLS). Fixed ids keep failures readable.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'rls-a@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'rls-b@example.test', 'authenticated', 'authenticated');

select is(
  (select count(*)::int from public.profiles
   where id in ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002')),
  2, 'signup trigger creates a profile per user');

insert into public.machines (id, owner_id, name)
values
  ('a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'A pump'),
  ('b1000000-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'B gearbox');

insert into public.recordings (id, machine_id, owner_id, storage_path)
values
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001/a2000000-0000-0000-0000-000000000001.wav'),
  ('b2000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000002/b1000000-0000-0000-0000-000000000002/b2000000-0000-0000-0000-000000000002.wav');

insert into public.context_readings (recording_id, owner_id, name, value, unit)
values
  ('a2000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'speed', 1500, 'rpm'),
  ('b2000000-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002', 'voltage', 230, 'V');

insert into public.model_versions (id, name, version, preprocessing_version, evidence_ref)
values
  ('c0000000-0000-0000-0000-000000000001', 'rls-test-model', '0', 'p0', 'rls test fixture'),
  ('c0000000-0000-0000-0000-000000000002', 'rls-test-model', '1', 'p0', 'rls test fixture');

insert into public.predictions (recording_id, owner_id, model_version_id, score, threshold, decision)
values
  ('b2000000-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002',
   'c0000000-0000-0000-0000-000000000001', 1.0, 2.0, 'below_threshold');

insert into public.machine_thresholds (
  machine_id, owner_id, model_version_id, threshold, log_mean, log_std, spread, baseline_count, baseline_recording_ids)
values ('b1000000-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002',
  'c0000000-0000-0000-0000-000000000001', 3.5, 3.0, 0.25, 2.0, 10,
  array(select gen_random_uuid() from generate_series(1, 10)));

select throws_ok(
  $$insert into public.predictions (recording_id, owner_id, model_version_id, score, log_score, threshold, decision)
    values ('b2000000-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002',
    'c0000000-0000-0000-0000-000000000001', 2.718281828, 1.0, 2.0, 'above_threshold')$$,
  '23514', null, 'a prediction decision must agree with log_score > threshold');

select throws_ok(
  $$insert into public.machine_thresholds (
    machine_id, owner_id, model_version_id, threshold, log_mean, log_std, spread, baseline_count, baseline_recording_ids)
    values ('b1000000-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002',
    'c0000000-0000-0000-0000-000000000001', 1, 1, 0, 2, 3, array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()])$$,
  '23514', null, 'a threshold needs at least 10 baseline recordings');

insert into public.baseline_embeddings (recording_id, owner_id, model_version_id, embedding)
values ('b2000000-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002',
  'c0000000-0000-0000-0000-000000000001', array[0.6, 0.8]::real[]);

select throws_ok(
  $$insert into public.baseline_embeddings (recording_id, owner_id, model_version_id, embedding)
    values ('b2000000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000002', array[1.0]::real[])$$,
  '23503', null, 'an embedding cannot be attached to another owner''s recording');

insert into storage.objects (bucket_id, name, owner_id)
values ('recordings',
  'bbbbbbbb-0000-0000-0000-000000000002/b1000000-0000-0000-0000-000000000002/b2000000-0000-0000-0000-000000000002.wav',
  'bbbbbbbb-0000-0000-0000-000000000002');

-- ---------------------------------------------------------------------------
-- Every public table has RLS enabled
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0, 'every table in public has RLS enabled');

select is(
  (select public from storage.buckets where id = 'recordings'),
  false, 'recordings bucket is private');

-- ---------------------------------------------------------------------------
-- Anonymous callers see nothing
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok('select * from public.machines', '42501', null, 'anon cannot read machines');
select throws_ok('select * from public.recordings', '42501', null, 'anon cannot read recordings');
select throws_ok('select * from public.predictions', '42501', null, 'anon cannot read predictions');
select is((select count(*)::int from storage.objects where bucket_id = 'recordings'), 0,
  'anon sees no recording files');

-- ---------------------------------------------------------------------------
-- As user A
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- reads
select is((select count(*)::int from public.profiles), 1, 'A sees only own profile');
select is((select count(*)::int from public.machines), 1, 'A sees only own machine');
select is((select name from public.machines), 'A pump', 'A sees the right machine');
select is((select count(*)::int from public.recordings), 1, 'A sees only own recording');
select is((select count(*)::int from public.context_readings), 1, 'A sees only own context');
select is((select count(*)::int from public.predictions), 0, 'A cannot see B prediction');
select is((select count(*)::int from storage.objects where bucket_id = 'recordings'), 0,
  'A cannot list B recording file');

-- writes against B's rows silently affect nothing
update public.machines set name = 'hijacked' where id = 'b1000000-0000-0000-0000-000000000002';
update public.machines set machine_type = 'bearing' where id = 'b1000000-0000-0000-0000-000000000002';
delete from public.machines where id = 'b1000000-0000-0000-0000-000000000002';
delete from public.recordings where id = 'b2000000-0000-0000-0000-000000000002';
update public.context_readings set value = 0 where owner_id = 'bbbbbbbb-0000-0000-0000-000000000002';
update public.profiles set display_name = 'hijacked' where id = 'bbbbbbbb-0000-0000-0000-000000000002';
-- (Storage deletes are blocked in SQL by Supabase and are covered by
-- supabase/tests/storage_api_isolation.mjs through the Storage API.)

-- inserts that try to claim or attach to B's data are rejected
select throws_ok(
  $$insert into public.machines (owner_id, name) values ('bbbbbbbb-0000-0000-0000-000000000002', 'x')$$,
  '42501', null, 'A cannot create a machine owned by B');

select throws_ok(
  $$insert into public.recordings (id, machine_id, storage_path) values (
    'a3000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000002',
    'aaaaaaaa-0000-0000-0000-000000000001/b1000000-0000-0000-0000-000000000002/a3000000-0000-0000-0000-000000000003.wav')$$,
  '23503', null, 'A cannot add a recording to B machine');

select throws_ok(
  $$insert into public.context_readings (recording_id, name, value, unit)
    values ('b2000000-0000-0000-0000-000000000002', 'speed', 1, 'rpm')$$,
  '23503', null, 'A cannot add context to B recording');

select throws_ok(
  $$update public.machines set owner_id = 'bbbbbbbb-0000-0000-0000-000000000002'
    where id = 'a1000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'A cannot reassign own machine to B');

select throws_ok(
  $$update public.recordings set storage_path = 'x' where id = 'a2000000-0000-0000-0000-000000000001'$$,
  '42501', null, 'A cannot change a recording storage path');

select throws_ok(
  $$insert into public.predictions (recording_id, owner_id, model_version_id, score, threshold, decision)
    values ('a2000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000001', 0, 1, 'below_threshold')$$,
  '42501', null, 'A cannot write own predictions');

select is((select count(*)::int from public.machine_thresholds), 0, 'A cannot see B threshold');

select is((select count(*)::int from public.baseline_embeddings), 0, 'A cannot see B baseline embeddings');

select throws_ok(
  $$insert into public.baseline_embeddings (recording_id, owner_id, model_version_id, embedding)
    values ('a2000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000001', array[1.0]::real[])$$,
  '42501', null, 'A cannot write an embedding, even for own recording');

select throws_ok(
  $$delete from public.baseline_embeddings$$,
  '42501', null, 'A cannot delete embeddings');

select throws_ok(
  $$insert into public.machine_thresholds (
    machine_id, owner_id, model_version_id, threshold, log_mean, log_std, spread, baseline_count, baseline_recording_ids)
    values ('a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000001', 99, 1, 0, 2, 10, array(select gen_random_uuid() from generate_series(1, 10)))$$,
  '42501', null, 'A cannot write a threshold, even for own machine');

select throws_ok(
  $$update public.machine_thresholds set threshold = 99$$,
  '42501', null, 'A cannot change thresholds');

select throws_ok(
  $$delete from public.machine_thresholds$$,
  '42501', null, 'A cannot delete thresholds');

select throws_ok(
  $$insert into public.model_versions (name, version, preprocessing_version, evidence_ref)
    values ('fake', '1', 'p', 'none')$$,
  '42501', null, 'A cannot register a model version');

select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id) values ('recordings',
    'bbbbbbbb-0000-0000-0000-000000000002/b1000000-0000-0000-0000-000000000002/evil.wav',
    'aaaaaaaa-0000-0000-0000-000000000001')$$,
  '42501', null, 'A cannot upload into B folder');

select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id) values ('recordings',
    'aaaaaaaa-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001/no-row.wav',
    'aaaaaaaa-0000-0000-0000-000000000001')$$,
  '42501', null, 'A cannot upload a file without a matching recording row');

-- A's own happy path works
select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner_id) values ('recordings',
    'aaaaaaaa-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001/a2000000-0000-0000-0000-000000000001.wav',
    'aaaaaaaa-0000-0000-0000-000000000001')$$,
  'A can upload the file for own recording');

update storage.objects set name = 'aaaaaaaa-0000-0000-0000-000000000001/renamed.wav'
  where bucket_id = 'recordings' and name like 'aaaaaaaa-0000-0000-0000-000000000001/%';
select is(
  (select name from storage.objects where bucket_id = 'recordings'),
  'aaaaaaaa-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001/a2000000-0000-0000-0000-000000000001.wav',
  'A cannot modify a stored recording (no update policy)');

select lives_ok(
  $$update public.machines set name = 'A pump v2' where id = 'a1000000-0000-0000-0000-000000000001'$$,
  'A can edit own machine');

select is((select name from public.machines where id = 'a1000000-0000-0000-0000-000000000001'),
  'A pump v2', 'A edit was applied');

-- machine_type
select is((select machine_type::text from public.machines where id = 'a1000000-0000-0000-0000-000000000001'),
  'other', 'machine_type defaults to other');

select lives_ok(
  $$update public.machines set machine_type = 'bearing' where id = 'a1000000-0000-0000-0000-000000000001'$$,
  'A can set own machine type');

select is((select machine_type::text from public.machines where id = 'a1000000-0000-0000-0000-000000000001'),
  'bearing', 'A machine type change was applied');

select throws_ok(
  $$update public.machines set machine_type = 'pump' where id = 'a1000000-0000-0000-0000-000000000001'$$,
  '22P02', null, 'machine_type only accepts bearing, gearbox or other');

select lives_ok(
  $$insert into public.machines (name, machine_type) values ('A gearbox', 'gearbox')$$,
  'A can create a typed machine');

select lives_ok(
  $$insert into public.recordings (id, machine_id, kind, storage_path) values (
    'a4000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', 'baseline',
    'aaaaaaaa-0000-0000-0000-000000000001/a1000000-0000-0000-0000-000000000001/a4000000-0000-0000-0000-000000000004.wav')$$,
  'A can add a baseline recording (owner_id defaults to auth.uid())');

select lives_ok(
  $$insert into public.context_readings (recording_id, name, value, unit)
    values ('a4000000-0000-0000-0000-000000000004', 'voltage', 1.3, 'V')$$,
  'A can add context to own recording');

select lives_ok(
  $$delete from public.recordings where id = 'a4000000-0000-0000-0000-000000000004'$$,
  'A can delete own recording');

select is(
  (select count(*)::int from public.context_readings where recording_id = 'a4000000-0000-0000-0000-000000000004'),
  0, 'deleting a recording cascades to its context');

select throws_ok(
  $$insert into public.recordings (id, machine_id, storage_path) values (
    'a5000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001', 'somewhere/else.wav')$$,
  '23514', null, 'storage path must follow the owner/machine/recording layout');

select is((select count(*)::int from public.model_versions where id = 'c0000000-0000-0000-0000-000000000001'), 1,
  'authenticated users can read model catalog');

-- ---------------------------------------------------------------------------
-- As user B: nothing of B's was changed by A, and B cannot see A
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', true);

select is((select name from public.machines), 'B gearbox', 'B machine name unchanged');
select is((select machine_type::text from public.machines), 'other', 'B machine type unchanged by A');
select is((select count(*)::int from public.machines), 1, 'B machine not deleted and A machine hidden');
select is((select count(*)::int from public.recordings), 1, 'B recording not deleted and A recordings hidden');
select is((select value from public.context_readings), 230::double precision, 'B context unchanged');
select is((select display_name from public.profiles), null, 'B profile unchanged');
select is((select count(*)::int from public.predictions), 1, 'B sees own prediction');
select is((select threshold from public.machine_thresholds), 3.5::double precision, 'B sees own threshold, unchanged');
select is((select embedding from public.baseline_embeddings), array[0.6, 0.8]::real[], 'B sees own embedding, unchanged');
select is((select count(*)::int from storage.objects where bucket_id = 'recordings'), 1,
  'B file not deleted and A file hidden');

select throws_ok(
  $$delete from public.predictions$$, '42501', null, 'B cannot delete predictions');

-- B deleting own machine cascades to everything under it
delete from public.machines where id = 'b1000000-0000-0000-0000-000000000002';
reset role;
select is((select count(*)::int from public.recordings where owner_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0, 'deleting a machine cascades to its recordings');
select is((select count(*)::int from public.predictions where owner_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0, 'deleting a machine cascades to its predictions');
select is((select count(*)::int from public.machine_thresholds where owner_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0, 'deleting a machine cascades to its thresholds');
select is((select count(*)::int from public.baseline_embeddings where owner_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0, 'deleting a machine cascades through recordings to their embeddings');


-- ---------------------------------------------------------------------------
-- Caps, machine alerts and account deletion (user C, own fixtures)
-- ---------------------------------------------------------------------------
reset role;
insert into auth.users (id, email, aud, role)
values ('cccccccc-0000-0000-0000-000000000003', 'rls-c@example.test', 'authenticated', 'authenticated');
insert into public.machines (id, owner_id, name, machine_type)
values ('c1000000-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000003', 'C gearbox', 'gearbox');

-- 50 baselines (the maximum) and 450 analysis recordings: 500 in total.
insert into public.recordings (id, machine_id, owner_id, kind, storage_path)
select id, 'c1000000-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000003', kind::public.recording_kind,
  'cccccccc-0000-0000-0000-000000000003/c1000000-0000-0000-0000-000000000003/' || id || '.wav'
from (
  select gen_random_uuid() as id, case when n <= 50 then 'baseline' else 'analysis' end as kind
  from generate_series(1, 500) as n
) as s;

select is((select count(*)::int from public.recordings where owner_id = 'cccccccc-0000-0000-0000-000000000003'),
  500, 'caps allow exactly 500 recordings and 50 baselines');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}', true);

select throws_ok(
  $$insert into public.recordings (id, machine_id, kind, storage_path) values (
    'c2000000-0000-0000-0000-000000000501', 'c1000000-0000-0000-0000-000000000003', 'analysis',
    'cccccccc-0000-0000-0000-000000000003/c1000000-0000-0000-0000-000000000003/c2000000-0000-0000-0000-000000000501.wav')$$,
  'P0001', 'recording_limit_reached', 'a 501st recording is refused');

select throws_ok(
  $$update public.recordings set kind = 'baseline'
    where id = (select id from public.recordings where kind = 'analysis' limit 1)$$,
  'P0001', 'baseline_limit_reached', 'a 51st baseline (by changing kind) is refused');

reset role;
delete from public.recordings
where id in (select id from public.recordings
             where owner_id = 'cccccccc-0000-0000-0000-000000000003' and kind = 'analysis' limit 10);
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}', true);

select throws_ok(
  $$insert into public.recordings (id, machine_id, kind, storage_path) values (
    'c2000000-0000-0000-0000-000000000502', 'c1000000-0000-0000-0000-000000000003', 'baseline',
    'cccccccc-0000-0000-0000-000000000003/c1000000-0000-0000-0000-000000000003/c2000000-0000-0000-0000-000000000502.wav')$$,
  'P0001', 'baseline_limit_reached', 'a 51st baseline insert is refused even below the recording cap');

select lives_ok(
  $$insert into public.recordings (id, machine_id, kind, storage_path) values (
    'c2000000-0000-0000-0000-000000000503', 'c1000000-0000-0000-0000-000000000003', 'analysis',
    'cccccccc-0000-0000-0000-000000000003/c1000000-0000-0000-0000-000000000003/c2000000-0000-0000-0000-000000000503.wav')$$,
  'an analysis recording below both caps is accepted');

-- machine alert: decisions on three analysis recordings, oldest first
reset role;
insert into public.recordings (id, machine_id, owner_id, kind, storage_path)
select id, 'c1000000-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000003', 'analysis',
  'cccccccc-0000-0000-0000-000000000003/c1000000-0000-0000-0000-000000000003/' || id || '.wav'
from (values ('c3000000-0000-0000-0000-000000000001'::uuid), ('c3000000-0000-0000-0000-000000000002'::uuid),
             ('c3000000-0000-0000-0000-000000000003'::uuid), ('c3000000-0000-0000-0000-000000000004'::uuid)) as v(id);
insert into public.predictions (recording_id, owner_id, model_version_id, score, threshold, decision, created_at)
values
  ('c3000000-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', 1, 0, 'above_threshold', now() - interval '4 hours'),
  ('c3000000-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', 1, 0, 'below_threshold', now() - interval '3 hours'),
  ('c3000000-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', 1, 0, 'above_threshold', now() - interval '2 hours');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}', true);
select results_eq(
  $$select analyses_considered, above_threshold_count, alert from public.machine_alerts
    where machine_id = 'c1000000-0000-0000-0000-000000000003'$$,
  $$values (3, 2, true)$$,
  '2 of the last 3 above threshold raises the machine alert');

reset role;
insert into public.predictions (recording_id, owner_id, model_version_id, score, threshold, decision, created_at)
values ('c3000000-0000-0000-0000-000000000004', 'cccccccc-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', 1, 0, 'below_threshold', now() - interval '1 hour');
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}', true);
select results_eq(
  $$select above_threshold_count, alert from public.machine_alerts where machine_id = 'c1000000-0000-0000-0000-000000000003'$$,
  $$values (1, false)$$,
  'only the last 3 count: one above threshold among them is no alert');

reset role;
insert into public.predictions (recording_id, owner_id, model_version_id, score, threshold, decision, created_at)
values ('c3000000-0000-0000-0000-000000000004', 'cccccccc-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', 1, 0, 'above_threshold', now());
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}', true);
select results_eq(
  $$select analyses_considered, above_threshold_count, alert from public.machine_alerts
    where machine_id = 'c1000000-0000-0000-0000-000000000003'$$,
  $$values (3, 2, true)$$,
  're-analysing a recording replaces its decision instead of counting twice');

select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.machine_alerts where machine_id = 'c1000000-0000-0000-0000-000000000003'),
  0, 'another user cannot see the machine alert');

set local role anon;
select throws_ok('select * from public.machine_alerts', '42501', null, 'anon cannot read machine alerts');

-- account deletion: removing the auth user removes every row of theirs
reset role;
delete from auth.users where id = 'cccccccc-0000-0000-0000-000000000003';
select is(
  (select count(*)::int from public.profiles where id = 'cccccccc-0000-0000-0000-000000000003')
  + (select count(*)::int from public.machines where owner_id = 'cccccccc-0000-0000-0000-000000000003')
  + (select count(*)::int from public.recordings where owner_id = 'cccccccc-0000-0000-0000-000000000003')
  + (select count(*)::int from public.predictions where owner_id = 'cccccccc-0000-0000-0000-000000000003'),
  0, 'deleting the auth user cascades through profile, machines, recordings and predictions');

select * from finish();
rollback;
