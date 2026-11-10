-- ADR-010: product model switches to AST layer-4 frequency pooling with a
-- condition-classifier head (bundle sonovate-ast-head 0.3.0).
--
-- Reference data only. The id and bundle.json sha256 must match
-- AST_HEAD_BUNDLE in backend/app/bundle.py; limitations are copied verbatim
-- from the bundle's bundle.json. The ADR-008 row (sonovate-ast-knn 0.2.0) is
-- kept so older predictions, thresholds and baseline embeddings still resolve.
-- Existing machines need no migration: the backend embeds their baselines
-- with the new model version on the next analysis.

insert into public.model_versions (
  id, name, version, preprocessing_version, evidence_ref, machine_type, bundle_sha256, limitations
) values (
  '5e1d0000-0000-4000-8000-00000000b004', 'sonovate-ast-head', '0.3.0', 'ast-l4-freqpool+head@sonovate-ast-head-0.3.0',
  'EXP-013 (layer-4 frequency pooling), EXP-014 (condition-classifier head), EXP-016 (held-out check vs ADR-008 model); research prototype per ADR-007 and ADR-010; bundle.json sha256 5957de2ffbe5d10ac3e2352573d332ec4b6ed907fcdb7d5780370b30765e3779',
  null, '5957de2ffbe5d10ac3e2352573d332ec4b6ed907fcdb7d5780370b30765e3779',
  array[
    'Validated only on MIMII DG / DCASE 2022 lab bearings and gearboxes with induced faults; other machines are out of scope.',
    'On held-out evaluation data, with 10 baseline recordings it caught about 27% of anomalies with about 4% false alarms (EXP-016); most anomalies are still missed.',
    'Gains over the previous model are large on gearbox but small and uneven on bearing (EXP-016).',
    'Below threshold does not mean healthy.'
  ]
)
on conflict (id) do nothing;
