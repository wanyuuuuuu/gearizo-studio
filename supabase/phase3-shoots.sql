-- Gearizo Phase 3: shoot scheduling, HR availability, Google Calendar busy times. Safe to run again.

-- 1. Who may see / change each record (adds shoots, availability and busy times for HR)
create or replace function public.can_see_doc(c text, d jsonb) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r text := public.my_role();
begin
  if r is null then return false; end if;
  if c like 'data/users/%' then return c = 'data/users/' || auth.uid()::text; end if;
  if r = 'content' then return true; end if;                      -- the hub sees everything
  if c = 'profiles' then return true; end if;                     -- names
  if c = 'items' then return r in ('marketing', 'ecomm') and coalesce(nullif(d ->> 'team', ''), 'marketing') = r; end if;
  if c in ('versions', 'feedback') then return r in ('marketing', 'ecomm') and public.item_team(d ->> 'item') = r; end if;
  if c = 'tasks' then return d ->> 'for' = r or d ->> 'by' = auth.uid()::text; end if;
  if c = 'focus' then return r in ('marketing', 'ecomm'); end if;
  if c = 'shoots' then return r = 'hr' and coalesce(d -> 'talent', '[]'::jsonb) ? auth.uid()::text; end if;
  if c in ('availability', 'busy') then return r = 'hr' and d ->> 'user' = auth.uid()::text; end if;
  return false;                                                   -- inbox and anything else: hub only
end $$;

-- 2. Private Google Calendar links: only the person themself (the server reads them to find busy times)
create table if not exists public.calendar_links (
  user_id uuid primary key default auth.uid(),
  ics_url text,
  feed_token text not null default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  last_sync timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
alter table public.calendar_links enable row level security;
drop policy if exists "own calendar link" on public.calendar_links;
create policy "own calendar link" on public.calendar_links for all
  using (user_id = auth.uid() and public.is_member())
  with check (user_id = auth.uid() and public.is_member());
