-- Machine-alert episodes and the email preference (migration alert_email).
-- Run with: npx supabase@2.122.0 test db
begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres). Prediction times are explicit because every row in
-- one transaction would otherwise share now().
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role)
values
  ('aaaaaaaa-1111-0000-0000-000000000001', 'alert-a@example.test', 'authenticated', 'authenticated'),
  ('bbbbbbbb-1111-0000-0000-000000000002', 'alert-b@example.test', 'authenticated', 'authenticated');

insert into public.machines (id, owner_id, name)
values ('a1111111-0000-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 'A gearbox');

insert into public.model_versions (id, name, version, preprocessing_version, evidence_ref)
values ('c1111111-0000-0000-0000-000000000001', 'alert-test-model', '0', 'p0', 'alert test fixture');

insert into public.recordings (id, machine_id, owner_id, kind, storage_path)
select ('a2111111-0000-0000-0000-00000000000' || n)::uuid, 'a1111111-0000-0000-0000-000000000001',
       'aaaaaaaa-1111-0000-0000-000000000001', 'analysis',
       'aaaaaaaa-1111-0000-0000-000000000001/a1111111-0000-0000-0000-000000000001/a2111111-0000-0000-0000-00000000000' || n || '.wav'
from generate_series(1, 6) n;

create function pg_temp.predict(n int, above boolean) returns uuid language sql as $$
  insert into public.predictions (recording_id, owner_id, model_version_id, score, log_score, threshold, decision, created_at)
  values (('a2111111-0000-0000-0000-00000000000' || n)::uuid, 'aaaaaaaa-1111-0000-0000-000000000001',
          'c1111111-0000-0000-0000-000000000001',
          case when above then exp(1.0) else exp(-1.0) end, case when above then 1.0 else -1.0 end, 0.0,
          case when above then 'above_threshold' else 'below_threshold' end,
          now() + make_interval(secs => n))
  returning id;
$$;

create function pg_temp.sync(p uuid) returns uuid language sql as $$
  select public.sync_machine_alert('a1111111-0000-0000-0000-000000000001', p);
$$;

create function pg_temp.open_count() returns int language sql as $$
  select count(*)::int from public.machine_alert_episodes
  where machine_id = 'a1111111-0000-0000-0000-000000000001' and ended_at is null;
$$;

-- ---------------------------------------------------------------------------
-- Episode lifecycle (ADR-009 rule read from machine_alerts, unchanged)
-- ---------------------------------------------------------------------------
select is(pg_temp.sync(pg_temp.predict(1, true)), null, '1 of 1 above: no alert, no episode');
select is(pg_temp.open_count(), 0, 'no open episode after one unusual check');

create temp table opened as select pg_temp.predict(2, true) as prediction_id;
create temp table first_episode as select pg_temp.sync((select prediction_id from opened)) as id;
select isnt((select id from first_episode), null, '2 of 2 above: the alert opens an episode');
select is(pg_temp.open_count(), 1, 'exactly one open episode');
select is((select email_status from public.machine_alert_episodes where id = (select id from first_episode)),
          'pending', 'a new episode waits for its email');
select is((select started_by_prediction_id from public.machine_alert_episodes where id = (select id from first_episode)),
          (select prediction_id from opened), 'the episode records the prediction that started it');

select is(pg_temp.sync((select prediction_id from opened)), null, 'syncing again opens nothing (no duplicate)');
select is(pg_temp.open_count(), 1, 'still one open episode after a repeated sync');

select is(pg_temp.sync(pg_temp.predict(3, false)), null, '2 of last 3 above: alert continues, nothing new');
select is(pg_temp.open_count(), 1, 'the same episode stays open');

select is(pg_temp.sync(pg_temp.predict(4, false)), null, '1 of last 3 above: alert clears');
select is(pg_temp.open_count(), 0, 'the episode is closed when the alert clears');
select isnt((select ended_at from public.machine_alert_episodes where id = (select id from first_episode)),
            null, 'the closed episode has an end time');

select is(pg_temp.sync(pg_temp.predict(5, true)), null, '1 of last 3 above again: no alert');
select isnt(pg_temp.sync(pg_temp.predict(6, true)), null, 'a later alert opens a new episode');
select is((select count(*)::int from public.machine_alert_episodes
           where machine_id = 'a1111111-0000-0000-0000-000000000001'), 2, 'two episodes in total, one per alert');

select results_eq(
  $$select email, alert_emails, machine_name, above_threshold_count from public.alert_email_target(
      (select id from public.machine_alert_episodes where ended_at is null
       and machine_id = 'a1111111-0000-0000-0000-000000000001'))$$,
  $$values ('alert-a@example.test'::text, true, 'A gearbox'::text, 2)$$,
  'the email target is the machine owner, with the preference on by default');

-- ---------------------------------------------------------------------------
-- Access: only the inference service writes; owners read their own
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-1111-0000-0000-000000000001","role":"authenticated"}', true);

select is((select count(*)::int from public.machine_alert_episodes), 2, 'the owner sees their own episodes');
select throws_ok($$select public.sync_machine_alert('a1111111-0000-0000-0000-000000000001', null)$$,
  '42501', null, 'users cannot open or close episodes');
select throws_ok($$select * from public.alert_email_target(gen_random_uuid())$$,
  '42501', null, 'users cannot read email targets');
select throws_ok($$update public.machine_alert_episodes set email_status = 'sent'$$,
  '42501', null, 'users cannot change delivery status');

update public.profiles set alert_emails = false where id = 'aaaaaaaa-1111-0000-0000-000000000001';
select is((select alert_emails from public.profiles where id = 'aaaaaaaa-1111-0000-0000-000000000001'),
  false, 'the owner can turn alert emails off');

select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-1111-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.machine_alert_episodes), 0, 'another user sees none of them');
update public.profiles set alert_emails = true where id = 'aaaaaaaa-1111-0000-0000-000000000001';
reset role;
select is((select alert_emails from public.profiles where id = 'aaaaaaaa-1111-0000-0000-000000000001'),
  false, 'another user cannot change the owner''s preference');

select * from finish();
rollback;
