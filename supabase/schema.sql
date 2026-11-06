-- Gearizo content studio: database setup
-- Paste all of this into Supabase → SQL Editor → New query → Run. Safe to run again.

-- 1. Team allow-list: only these emails can see or change anything.
create table if not exists public.members (
  email text primary key,
  added_at timestamptz not null default now()
);
alter table public.members enable row level security;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members m
    where lower(m.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

drop policy if exists "members see the team" on public.members;
create policy "members see the team" on public.members for select using (public.is_member());

-- 2. All studio records (items, versions, feedback, tasks, inbox, team, focus, profiles)
--    live in one table of JSON documents, grouped by collection.
create table if not exists public.docs (
  collection text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (collection, id)
);
create index if not exists docs_collection_idx on public.docs (collection);
alter table public.docs enable row level security;
alter table public.docs replica identity full;

-- Shared collections: any team member. "data/users/<id>" collections: only that person.
create or replace function public.can_use_collection(c text) returns boolean
language sql stable as $$
  select public.is_member()
     and (c not like 'data/users/%' or c = 'data/users/' || auth.uid()::text);
$$;

drop policy if exists "team reads docs" on public.docs;
drop policy if exists "team adds docs" on public.docs;
drop policy if exists "team edits docs" on public.docs;
drop policy if exists "team deletes docs" on public.docs;
create policy "team reads docs"   on public.docs for select using (public.can_use_collection(collection));
create policy "team adds docs"    on public.docs for insert with check (public.can_use_collection(collection));
create policy "team edits docs"   on public.docs for update using (public.can_use_collection(collection)) with check (public.can_use_collection(collection));
create policy "team deletes docs" on public.docs for delete using (public.can_use_collection(collection));

-- Who changed a record and when (used to skip your own actions in push alerts)
create or replace function public.docs_stamp() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists docs_stamp on public.docs;
create trigger docs_stamp before insert or update on public.docs
  for each row execute function public.docs_stamp();

-- Change some fields of a record without overwriting the rest
create or replace function public.doc_merge(c text, i text, patch jsonb) returns void
language sql security invoker as $$
  update public.docs set data = data || patch where collection = c and id = i;
$$;

-- Live updates in the app
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- 3. Phone / computer push subscriptions (each person manages their own)
create table if not exists public.push_subs (
  endpoint text primary key,
  user_id uuid not null default auth.uid(),
  sub jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.push_subs enable row level security;
drop policy if exists "own push subscriptions" on public.push_subs;
create policy "own push subscriptions" on public.push_subs for all
  using (user_id = auth.uid() and public.is_member())
  with check (user_id = auth.uid() and public.is_member());

-- 4. Private file storage for preview videos, screenshots and attachments
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "team reads media" on storage.objects;
drop policy if exists "team uploads media" on storage.objects;
drop policy if exists "team deletes media" on storage.objects;
create policy "team reads media"   on storage.objects for select using (bucket_id = 'media' and public.is_member());
create policy "team uploads media" on storage.objects for insert with check (bucket_id = 'media' and public.is_member());
create policy "team deletes media" on storage.objects for delete using (bucket_id = 'media' and public.is_member());

-- 5. Who is on the team: add each person's email (run in the SQL Editor, not stored here):
-- insert into public.members (email) values ('name@example.com') on conflict do nothing;
