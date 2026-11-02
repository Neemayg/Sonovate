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
