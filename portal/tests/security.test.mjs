import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../supabase/migrations/001_portal.sql',import.meta.url),'utf8');
test('sensitive tables have RLS and no browser write policies',()=>{
  for(const table of ['profiles','prospects','quotes','payments','commissions','commission_rules','orders','audit_events'])assert.match(sql,new RegExp(`alter table public\\.${table} enable row level security`));
  assert.doesNotMatch(sql,/create policy\s+\S+\s+on\s+public\.(?:prospects|quotes|payments|commissions)\s+for\s+(?:insert|update|delete)/i);
});
test('financial ledger has uniqueness guards',()=>{
  assert.match(sql,/unique \(stripe_invoice_id,type\)/);
  assert.match(sql,/payment_id uuid not null unique references public\.payments/);
});
