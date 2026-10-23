import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';import { serviceClient } from '@/lib/supabase';import { audit } from '@/lib/auth';import { notify } from '@/lib/email';
import type Stripe from 'stripe';

export const runtime='nodejs';
async function updateSubscription(subscription:Stripe.Subscription){
  const quoteId=subscription.metadata.quote_id;if(!quoteId)throw new Error('Subscription without quote reference');
  const db=serviceClient();const {data:q}=await db.from('quotes').select('commercial_id').eq('id',quoteId).eq('status','accepted').single();
  if(!q)throw new Error('Unknown subscription quote');
  const allowed=['incomplete','trialing','active','past_due','unpaid','paused','canceled'];
  const status=allowed.includes(subscription.status)?subscription.status:'other';
  const {error}=await db.from('subscriptions').upsert({id:subscription.id,quote_id:quoteId,commercial_id:q.commercial_id,status,updated_at:new Date().toISOString()},{onConflict:'id'});
  if(error)throw error;
  await audit(null,'subscription',subscription.id,'status_changed',{status,quote_id:quoteId}).catch(()=>{});
}
async function handleInvoice(invoice:Stripe.Invoice){
  const db=serviceClient();const parent=invoice.parent;
  if(parent?.type!=='subscription_details'||!parent.subscription_details?.subscription)throw new Error('Subscription invoice missing');
  const subscriptionId=typeof parent.subscription_details.subscription==='string'?parent.subscription_details.subscription:parent.subscription_details.subscription.id;
  const subscription=await stripe().subscriptions.retrieve(subscriptionId);
  const quoteId=subscription.metadata.quote_id;
  if(!quoteId)throw new Error('Missing quote reference');
  const {data:q}=await db.from('quotes').select('id,number,status,snapshot,commercial_id').eq('id',quoteId).single();
  if(!q||q.status!=='accepted'||invoice.currency!=='eur'||invoice.status!=='paid')throw new Error('Invoice not eligible');
  const {data:alreadyPosted}=await db.from('payments').select('id').eq('stripe_invoice_id',invoice.id).eq('status','paid').limit(1).maybeSingle();
  if(!alreadyPosted){
    const {data:previous}=await db.from('payments').select('id').eq('quote_id',q.id).eq('type','setup').eq('status','paid').maybeSingle();
    const setup=previous?0:q.snapshot.offer.setup_cents;
    const monthly=q.snapshot.offer.monthly_cents;
    // Discounts, taxes, partial payments and manual Stripe changes require a human review.
    if(invoice.amount_paid!==setup+monthly||invoice.amount_remaining!==0)throw new Error('Invoice amount mismatch');
    const result=await db.rpc('post_paid_invoice',{p_quote:q.id,p_invoice:invoice.id,p_customer:typeof invoice.customer==='string'?invoice.customer:invoice.customer?.id??'',p_subscription:subscriptionId,p_currency:invoice.currency,p_invoice_total:invoice.amount_paid,p_setup:setup,p_monthly:monthly});
    if(result.error)throw result.error;
    await audit(null,'invoice',invoice.id,'paid',{quote_id:q.id,amount:invoice.amount_paid}).catch(()=>{});
  }
  await notify(`invoice:${invoice.id}:admin`,process.env.PORTAL_ADMIN_EMAIL!,`Paiement confirmé · devis ${q.number}`,`Un paiement de ${invoice.amount_paid/100} EUR est confirmé pour le devis ${q.number}. Consultez le portail pour commencer la production.`).catch(()=>{});
  const {data:seller}=await db.from('profiles').select('email').eq('id',q.commercial_id).single();
  if(seller)await notify(`invoice:${invoice.id}:seller`,seller.email,`Paiement Ortek confirmé · devis ${q.number}`,`Le paiement du devis ${q.number} est confirmé. Votre commission est visible dans le portail.`).catch(()=>{});
}

export async function POST(request:NextRequest){
  const signature=request.headers.get('stripe-signature');if(!signature)return new NextResponse('Signature absente',{status:400});
  let event:Stripe.Event;
  try{event=stripe().webhooks.constructEvent(await request.text(),signature,process.env.STRIPE_WEBHOOK_SECRET!);}catch{return new NextResponse('Signature invalide',{status:400});}
  const db=serviceClient();const {data:claimed,error}=await db.rpc('claim_stripe_event',{event_id:event.id,event_type:event.type});
  if(error)return new NextResponse('Journal indisponible',{status:503});
  if(!claimed)return NextResponse.json({duplicate:true});
  try{
    if(event.type==='invoice.paid')await handleInvoice(event.data.object as Stripe.Invoice);
    if(event.type==='invoice.payment_failed'){
      const failed=event.data.object as Stripe.Invoice;
      await audit(null,'invoice',failed.id,'payment_failed');
      await notify(`invoice:${failed.id}:failed`,process.env.PORTAL_ADMIN_EMAIL!,'Échec de paiement Ortek',`Le paiement de la facture Stripe ${failed.id} a échoué. Vérifiez le dossier dans Stripe.`).catch(()=>{});
    }
    if(event.type==='customer.subscription.created'||event.type==='customer.subscription.updated'||event.type==='customer.subscription.deleted')await updateSubscription(event.data.object as Stripe.Subscription);
    await db.from('stripe_events').update({status:'processed',processed_at:new Date().toISOString()}).eq('id',event.id);
    return NextResponse.json({received:true});
  }catch(e){await db.from('stripe_events').update({status:'failed'}).eq('id',event.id);return new NextResponse('Traitement différé',{status:500});}
}
