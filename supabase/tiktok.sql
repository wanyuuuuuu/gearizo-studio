-- Gearizo: TikTok accounts for sending videos to TikTok drafts. Safe to run again.
-- Both tables have row-level security on and no policies, so no app user can read them;
-- only the server (secret key) can. The app sees names and status through the notify function.

-- 1. The TikTok developer app (client key and secret) and the sign-in in progress.
create table if not exists public.social_tiktok_app (
  id int primary key default 1 check (id = 1),
  client_key text,
  client_secret text,
  oauth_state text,
  oauth_slot text,
  oauth_user uuid,
  oauth_return text,
  oauth_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
alter table public.social_tiktok_app enable row level security;
insert into public.social_tiktok_app (id) values (1) on conflict (id) do nothing;

-- 2. One row per Gearizo TikTok account: tt_gz = TT Main (@gearizo), tt_my = TT CN (@gearizomy),
--    tt_sg = TT SG (@gearizo.sg). Access tokens last a day and are refreshed by the server.
create table if not exists public.social_tiktok (
  slot text primary key check (slot in ('tt_gz', 'tt_my', 'tt_sg')),
  open_id text not null,
  display_name text,
  avatar_url text,
  scope text,
  access_token text,
  access_expires_at timestamptz,
  refresh_token text,
  refresh_expires_at timestamptz,
  connected_by uuid,
  connected_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);
alter table public.social_tiktok enable row level security;
