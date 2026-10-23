'use server';
import { requireRole, audit } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase';
import { ruleInput } from '@/lib/validation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { parse } from 'csv-parse/sync';
import { createHash } from 'node:crypto';

export async function invite(data:FormData){
  const admin=await requireRole('admin');const db=serviceClient();
  const input=z.object({email:z.email(),full_name:z.string().min(2).max(160),business_details:z.string().max(1000)}).parse(Object.fromEntries(data));
  const {data:invited,error}=await db.auth.admin.inviteUserByEmail(input.email,{redirectTo:`${process.env.NEXT_PUBLIC_PORTAL_URL}/auth/callback?activate=1`});
  if(error||!invited.user)throw new Error(error?.message??'Invitation impossible');
  const {error:profileError}=await db.from('profiles').upsert({id:invited.user.id,email:input.email,full_name:input.full_name,business_details:input.business_details,role:'commercial',status:'active'},{onConflict:'id'});
  if(profileError)throw profileError;
  await audit(admin.id,'profile',invited.user.id,'invited');revalidatePath('/admin');
}

export async function setStatus(data:FormData){
  const admin=await requireRole('admin');const db=serviceClient();
  const id=z.uuid().parse(data.get('id'));const status=z.enum(['active','suspended','disabled']).parse(data.get('status'));
  const {data:subject}=await db.from('profiles').select('role').eq('id',id).single();
  if(subject?.role!=='commercial')throw new Error('Seuls les commerciaux peuvent être modifiés ici.');
  const {error}=await db.from('profiles').update({status}).eq('id',id);if(error)throw error;
  if(status!=='active')await db.auth.admin.signOut(id,'global');
  await audit(admin.id,'profile',id,'status_changed',{status});revalidatePath('/admin');
}

export async function saveSettings(data:FormData){
  const admin=await requireRole('admin');const db=serviceClient();
  const schema=z.object({legal_name:z.string().min(2),legal_address:z.string().min(5),registration_number:z.string().min(9),legal_email:z.email(),vat_notice:z.string().min(10),contract_terms:z.string().min(20),quote_valid_days:z.coerce.number().int().min(1).max(90)});
  const value=schema.parse(Object.fromEntries(data));
  const {error}=await db.from('settings').update({...value,updated_at:new Date().toISOString()}).eq('id',true);if(error)throw error;
  await audit(admin.id,'settings','legal','updated');revalidatePath('/admin');
}

export async function saveOffer(data:FormData){
  const admin=await requireRole('admin');const db=serviceClient();
  const id=z.uuid().parse(data.get('id'));
  const setup=z.coerce.number().int().min(0).parse(data.get('setup_cents'));
  const monthly=z.coerce.number().int().min(0).parse(data.get('monthly_cents'));
  const {error}=await db.from('offers').update({setup_cents:setup,monthly_cents:monthly,active:data.get('active')==='on',fixed_price:data.get('fixed_price')==='on'}).eq('id',id);if(error)throw error;
  await audit(admin.id,'offer',id,'updated',{setup,monthly});revalidatePath('/admin');
}

export async function grantOffer(data:FormData){
  const admin=await requireRole('admin');const db=serviceClient();
  const commercial_id=z.uuid().parse(data.get('commercial_id'));const offer_id=z.uuid().parse(data.get('offer_id'));
  const {error}=await db.from('offer_permissions').upsert({commercial_id,offer_id});if(error)throw error;
  await audit(admin.id,'offer_permission',commercial_id,'granted',{offer_id});revalidatePath('/admin');
}

export async function saveRule(data:FormData){
  const admin=await requireRole('admin');const db=serviceClient();
  const rule=ruleInput.parse({commercial_id:data.get('commercial_id'),offer_id:data.get('offer_id')||null,fixed_cents:Number(data.get('fixed_cents')),percentage_bps:Number(data.get('percentage_bps')),applies_to:data.get('applies_to'),max_months:Number(data.get('max_months')),effective_at:new Date(String(data.get('effective_at'))).toISOString()});
  const {data:created,error}=await db.from('commission_rules').insert({...rule,created_by:admin.id}).select('id').single();if(error)throw error;
  await audit(admin.id,'commission_rule',created.id,'created',{commercial_id:rule.commercial_id});revalidatePath('/admin');
}

