-- LOCAL DEVELOPMENT ONLY. Test credentials for the local Supabase stack.
-- Never reuse these anywhere else; there is no cloud project.
--
--   email:    tech@sonovate.test
--   password: local-test-password-1
--
-- No machines, recordings or model versions are seeded: the app must show
-- its empty and "no validated model" states honestly.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-4111-8111-111111111111',
  'authenticated', 'authenticated', 'tech@sonovate.test',
  extensions.crypt('local-test-password-1', extensions.gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(),
  '', '', '', ''
);

insert into auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
) values (
  gen_random_uuid(),
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  'email',
  '{"sub":"11111111-1111-4111-8111-111111111111","email":"tech@sonovate.test","email_verified":true}',
  now(), now(), now()
);

-- Model versions for the two research-prototype bundles (ADR-007). The ids
-- and bundle.json sha256 values must match ALLOWED_BUNDLES in
-- backend/app/bundle.py; limitations are copied from each bundle.json.
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
);
