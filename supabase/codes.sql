-- Gearizo: content codes (GZ001, GZ002 …) unique across all teams. Safe to run again.
-- Each team only sees its own items, so the app can't know which codes other teams used;
-- the database checks and, if needed, picks the next free code. A code never changes once
-- given, because files on the NAS are named with it.
create or replace function public.items_code() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if new.collection <> 'items' then return new; end if;
  -- an item that already has a code keeps it
  if tg_op = 'UPDATE' and coalesce(old.data ->> 'code', '') ~ '^GZ[0-9]{3,5}$' then
    if new.data ->> 'code' is distinct from old.data ->> 'code' then
      new.data := jsonb_set(new.data, '{code}', to_jsonb(old.data ->> 'code'));
    end if;
    return new;
  end if;
  -- keep the code the app chose when no other item has it
  if coalesce(new.data ->> 'code', '') ~ '^GZ[0-9]{3,5}$' and not exists (
       select 1 from public.docs where collection = 'items' and id <> new.id and data ->> 'code' = new.data ->> 'code') then
    return new;
  end if;
  -- otherwise the next free number
  perform pg_advisory_xact_lock(hashtext('gearizo-item-code'));
  select coalesce(max(substring(data ->> 'code' from 3)::int), 0) + 1 into n
    from public.docs where collection = 'items' and id <> new.id and data ->> 'code' ~ '^GZ[0-9]{3,5}$';
  new.data := jsonb_set(coalesce(new.data, '{}'::jsonb), '{code}', to_jsonb('GZ' || lpad(n::text, 3, '0')));
  return new;
end $$;

drop trigger if exists docs_code on public.docs;
create trigger docs_code before insert or update on public.docs
  for each row execute function public.items_code();
