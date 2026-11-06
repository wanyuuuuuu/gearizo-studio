-- Gearizo Phase 1: roles set by the owner + who sees what. Safe to run again.
-- Roles: content (the hub, sees everything), marketing, ecomm, hr.

-- 1. A role on every team member, and one owner who manages the team
alter table public.members add column if not exists role text;
alter table public.members add column if not exists is_owner boolean not null default false;
update public.members set role = 'marketing' where role is null;
-- (set the owner here, e.g.)
-- update public.members set role = 'content', is_owner = true where lower(email) = 'owner@example.com';
alter table public.members alter column role set not null;
alter table public.members drop constraint if exists members_role_check;
alter table public.members add constraint members_role_check check (role in ('content', 'marketing', 'ecomm', 'hr'));

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.members where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;
create or replace function public.am_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_owner from public.members where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))), false);
$$;
create or replace function public.my_member() returns table (role text, is_owner boolean)
language sql stable security definer set search_path = public as $$
  select role, is_owner from public.members where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

-- Which team an item belongs to (old items without one belong to Marketing)
create or replace function public.item_team(item_id text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(data ->> 'team', ''), 'marketing') from public.docs where collection = 'items' and id = item_id;
$$;

-- 2. Who may see / change each record
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
  return false;                                                   -- inbox and anything else: hub only
end $$;

drop policy if exists "team reads docs" on public.docs;
drop policy if exists "team adds docs" on public.docs;
drop policy if exists "team edits docs" on public.docs;
drop policy if exists "team deletes docs" on public.docs;
create policy "team reads docs"   on public.docs for select using (public.can_see_doc(collection, data));
create policy "team adds docs"    on public.docs for insert with check (public.can_see_doc(collection, data));
create policy "team edits docs"   on public.docs for update using (public.can_see_doc(collection, data)) with check (public.can_see_doc(collection, data));
create policy "team deletes docs" on public.docs for delete using (public.can_see_doc(collection, data));

-- 3. Only the owner manages the team list
drop policy if exists "members see the team" on public.members;
drop policy if exists "team list for owner and self" on public.members;
drop policy if exists "owner adds members" on public.members;
drop policy if exists "owner edits members" on public.members;
drop policy if exists "owner removes members" on public.members;
create policy "team list for owner and self" on public.members for select
  using (public.am_owner() or lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy "owner adds members"    on public.members for insert with check (public.am_owner());
create policy "owner edits members"   on public.members for update using (public.am_owner()) with check (public.am_owner());
create policy "owner removes members" on public.members for delete using (public.am_owner() and not is_owner);

-- 4. Who is who, for the app (names next to roles) and the push function
create or replace function public.team_roles() returns table (user_id uuid, role text)
language sql stable security definer set search_path = public, auth as $$
  select u.id, m.role
  from public.members m join auth.users u on lower(u.email) = lower(m.email)
  where public.is_member() or coalesce(auth.role(), '') = 'service_role';
$$;

-- 5. Existing items belong to Marketing
update public.docs set data = data || '{"team": "marketing"}'::jsonb
where collection = 'items' and coalesce(data ->> 'team', '') = '';
