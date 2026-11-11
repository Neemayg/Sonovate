-- ADR-014 (EXP-032): optional "High sensitivity" threshold per machine.
--
-- machines.sensitivity: the owner's choice. 'standard' (default) keeps the
-- ADR-011/012/013 spreads; 'high' uses looser spreads that catch more
-- anomalies at about double the false alarms.
-- predictions.sensitivity: the setting the inference service actually used
-- for that result (it falls back to 'standard' for models without validated
-- High spreads). Existing results were all made with the standard setting.

alter table public.machines
  add column sensitivity text not null default 'standard'
    check (sensitivity in ('standard', 'high'));

alter table public.predictions
  add column sensitivity text not null default 'standard'
    check (sensitivity in ('standard', 'high'));

-- Owners may change the setting; RLS on machines still limits rows to the owner.
grant update (sensitivity) on public.machines to authenticated;

comment on column public.machines.sensitivity is
  'Threshold setting (ADR-014): standard (default) or high (more anomalies caught, about double the false alarms).';
comment on column public.predictions.sensitivity is
  'Threshold setting used for this result (ADR-014). Uncalibrated anomaly scores, not probabilities.';
