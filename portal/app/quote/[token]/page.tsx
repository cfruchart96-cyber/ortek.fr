import { sha256 } from '@/lib/quote';
import { serviceClient } from '@/lib/supabase';
import { euros } from '@/lib/money';
import { notFound } from 'next/navigation';
import { acceptQuote } from './actions';

export default async function QuotePage({params}:{params:Promise<{token:string}>}){
  const {token}=await params;
  const {data:quote}=await serviceClient().from('quotes').select('id,number,status,expires_at,snapshot,pdf_sha256').eq('token_hash',sha256(token)).single();
  if(!quote)notFound();const snap=quote.snapshot;
  return <div className="card"><h1>Devis Ortek n° {quote.number}</h1><p>Destinataire : {snap.client.company} · {snap.client.email}</p><p>{snap.offer.name} · création {euros(snap.offer.setup_cents)} + {euros(snap.offer.monthly_cents)} par mois.</p><p>Valable jusqu’au {new Date(quote.expires_at).toLocaleDateString('fr-FR')}.</p><p><a href={`/quote/${token}/pdf`} target="_blank" rel="noreferrer">Consulter le document PDF</a></p>
  {quote.status==='sent'&&new Date(quote.expires_at)>new Date()&&<form action={acceptQuote} className="stack"><input name="token" type="hidden" value={token}/><label>Votre nom complet<input name="name" required minLength={2}/></label><label>Votre email<input name="email" type="email" required defaultValue={snap.client.email}/></label><label><input type="checkbox" name="consent" value="yes" required/> J’ai lu le devis PDF et j’accepte expressément cette version et ses conditions.</label><button>Accepter le devis</button></form>}
  {quote.status==='accepted'&&<p className="success">Devis accepté. <a href={`/quote/${token}/pay`}>Poursuivre vers le paiement sécurisé</a>.</p>}
  {quote.status==='refused'&&<p>Devis refusé.</p>}{new Date(quote.expires_at)<=new Date()&&quote.status!=='accepted'&&<p>Ce devis a expiré.</p>}</div>;
}
