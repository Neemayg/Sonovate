-- ADR-012: recordings of 10 to 60 s. The inference service scores each 10 s
-- window and judges the recording on the mean of the window log scores
-- (log_score), against a threshold for that number of windows (EXP-026).
--
-- window_count: how many 10 s windows were analysed (1 to 6).
-- window_log_scores: each window's log score, in order. Existing rows were
-- single 10 s recordings, so they get window_count 1 and their own log_score.

alter table public.predictions
  add column window_count smallint not null default 1
    check (window_count between 1 and 6),
  add column window_log_scores double precision[];

update public.predictions
set window_log_scores = array[log_score]
where window_log_scores is null and log_score is not null;

alter table public.predictions
  add constraint predictions_window_log_scores_match
    check (window_log_scores is null or cardinality(window_log_scores) = window_count);

comment on column public.predictions.window_count is
  'Number of 10 s windows analysed (ADR-012). The decision uses the mean of their log scores.';
comment on column public.predictions.window_log_scores is
  'Log score of each 10 s window, in order. Uncalibrated anomaly scores, not probabilities.';
