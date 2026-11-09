-- ADR-013: bundle sonovate-ast-head 0.4.0. Same weights as 0.3.0 / 0.3.1;
-- bearing machines are scored with the head + frozen-feature fusion
-- (EXP-028, EXP-029), gearbox unchanged.
--
-- Reference data only. The id and bundle.json sha256 must match
-- AST_HEAD_BUNDLE in backend/app/bundle.py; limitations are copied verbatim
-- from the bundle's bundle.json. Older rows stay so older predictions resolve.
-- Thresholds and baseline embeddings are stored per model version, so every
-- machine is re-embedded and gets a new threshold on its next analysis.

insert into public.model_versions (
  id, name, version, preprocessing_version, evidence_ref, machine_type, bundle_sha256, limitations
) values (
  '5e1d0000-0000-4000-8000-00000000b006', 'sonovate-ast-head', '0.4.0', 'ast-l4-freqpool+head@sonovate-ast-head-0.4.0',
  'EXP-013, EXP-014, EXP-016 (model, ADR-010); EXP-017, EXP-020 (spread 1.5, ADR-011); EXP-022, EXP-026 (60 s rule, ADR-012); EXP-027, EXP-028, EXP-029 (bearing fusion, ADR-013); research prototype per ADR-007; bundle.json sha256 7cea99e786dc2e3d0899f8718ed706d760d2d17c1e5e714e0971038d566b9c7c',
  null, '7cea99e786dc2e3d0899f8718ed706d760d2d17c1e5e714e0971038d566b9c7c',
  array[
    'Validated only on lab bearings and gearboxes with induced faults (MIMII DG, DCASE 2022, MIMII DUE); other machines are out of scope.',
    'Gearbox: on a fresh recording setup (MIMII DUE evaluation data) with 10 baselines it ranked anomalies at AUC 0.67 and caught about 26% of anomalies in single 10 s clips at about 9% false alarms; 60 s recordings caught about 42% (EXP-022, EXP-026).',
    'Bearing: scored with a fusion of two embeddings, AUC 0.70 vs 0.67 before on held-out DCASE 2022 bearing data; 60 s recordings caught about 43% at about 9% false alarms (EXP-028, EXP-029). That bearing set had been used before, and no untouched bearing test exists.',
    'Most anomalies in a single 10 s clip are missed. Recording 60 s per check and 30 baselines catches more (EXP-017, EXP-026).',
    'Below threshold does not mean healthy.'
  ]
)
on conflict (id) do nothing;

-- Bearing fusion embeddings hold 128 + 9216 = 9344 values.
alter table public.baseline_embeddings
  drop constraint if exists baseline_embeddings_embedding_check;
alter table public.baseline_embeddings
  add constraint baseline_embeddings_embedding_check
    check (cardinality(embedding) between 1 and 9344 and array_ndims(embedding) = 1);
