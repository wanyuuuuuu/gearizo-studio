-- Gearizo auto-posting to Facebook and Instagram. Safe to run again.

-- 1. The Meta connection (app keys and posting tokens). Row-level security is on with no
--    policies, so no app user can read it; only the server (secret key) can.
create table if not exists public.social_meta (
  id int primary key default 1 check (id = 1),
  app_id text,
  app_secret text,
  page_id text,
  page_name text,
  ig_id text,
  ig_username text,
  page_token text,
  user_token text,
  user_token_expires timestamptz,
  connected_by uuid,
  connected_at timestamptz,
  last_error text,
  oauth_state text,
  oauth_user uuid,
  oauth_return text,
  oauth_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.social_meta enable row level security;
insert into public.social_meta (id) values (1) on conflict (id) do nothing;

-- 2. Who may see / change each record (adds "postjobs": the auto-post status of each video)
create or replace function public.can_see_doc(c text, d jsonb) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r text := public.my_role();
begin
  if r is null then return false; end if;
  if c like 'data/users/%' then return c = 'data/users/' || auth.uid()::text; end if;
  if r = 'content' then return true; end if;                      -- the hub sees everything
  if c = 'profiles' then return true; end if;                     -- names
  if c = 'items' then return r in ('marketing', 'ecomm') and coalesce(nullif(d ->> 'team', ''), 'marketing') = r; end if;
  if c in ('versions', 'feedback', 'postjobs') then return r in ('marketing', 'ecomm') and public.item_team(d ->> 'item') = r; end if;
  if c = 'tasks' then return d ->> 'for' = r or d ->> 'by' = auth.uid()::text; end if;
  if c = 'focus' then return r in ('marketing', 'ecomm'); end if;
  if c = 'shoots' then return r = 'hr' and coalesce(d -> 'talent', '[]'::jsonb) ? auth.uid()::text; end if;
  if c in ('availability', 'busy') then return r = 'hr' and d ->> 'user' = auth.uid()::text; end if;
  return false;                                                   -- inbox and anything else: hub only
end $$;
