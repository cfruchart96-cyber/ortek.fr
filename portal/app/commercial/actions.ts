'use server';
import { requireRole, audit } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase';
import { prospectInput } from '@/lib/validation';
import { createPdf, sha256, token } from '@/lib/quote';
import { notify } from '@/lib/email';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

export async function addProspect(data:FormData){
  const user=await requireRole('commercial');const db=serviceClient();
  const input=prospectInput.parse(Object.fromEntries(data));
  const {data:permission}=await db.from('offer_permissions').select('offer_id').eq('commercial_id',user.id).eq('offer_id',input.offer_id).maybeSingle();
  if(!permission)throw new Error('Offre non autorisée');
  const {data:lead,error}=await db.from('prospects').insert({...input,commercial_id:user.id}).select('id').single();
  if(error)throw new Error(error.code==='23505'?'Ce contact existe déjà.':'Création impossible.');
  await audit(user.id,'prospect',lead.id,'created');revalidatePath('/commercial');
}

export async function convertLead(data:FormData){
  const user=await requireRole('commercial');const db=serviceClient();
  const id=String(data.get('lead_id'));
  const input=prospectInput.parse({company:data.get('company'),contact_name:data.get('contact_name'),email:data.get('email'),phone:data.get('phone'),notes:data.get('notes')??'',offer_id:data.get('offer_id')});
  const {data:lead}=await db.from('lead_pool').select('id,status').eq('id',id).eq('commercial_id',user.id).in('status',['assigned','contacted']).single();
  if(!lead)throw new Error('Contact non attribué');
  const {data:permission}=await db.from('offer_permissions').select('offer_id').eq('commercial_id',user.id).eq('offer_id',input.offer_id).maybeSingle();if(!permission)throw new Error('Offre non autorisée');
  const {data:prospect,error}=await db.from('prospects').insert({...input,commercial_id:user.id}).select('id').single();
  if(error)throw new Error(error.code==='23505'?'Email déjà présent dans le portefeuille global.':'Conversion impossible');
  await db.from('lead_pool').update({status:'converted',prospect_id:prospect.id}).eq('id',id).eq('commercial_id',user.id);
  await audit(user.id,'lead_pool',id,'converted',{prospect_id:prospect.id});revalidatePath('/commercial');
}

export async function createQuote(data:FormData){
  const user=await requireRole('commercial');const db=serviceClient();
  const prospectId=String(data.get('prospect_id'));
  const {data:lead}=await db.from('prospects').select('*').eq('id',prospectId).eq('commercial_id',user.id).single();
  if(!lead?.offer_id)throw new Error('Prospect introuvable');
  const [{data:offer},{data:allowed},{data:settings},{data:rules}]=await Promise.all([
    db.from('offers').select('*').eq('id',lead.offer_id).eq('active',true).single(),
    db.from('offer_permissions').select('offer_id').eq('commercial_id',user.id).eq('offer_id',lead.offer_id).maybeSingle(),
    db.from('settings').select('*').eq('id',true).single(),
    db.from('commission_rules').select('*').eq('commercial_id',user.id).lte('effective_at',new Date().toISOString()).order('effective_at',{ascending:false})
  ]);
  if(!offer||!allowed||!settings)throw new Error('Offre indisponible');
  if(!offer.fixed_price)throw new Error('Cette offre nécessite un chiffrage validé par Ortek.');
  if(!settings.legal_name||!settings.legal_address||!settings.registration_number||!settings.legal_email||!settings.vat_notice||!settings.contract_terms)throw new Error('Mentions légales et conditions à compléter par Ortek.');
  const rule=rules?.find(r=>r.offer_id===offer.id)??rules?.find(r=>!r.offer_id);
  if(!rule)throw new Error('Aucune règle de commission active.');
  const {count}=await db.from('quotes').select('*',{count:'exact',head:true}).eq('prospect_id',lead.id);
  const version=(count??0)+1;const expires=new Date(Date.now()+settings.quote_valid_days*86400000).toISOString();
  const snapshot={client:{company:lead.company,name:lead.contact_name,email:lead.email},offer:{id:offer.id,name:offer.name,description:offer.description,setup_cents:offer.setup_cents,monthly_cents:offer.monthly_cents,currency:offer.currency},legal:{name:settings.legal_name,address:settings.legal_address,registration:settings.registration_number,email:settings.legal_email,vat_notice:settings.vat_notice,terms:settings.contract_terms},expires_at:expires};
  const secret=token();
  const {data:quote,error}=await db.from('quotes').insert({prospect_id:lead.id,commercial_id:user.id,offer_id:offer.id,version,status:'draft',snapshot,commission_snapshot:rule,pdf_path:`${user.id}/pending`,pdf_sha256:'pending',token_hash:sha256(secret),expires_at:expires}).select('id,number').single();
  if(error||!quote)throw new Error('Devis non créé');
  const pdf=await createPdf(snapshot,quote.number);const path=`${user.id}/${quote.id}/v${version}.pdf`;
  const {error:storageError}=await db.storage.from('quotes').upload(path,pdf,{contentType:'application/pdf',upsert:false});
  if(storageError)throw storageError;
  await db.from('quotes').update({pdf_path:path,pdf_sha256:sha256(pdf),status:'sent',sent_at:new Date().toISOString()}).eq('id',quote.id).eq('status','draft');
  await db.from('prospects').update({status:'quoted'}).eq('id',lead.id);
  await audit(user.id,'quote',quote.id,'sent',{version,number:quote.number});
  const url=`${process.env.NEXT_PUBLIC_PORTAL_URL}/quote/${secret}`;
  await notify(`quote:${quote.id}:sent`,lead.email,`Devis Ortek n° ${quote.number}`,`Bonjour ${lead.contact_name},\n\nConsultez et acceptez votre devis : ${url}\n\nCe lien expire le ${new Date(expires).toLocaleDateString('fr-FR')}.`);
  revalidatePath('/commercial');redirect('/commercial');
}
