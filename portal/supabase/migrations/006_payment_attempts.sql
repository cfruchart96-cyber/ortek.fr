-- Stripe invoice outcomes are separate from the paid-payment ledger. A failed
-- attempt can later become paid, but a delayed failure must never undo success.
alter table public.checkout_sessions add column commercial_id uuid references public.profiles(id);
update public.checkout_sessions c set commercial_id=q.commercial_id from public.quotes q where c.quote_id=q.id;
alter table public.checkout_sessions alter column commercial_id set not null;
create index checkout_sessions_owner_idx on public.checkout_sessions(commercial_id);

create table public.payment_attempts (
  stripe_invoice_id text primary key,
  quote_id uuid not null references public.quotes(id),
  commercial_id uuid not null references public.profiles(id),
  stripe_subscription_id text not null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null check (currency = 'eur'),
  status text not null check (status in ('failed','paid')),
  occurred_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index payment_attempts_owner_idx on public.payment_attempts(commercial_id,occurred_at desc);
create index payment_attempts_quote_idx on public.payment_attempts(quote_id,occurred_at desc);
alter table public.payment_attempts enable row level security;
create policy payment_attempts_read on public.payment_attempts for select to authenticated using
  ((commercial_id = (select auth.uid()) and (select public.is_active_commercial())) or (select public.is_active_admin()));

create or replace function public.record_invoice_status(
  p_invoice text, p_quote uuid, p_subscription text,
  p_amount integer, p_currency text, p_status text, p_occurred_at timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
declare owner_id uuid;
begin
  if p_status not in ('failed','paid') or p_currency <> 'eur' or p_amount < 0 then
    raise exception 'Invalid invoice status';
  end if;
  select commercial_id into owner_id from public.quotes where id = p_quote and status = 'accepted';
  if owner_id is null then raise exception 'Unknown accepted quote'; end if;
  insert into public.payment_attempts
    (stripe_invoice_id,quote_id,commercial_id,stripe_subscription_id,amount_cents,currency,status,occurred_at)
    values(p_invoice,p_quote,owner_id,p_subscription,p_amount,p_currency,p_status,p_occurred_at)
  on conflict(stripe_invoice_id) do update set
    status = excluded.status, amount_cents = excluded.amount_cents,
    occurred_at = excluded.occurred_at, updated_at = now()
  where public.payment_attempts.status <> 'paid'
    and public.payment_attempts.quote_id = excluded.quote_id
    and public.payment_attempts.stripe_subscription_id = excluded.stripe_subscription_id;
end $$;
revoke all on function public.record_invoice_status(text,uuid,text,integer,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.record_invoice_status(text,uuid,text,integer,text,text,timestamptz) to service_role;
