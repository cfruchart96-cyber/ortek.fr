import test from 'node:test';import assert from 'node:assert/strict';
import { commissionAmount } from '../lib/money.ts';

test('30 % on 1 490 EUR setup is 447 EUR',()=>{
  assert.equal(commissionAmount(149000,{fixed_cents:0,percentage_bps:3000}),44700);
});
test('fixed, percentage and one-time bonus are integer cents',()=>{
  assert.equal(commissionAmount(6900,{fixed_cents:150,percentage_bps:1250,performance_bonus_cents:500}),1513);
});