export async function markCommissionPaid(data:FormData){
  const admin=await requireRole('admin');const db=serviceClient();const id=z.uuid().parse(data.get('id'));
  const {data:commission,error}=await db.from('commissions').update({status:'paid',paid_at:new Date().toISOString()}).eq('id',id).eq('status','payable').select('id,commercial_id,amount_cents').single();
  if(error||!commission)throw new Error('Commission non payable');
  await audit(admin.id,'commission',id,'marked_paid');revalidatePath('/admin');
}

export async function markCommissionPayable(data:FormData){
  const admin=await requireRole('admin');const db=serviceClient();const id=z.uuid().parse(data.get('id'));
  const {data:commission,error}=await db.from('commissions').update({status:'payable'}).eq('id',id).eq('status','acquired').select('id').single();
  if(error||!commission)throw new Error('Commission non acquise');await audit(admin.id,'commission',id,'marked_payable');revalidatePath('/admin');
}

export async function reassign(data:FormData){
  const admin=await requireRole('admin');const db=serviceClient();const id=z.uuid().parse(data.get('id'));const commercial_id=z.uuid().parse(data.get('commercial_id'));
  const {data:quote}=await db.from('quotes').select('id').eq('prospect_id',id).limit(1).maybeSingle();
  if(quote)throw new Error('Réattribution bloquée après création d’un devis.');
  const {data:target}=await db.from('profiles').select('id').eq('id',commercial_id).eq('status','active').eq('role','commercial').single();if(!target)throw new Error('Commercial inactif');
  const {error}=await db.from('prospects').update({commercial_id}).eq('id',id);if(error)throw error;
  await audit(admin.id,'prospect',id,'reassigned',{commercial_id});revalidatePath('/admin');
}

export async function importLeads(data:FormData){
  const admin=await requireRole('admin');const db=serviceClient();
  const raw=z.string().max(500000).parse(data.get('csv'));
  const records=parse(raw,{columns:true,skip_empty_lines:true,trim:true,bom:true,relax_quotes:false}) as Record<string,string>[];
  if(records.length>500)throw new Error('Maximum 500 lignes par import.');
  const {data:team}=await db.from('profiles').select('id').eq('role','commercial').eq('status','active').order('id');
  if(!team?.length)throw new Error('Aucun commercial actif.');
  let imported=0;
  for(const [i,row] of records.entries()){
    const company=(row.company??'').trim().slice(0,160);
    if(!company)continue;
    const rawKey=row.place_id||row.website||row.phone||`${company}|${row.city??''}`;
    const external_key=createHash('sha256').update(rawKey.trim().toLowerCase()).digest('hex');
    const website=(row.website??'').trim();
    const safeWebsite=/^https?:\/\//i.test(website)?website.slice(0,500):null;
    const {data:lead,error}=await db.from('lead_pool').upsert({external_key,company,city:(row.city??'').slice(0,100),website:safeWebsite,phone:(row.phone??'').slice(0,40)||null,email:(row.email??'').slice(0,254)||null,commercial_id:team[i%team.length].id},{onConflict:'external_key',ignoreDuplicates:true}).select('id').maybeSingle();
    if(error)throw error;if(lead)imported++;
  }
  await audit(admin.id,'lead_pool','batch','imported',{imported,total:records.length});revalidatePath('/admin');
}

export async function updateLead(data:FormData){
  const user=await requireRole('commercial');const db=serviceClient();
  const id=z.uuid().parse(data.get('id'));const status=z.enum(['contacted','rejected']).parse(data.get('status'));
  const {data:updated}=await db.from('lead_pool').update({status}).eq('id',id).eq('commercial_id',user.id).eq('status','assigned').select('id').single();
  if(!updated)throw new Error('Prospect non attribué');await audit(user.id,'lead_pool',id,'status_changed',{status});revalidatePath('/commercial');
}

export async function reassignPoolLead(data:FormData){
  const admin=await requireRole('admin');const db=serviceClient();const id=z.uuid().parse(data.get('id'));const commercial_id=z.uuid().parse(data.get('commercial_id'));
  const {data:target}=await db.from('profiles').select('id').eq('id',commercial_id).eq('status','active').eq('role','commercial').single();if(!target)throw new Error('Commercial inactif');
  const {data:updated,error}=await db.from('lead_pool').update({commercial_id,status:'assigned',assigned_at:new Date().toISOString()}).eq('id',id).in('status',['assigned','contacted','rejected']).select('id').single();
  if(error||!updated)throw new Error('Prospect déjà converti ou absent');
  await audit(admin.id,'lead_pool',id,'reassigned',{commercial_id});revalidatePath('/admin');
}
