create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  email text not null unique,
  full_name text not null default '',
  business_details text not null default '',
  role text not null check (role in ('admin','commercial')),
  status text not null default 'active' check (status in ('active','suspended','disabled')),
  created_at timestamptz not null default now()
);

create or replace function public.is_active_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = (select auth.uid()) and role = 'admin' and status = 'active');
$$;
revoke all on function public.is_active_admin() from public;
grant execute on function public.is_active_admin() to authenticated;
create or replace function public.is_active_commercial() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = (select auth.uid()) and role = 'commercial' and status = 'active');
$$;
revoke all on function public.is_active_commercial() from public;
grant execute on function public.is_active_commercial() to authenticated;

create table public.settings (
  id boolean primary key default true check (id),
  legal_name text not null default '', legal_address text not null default '',
  registration_number text not null default '', legal_email text not null default '',
  vat_notice text not null default '', contract_terms text not null default '',
  quote_valid_days integer not null default 30 check (quote_valid_days between 1 and 90),
  updated_at timestamptz not null default now()
);
insert into public.settings(id) values (true);

create table public.offers (
  id uuid primary key default gen_random_uuid(), code text not null unique,
  name text not null, description text not null default '',
  setup_cents integer not null check (setup_cents >= 0),
  monthly_cents integer not null check (monthly_cents >= 0),
  currency text not null default 'eur' check (currency = 'eur'),
  active boolean not null default true, fixed_price boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.offers(code,name,description,setup_cents,monthly_cents,fixed_price) values
 ('presence','Présence','Site une page',59000,1990,true),
 ('vitrine','Vitrine','Site complet',79000,2990,true),
 ('reservation','Vitrine + Réservation','Site et agenda pour un professionnel',99000,3990,true),
 ('boutique','Boutique e-commerce','Boutique avec jusqu’à 20 produits au lancement ; prix de création à partir de 1 490 €',149000,6900,false);

create table public.offer_permissions (
  commercial_id uuid not null references public.profiles(id),
  offer_id uuid not null references public.offers(id),
  primary key (commercial_id,offer_id)
);

create table public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  commercial_id uuid not null references public.profiles(id),
  offer_id uuid references public.offers(id),
  effective_at timestamptz not null default now(),
  fixed_cents integer not null default 0 check (fixed_cents >= 0),
  percentage_bps integer not null default 0 check (percentage_bps between 0 and 10000),
  applies_to text not null default 'setup' check (applies_to in ('setup','monthly','both')),
  max_months integer not null default 1 check (max_months between 1 and 120),
  performance_bonus_cents integer not null default 0 check (performance_bonus_cents >= 0),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.prospects (
  id uuid primary key default gen_random_uuid(),
  commercial_id uuid not null references public.profiles(id),
  company text not null, contact_name text not null, email text not null,
  phone text, offer_id uuid references public.offers(id), notes text not null default '',
  normalized_email text generated always as (lower(btrim(email))) stored,
  status text not null default 'new' check (status in ('new','qualified','quoted','won','lost')),
  created_at timestamptz not null default now(),
  unique (normalized_email)
);
create index prospects_owner_idx on public.prospects(commercial_id,created_at desc);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  prospect_id uuid not null references public.prospects(id),
  commercial_id uuid not null references public.profiles(id),
  offer_id uuid not null references public.offers(id),
  version integer not null default 1 check (version > 0),
  status text not null default 'draft' check (status in ('draft','sent','accepted','refused','expired')),
  snapshot jsonb not null,
  commission_snapshot jsonb not null,
  pdf_path text not null,
  pdf_sha256 text not null,
  token_hash text unique,
  expires_at timestamptz not null,
  sent_at timestamptz, accepted_at timestamptz,
  accepted_name text, accepted_email text, accepted_ip_hash text,
  accepted_user_agent text, acceptance_consent text,
  created_at timestamptz not null default now(),
  unique (prospect_id,version)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id),
  commercial_id uuid not null references public.profiles(id),
  stripe_checkout_id text unique, stripe_customer_id text,
  stripe_subscription_id text,
  stripe_invoice_id text,
  stripe_payment_intent_id text,
  type text not null check (type in ('setup','monthly')),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'eur',
  status text not null default 'pending' check (status in ('pending','paid','failed','refunded')),
  paid_at timestamptz, created_at timestamptz not null default now(),
  unique (stripe_invoice_id,type)
);
create index payments_owner_idx on public.payments(commercial_id,created_at desc);

