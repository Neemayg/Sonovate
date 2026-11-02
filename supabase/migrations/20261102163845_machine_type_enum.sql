-- Machine type becomes a fixed category so the inference service can pick a
-- per-type model. Models exist (or will) only for bearing and gearbox,
-- trained on MIMII DG lab recordings; everything else is 'other'.
--
-- The previous free-text values are mapped case-insensitively; anything that
-- is not exactly bearing or gearbox becomes 'other'. RLS policies are on
-- owner_id and are unaffected. The column-level UPDATE grant on
-- machine_type is re-issued explicitly after the type change.

create type public.machine_type as enum ('bearing', 'gearbox', 'other');

alter table public.machines
  drop constraint if exists machines_machine_type_check;

alter table public.machines
  alter column machine_type type public.machine_type
    using (
      case lower(btrim(machine_type))
        when 'bearing' then 'bearing'
        when 'gearbox' then 'gearbox'
        else 'other'
      end
    )::public.machine_type,
  alter column machine_type set default 'other',
  alter column machine_type set not null;

grant update (machine_type) on public.machines to authenticated;
