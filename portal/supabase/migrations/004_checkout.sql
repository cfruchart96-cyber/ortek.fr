create table public.checkout_sessions (
  quote_id uuid primary key references public.quotes(id),
  stripe_session_id text unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.checkout_sessions enable row level security;
-- Only privileged server code creates or reads sessions; the opaque Stripe URL is never exposed by RLS.
