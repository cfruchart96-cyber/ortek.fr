import { NextRequest, NextResponse } from 'next/server';
import { sha256 } from '@/lib/quote';import { serviceClient } from '@/lib/supabase';import { stripe } from '@/lib/stripe';
export async function GET(request:NextRequest,{params}:{params:Promise<{token:string}>}){
  const {token}=await params;const db=serviceClient();
  const {data:q}=await db.from('quotes').select('id,commercial_id,status,expires_at,snapshot').eq('token_hash',sha256(token)).single();
  if(!q||q.status!=='accepted')return new NextResponse('Devis non accepté',{status:403});
  const {data:paid}=await db.from('payments').select('id').eq('quote_id',q.id).eq('type','setup').eq('status','paid').maybeSingle();
  if(paid)return NextResponse.redirect(new URL(`/quote/${token}?paid=1`,request.url));
  const {data:existing}=await db.from('checkout_sessions').select('stripe_session_id,expires_at').eq('quote_id',q.id).maybeSingle();
  if(existing){
    if(!existing.stripe_session_id&&new Date(existing.expires_at)>new Date())return new NextResponse('Session en cours de préparation, réessayez dans un instant.',{status:409});
    if(existing.stripe_session_id){
      const current=await stripe().checkout.sessions.retrieve(existing.stripe_session_id);
      if(current.status==='open'&&current.url)return NextResponse.redirect(current.url);
      if(current.status==='complete')return new NextResponse('Paiement en cours de vérification. Contactez Ortek si le statut ne change pas.',{status:409});
    }
  }
  if(existing)await db.from('checkout_sessions').delete().eq('quote_id',q.id).lt('expires_at',new Date().toISOString());
  const expiration=Math.floor(Date.now()/1000)+1800;
  const {error:claimError}=await db.from('checkout_sessions').insert({quote_id:q.id,commercial_id:q.commercial_id,expires_at:new Date(expiration*1000).toISOString()});
  if(claimError)return new NextResponse('Session déjà en cours de préparation.',{status:409});
  const offer=q.snapshot.offer;
  if(!offer?.monthly_cents||offer.currency!=='eur')return new NextResponse('Offre non disponible',{status:400});
  const session=await stripe().checkout.sessions.create({
    mode:'subscription',customer_email:q.snapshot.client.email,
    client_reference_id:q.id,metadata:{quote_id:q.id},subscription_data:{metadata:{quote_id:q.id}},
    line_items:[
      {price_data:{currency:'eur',unit_amount:offer.setup_cents,product_data:{name:`Création · ${offer.name}`}},quantity:1},
      {price_data:{currency:'eur',unit_amount:offer.monthly_cents,recurring:{interval:'month'},product_data:{name:`Abonnement · ${offer.name}`}},quantity:1}
    ],
    success_url:`${process.env.NEXT_PUBLIC_PORTAL_URL}/quote/${token}?checkout=complete`,
    cancel_url:`${process.env.NEXT_PUBLIC_PORTAL_URL}/quote/${token}?checkout=cancelled`,
    expires_at:expiration
  },{idempotencyKey:`checkout:${q.id}:${Math.floor(Date.now()/1800000)}`});
  const {error:saveError}=await db.from('checkout_sessions').update({stripe_session_id:session.id}).eq('quote_id',q.id).is('stripe_session_id',null);
  if(saveError)return new NextResponse('Session non enregistrée',{status:503});
  return NextResponse.redirect(session.url!);
}
