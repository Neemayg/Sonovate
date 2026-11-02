-- Stored baseline embeddings for the AST model (ADR-008).
--
-- With AST, a recording's score is its cosine distance to the nearest of the
-- machine's baseline embeddings, and the threshold comes from the baselines'
-- leave-one-out distances. Each baseline is embedded once per model version
-- and kept here, so analyses do not re-run the transformer on every baseline.
--
-- Users can read their own rows but never write them: only the inference
-- service (service role) stores embeddings. Rows go with their recording.

create table public.baseline_embeddings (
  recording_id uuid not null,
  owner_id uuid not null,
  model_version_id uuid not null references public.model_versions (id) on delete restrict,
  -- L2-normalized embedding as stored by the model (AST: 768 values).
  embedding real[] not null
    check (cardinality(embedding) between 1 and 4096 and array_ndims(embedding) = 1),
  created_at timestamptz not null default now(),
  primary key (recording_id, model_version_id),
  foreign key (recording_id, owner_id)
    references public.recordings (id, owner_id) on delete cascade
);

create index baseline_embeddings_owner_id_idx on public.baseline_embeddings (owner_id);
create index baseline_embeddings_recording_id_owner_id_idx on public.baseline_embeddings (recording_id, owner_id);
create index baseline_embeddings_model_version_id_idx on public.baseline_embeddings (model_version_id);

alter table public.baseline_embeddings enable row level security;

create policy baseline_embeddings_select_own on public.baseline_embeddings
  for select to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on public.baseline_embeddings from anon, authenticated;
grant select on public.baseline_embeddings to authenticated;
grant all on public.baseline_embeddings to service_role;

-- One model version can now serve more than one machine type (AST covers
-- bearing and gearbox), so machine_type may stay null for such rows.
comment on column public.model_versions.machine_type is
  'Machine type the model serves; null when it serves several (see its bundle).';