create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  commercial_id uuid not null references public.profiles(id),
  payment_id uuid not null unique references public.payments(id),
  quote_id uuid not null references public.quotes(id),
  amount_cents integer not null,
  status text not null default 'acquired' check (status in ('pending','acquired','payable','paid','cancelled')),
  paid_at timestamptz, created_at timestamptz not null default now()
);
create table public.commission_adjustments (
  id uuid primary key default gen_random_uuid(), commission_id uuid not null references public.commissions(id),
  delta_cents integer not null, reason text not null, created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create table public.orders (
  quote_id uuid primary key references public.quotes(id),
  status text not null default 'ready' check (status in ('ready','in_progress','delivered','cancelled')),
  created_at timestamptz not null default now()
);
create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  subject_type text not null, subject_id text not null,
  action text not null, details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.stripe_events (
  id text primary key, type text not null,
  status text not null default 'processing',
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique, recipient text not null,
  subject text not null, body text not null,
  sent_at timestamptz, created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.offers enable row level security;
alter table public.offer_permissions enable row level security;
alter table public.commission_rules enable row level security;
alter table public.prospects enable row level security;
alter table public.quotes enable row level security;
alter table public.payments enable row level security;
alter table public.commissions enable row level security;
alter table public.commission_adjustments enable row level security;
alter table public.orders enable row level security;
alter table public.audit_events enable row level security;
alter table public.stripe_events enable row level security;
alter table public.notification_outbox enable row level security;

create policy profiles_read on public.profiles for select to authenticated using (id = (select auth.uid()) or (select public.is_active_admin()));
create policy settings_admin on public.settings for select to authenticated using ((select public.is_active_admin()));
create policy offers_read on public.offers for select to authenticated using (active or (select public.is_active_admin()));
create policy permissions_read on public.offer_permissions for select to authenticated using ((commercial_id = (select auth.uid()) and (select public.is_active_commercial())) or (select public.is_active_admin()));
create policy rules_read on public.commission_rules for select to authenticated using ((commercial_id = (select auth.uid()) and (select public.is_active_commercial())) or (select public.is_active_admin()));
create policy prospects_read on public.prospects for select to authenticated using ((commercial_id = (select auth.uid()) and (select public.is_active_commercial())) or (select public.is_active_admin()));
create policy quotes_read on public.quotes for select to authenticated using ((commercial_id = (select auth.uid()) and (select public.is_active_commercial())) or (select public.is_active_admin()));
create policy payments_read on public.payments for select to authenticated using ((commercial_id = (select auth.uid()) and (select public.is_active_commercial())) or (select public.is_active_admin()));
create policy commissions_read on public.commissions for select to authenticated using ((commercial_id = (select auth.uid()) and (select public.is_active_commercial())) or (select public.is_active_admin()));
create policy adjustments_read on public.commission_adjustments for select to authenticated using ((select public.is_active_admin()) or ((select public.is_active_commercial()) and exists(select 1 from public.commissions c where c.id = commission_id and c.commercial_id = (select auth.uid()))));
create policy orders_admin on public.orders for select to authenticated using ((select public.is_active_admin()));
create policy audit_admin on public.audit_events for select to authenticated using ((select public.is_active_admin()));
-- All mutations are performed server-side after explicit role checks with the service key.
-- There are deliberately no authenticated INSERT/UPDATE/DELETE policies.

create or replace function public.claim_stripe_event(event_id text, event_type text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare claimed_rows integer;
begin
  insert into public.stripe_events(id,type) values (event_id,event_type)
  on conflict (id) do update set status = 'processing', created_at = now()
    where public.stripe_events.status = 'failed' or
      (public.stripe_events.status = 'processing' and public.stripe_events.created_at < now()-interval '10 minutes');
  get diagnostics claimed_rows = row_count;
  return claimed_rows > 0;
end $$;
revoke all on function public.claim_stripe_event(text,text) from public, anon, authenticated;
grant execute on function public.claim_stripe_event(text,text) to service_role;
