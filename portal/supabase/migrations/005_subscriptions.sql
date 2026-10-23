create table public.subscriptions (
  id text primary key,
  quote_id uuid not null unique references public.quotes(id),
  commercial_id uuid not null references public.profiles(id),
  status text not null check(status in ('incomplete','trialing','active','past_due','unpaid','paused','canceled','other')),
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
create policy subscriptions_read on public.subscriptions for select to authenticated using
  ((commercial_id=(select auth.uid()) and (select public.is_active_commercial())) or (select public.is_active_admin()));
