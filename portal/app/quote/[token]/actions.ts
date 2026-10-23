'use server';
import { serviceClient } from '@/lib/supabase';
import { sha256 } from '@/lib/quote';
import { notify } from '@/lib/email';
import { audit } from '@/lib/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';

export async function acceptQuote(form:FormData){
  const token=z.string().min(32).parse(form.get('token'));
  const name=z.string().min(2).max(150).parse(form.get('name'));
  const email=z.email().parse(form.get('email'));
  if(form.get('consent')!=='yes')throw new Error('Consentement requis');
  const db=serviceClient();const {data:q}=await db.from('quotes').select('id,number,status,expires_at,snapshot,pdf_sha256').eq('token_hash',sha256(token)).single();
  if(!q||q.status!=='sent'||new Date(q.expires_at)<=new Date()||email.toLowerCase()!==q.snapshot.client.email.toLowerCase())throw new Error('Devis indisponible');
  const h=await headers();const ip=h.get('x-forwarded-for')?.split(',')[0]??'';
  const {data:updated,error}=await db.from('quotes').update({status:'accepted',accepted_at:new Date().toISOString(),accepted_name:name,accepted_email:email,accepted_ip_hash:sha256(ip),accepted_user_agent:h.get('user-agent')?.slice(0,300),acceptance_consent:'J’ai lu le devis PDF et j’accepte expressément cette version et ses conditions.'}).eq('id',q.id).eq('status','sent').select('id').single();
  if(error||!updated)throw new Error('Ce devis a déjà été traité');
  await audit(null,'quote',q.id,'accepted',{number:q.number,pdf_sha256:q.pdf_sha256,email});
  await notify(`quote:${q.id}:accepted`,process.env.PORTAL_ADMIN_EMAIL!,`Devis ${q.number} accepté`,`Le devis ${q.number} a été accepté. Consultez le portail pour le dossier.`);
  redirect(`/quote/${token}/pay`);
}
