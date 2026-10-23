create table public.lead_pool (
  id uuid primary key default gen_random_uuid(),
  external_key text not null unique,
  company text not null, city text not null default '',
  website text, phone text, email text,
  commercial_id uuid references public.profiles(id),
  status text not null default 'assigned' check(status in ('assigned','contacted','converted','rejected')),
  prospect_id uuid unique references public.prospects(id),
  assigned_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index lead_pool_owner_idx on public.lead_pool(commercial_id,status,assigned_at);
alter table public.lead_pool enable row level security;
create policy lead_pool_read on public.lead_pool for select to authenticated using ((commercial_id=(select auth.uid()) and (select public.is_active_commercial())) or (select public.is_active_admin()));
