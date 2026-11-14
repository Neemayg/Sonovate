-- Upload integrity: a recording counts only once its audio file is stored.
--
-- The browser writes a recording in three steps (row, file, context). If the
-- tab closes or the network drops after the row is written, a row without an
-- audio file used to remain. It counted toward the baseline minimum and made
-- every later analysis of that machine fail (baseline_invalid).
--
-- Now:
--   * recordings.upload_completed_at is set by the database when the audio
--     file is stored (trigger on storage.objects) and cleared if the file is
--     deleted. Users can read it but never write it.
--   * The app and the inference service use only completed recordings.
--   * Rows still incomplete after an hour, with no stored file, are deleted
--     every 15 minutes (pg_cron). Nothing with a stored file is ever deleted.
--
-- The model, thresholds and alert rule are unchanged.

alter table public.recordings
  add column upload_completed_at timestamptz;

comment on column public.recordings.upload_completed_at is
  'When the audio file was stored (set by trigger on storage.objects). Null while an upload is in progress or after it was abandoned; such rows are ignored and cleaned up.';

-- Existing recordings: complete if their file is stored.
update public.recordings r
set upload_completed_at = coalesce(o.created_at, r.created_at)
from storage.objects o
where o.bucket_id = 'recordings'
  and o.name = r.storage_path;

-- Readable (the app filters on it), never writable by users. The table-wide
-- INSERT grant from app_foundation would cover new columns, so it becomes a
-- column list: exactly the columns users could insert before, nothing new.
grant select (upload_completed_at) on public.recordings to authenticated;
revoke insert on public.recordings from authenticated;
grant insert (
  id, machine_id, owner_id, kind, storage_path, original_filename, size_bytes,
  duration_seconds, sample_rate_hz, channels, recorded_at, created_at
) on public.recordings to authenticated;

-- Partial index for the cleanup scan.
create index recordings_incomplete_idx
  on public.recordings (created_at)
  where upload_completed_at is null;

-- --- triggers on the audio files ------------------------------------------------

create or replace function private.mark_recording_uploaded()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.bucket_id = 'recordings' then
    update public.recordings
    set upload_completed_at = now()
    where storage_path = new.name
      and upload_completed_at is null;
  end if;
  return new;
end;
$$;

create or replace function private.mark_recording_file_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.bucket_id = 'recordings' then
    update public.recordings
    set upload_completed_at = null
    where storage_path = old.name;
  end if;
  return old;
end;
$$;

revoke execute on function private.mark_recording_uploaded() from public, anon, authenticated;
revoke execute on function private.mark_recording_file_removed() from public, anon, authenticated;

create trigger recordings_file_stored
  after insert on storage.objects
  for each row execute function private.mark_recording_uploaded();

create trigger recordings_file_removed
  after delete on storage.objects
  for each row execute function private.mark_recording_file_removed();

-- --- cleanup of abandoned uploads ------------------------------------------------

-- Deletes recordings whose upload never completed: no completion time, older
-- than the given age, and no stored audio file (checked again here, so a row
-- with a file is never removed). Context rows, results and embeddings cascade.
-- Returns the number of rows deleted.
create or replace function private.discard_incomplete_uploads(older_than interval default interval '1 hour')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted integer;
begin
  delete from public.recordings r
  where r.upload_completed_at is null
    and r.created_at < now() - older_than
    and not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'recordings' and o.name = r.storage_path
    );
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;

revoke execute on function private.discard_incomplete_uploads(interval) from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'sonovate-discard-incomplete-uploads',
  '*/15 * * * *',
  $$select private.discard_incomplete_uploads()$$
);
