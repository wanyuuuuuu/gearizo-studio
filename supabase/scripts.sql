-- Gearizo: let marketing / e-commerce see and approve the Script & storyboard of their own videos. Safe to run again.
-- (Only this rule changes: 'scripts' joins versions/feedback/postjobs. Content already sees everything.)
create or replace function public.can_see_doc(c text, d jsonb) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare r text := public.my_role();
begin
  if r is null then return false; end if;
  if c like 'data/users/%' then return c = 'data/users/' || auth.uid()::text; end if;
  if r = 'content' then return true; end if;                      -- the hub sees everything
  if c = 'profiles' then return true; end if;                     -- names
  if c = 'items' then return r in ('marketing', 'ecomm') and coalesce(nullif(d ->> 'team', ''), 'marketing') = r; end if;
  if c in ('versions', 'feedback', 'postjobs', 'scripts') then return r in ('marketing', 'ecomm') and public.item_team(d ->> 'item') = r; end if;
  if c = 'tasks' then return d ->> 'for' = r or d ->> 'by' = auth.uid()::text; end if;
  if c = 'focus' then return r in ('marketing', 'ecomm'); end if;
  if c = 'shoots' then return r = 'hr' and coalesce(d -> 'talent', '[]'::jsonb) ? auth.uid()::text; end if;
  if c in ('availability', 'busy') then return r = 'hr' and d ->> 'user' = auth.uid()::text; end if;
  return false;                                                   -- inbox and anything else: hub only
end $$;
