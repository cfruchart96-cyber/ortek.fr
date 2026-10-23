import test from 'node:test';import assert from 'node:assert/strict';
import { saleStage } from '../lib/sales-status.ts';

test('unaccepted quote never appears paid or commissionable',()=>{
  assert.equal(saleStage('sent','paid',true,true),'awaiting_acceptance');
});
test('acceptance alone does not confirm payment',()=>{
  assert.equal(saleStage('accepted',null,false,false),'awaiting_payment');
  assert.equal(saleStage('accepted',null,true,false),'payment_link');
});
test('a failed renewal is visible even after an earlier paid invoice',()=>{
  assert.equal(saleStage('accepted','failed',true,true),'payment_failed');
});
test('verified paid invoice confirms payment',()=>{
  assert.equal(saleStage('accepted','paid',true,true),'payment_confirmed');
});
