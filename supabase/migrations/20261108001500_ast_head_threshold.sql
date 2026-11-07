-- ADR-011: threshold spread 1.5 (was 2.0) for the ADR-010 model; bundle
-- sonovate-ast-head 0.3.1, weights identical to 0.3.0.
--
-- Reference data only. The id and bundle.json sha256 must match
-- AST_HEAD_BUNDLE in backend/app/bundle.py; limitations are copied verbatim
-- from the bundle's bundle.json. The 0.3.0 row stays so older predictions and
-- thresholds still resolve. Thresholds are stored per model version, so every
-- machine gets a threshold at the new spread on its next analysis.

insert into public.model_versions (
  id, name, version, preprocessing_version, evidence_ref, machine_type, bundle_sha256, limitations
) values (
  '5e1d0000-0000-4000-8000-00000000b005', 'sonovate-ast-head', '0.3.1', 'ast-l4-freqpool+head@sonovate-ast-head-0.3.1',
  'EXP-013, EXP-014, EXP-016 (model, ADR-010); EXP-017, EXP-020 (threshold spread 1.5 confirmed on fresh gearbox data, ADR-011); research prototype per ADR-007; bundle.json sha256 675e414533e29626d2ae8b1c76ae5a4bddf790aff89a5024282bd6477e14c88a',
  null, '675e414533e29626d2ae8b1c76ae5a4bddf790aff89a5024282bd6477e14c88a',
  array[
    'Validated only on lab bearings and gearboxes with induced faults (MIMII DG, DCASE 2022, MIMII DUE); other machines are out of scope.',
    'With 10 baseline recordings it ranked anomalies at AUC 0.79 on held-out DCASE 2022 data (EXP-016), but only 0.66 on a fresh gearbox recording setup, or 0.69 with 30 baselines (EXP-020).',
    'At this threshold about 9% of normal recordings were flagged on fresh gearbox data, and about 16% of anomalies were caught there (EXP-020); most anomalies are missed. Recording 30 baselines catches more (EXP-017).',
    'Gains on bearing are small and uneven, and this threshold was confirmed on fresh data for gearbox only (EXP-016, EXP-020).',
    'Below threshold does not mean healthy.'
  ]
)
on conflict (id) do nothing;
