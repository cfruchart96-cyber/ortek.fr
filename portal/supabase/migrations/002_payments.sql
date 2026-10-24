-- Atomic payment/commission posting. Only verified Stripe webhooks may call this via the service role.
create or replace function public.post_paid_invoice(
  p_quote uuid, p_invoice text, p_customer text, p_subscription text,
  p_currency text, p_invoice_total integer, p_setup integer, p_monthly integer
) returns void language plpgsql security definer set search_path = '' as $$
declare q public.quotes%rowtype; rule jsonb; paid_count integer; payment_id uuid; amount integer; kind text; commission_cents integer; bonus_awarded boolean;
begin
  select * into q from public.quotes where id=p_quote for update;
  if not found or q.status <> 'accepted' then raise exception 'Quote not accepted'; end if;
  if p_currency <> 'eur' or p_setup < 0 or p_monthly < 0 or p_invoice_total <> p_setup+p_monthly then raise exception 'Invoice mismatch'; end if;
  if p_monthly > (q.snapshot#>>'{offer,monthly_cents}')::integer or p_setup > (q.snapshot#>>'{offer,setup_cents}')::integer then raise exception 'Unexpected amount'; end if;
  if p_setup > 0 and exists(select 1 from public.payments where quote_id=p_quote and type='setup' and status='paid') then raise exception 'Duplicate setup'; end if;
  rule := q.commission_snapshot;
  select count(*) into paid_count from public.payments where quote_id=p_quote and type='monthly' and status='paid';
  select exists(select 1 from public.commissions where quote_id=p_quote) into bonus_awarded;
  for kind, amount in select 'setup',p_setup union all select 'monthly',p_monthly loop
    if amount <= 0 then continue; end if;
    insert into public.payments(quote_id,commercial_id,stripe_invoice_id,stripe_customer_id,stripe_subscription_id,type,amount_cents,currency,status,paid_at)
      values(p_quote,q.commercial_id,p_invoice,p_customer,p_subscription,kind,amount,p_currency,'paid',now())
      on conflict (stripe_invoice_id,type) do nothing returning id into payment_id;
    if payment_id is null then continue; end if;
    if (kind='setup' and rule->>'applies_to' in ('setup','both')) or
       (kind='monthly' and rule->>'applies_to' in ('monthly','both') and paid_count < (rule->>'max_months')::integer) then
      commission_cents := (rule->>'fixed_cents')::integer + round(amount * (rule->>'percentage_bps')::integer / 10000.0)::integer;
      if not bonus_awarded then commission_cents := commission_cents + coalesce((rule->>'performance_bonus_cents')::integer,0); end if;
      insert into public.commissions(commercial_id,payment_id,quote_id,amount_cents,status)
        values(q.commercial_id,payment_id,p_quote,commission_cents,'acquired') on conflict (payment_id) do nothing;
      bonus_awarded := true;
    end if;
    payment_id := null;
  end loop;
  insert into public.orders(quote_id,status) values(p_quote,'ready') on conflict(quote_id) do nothing;
  update public.prospects set status='won' where id=q.prospect_id;
end $$;
revoke all on function public.post_paid_invoice(uuid,text,text,text,text,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.post_paid_invoice(uuid,text,text,text,text,integer,integer,integer) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('quotes','quotes',false,5242880,array['application/pdf']) on conflict(id) do nothing;
