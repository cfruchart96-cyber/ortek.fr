import { requireRole } from '@/lib/auth';
import { serviceClient } from '@/lib/supabase';
import { euros } from '@/lib/money';
import { addProspect, createQuote, convertLead } from './actions';
import { updateLead } from '../admin/actions';

export default async function CommercialPage(){
  const user=await requireRole('commercial');const db=serviceClient();
  const [{data:leads},{data:quotes},{data:payments},{data:commissions},{data:permissions},{data:pool},{data:subscriptions}]=await Promise.all([
    db.from('prospects').select('id,company,contact_name,email,offer_id,status,created_at').eq('commercial_id',user.id).order('created_at',{ascending:false}).limit(100),
    db.from('quotes').select('id,number,status,prospect_id,created_at').eq('commercial_id',user.id).order('created_at',{ascending:false}).limit(100),
    db.from('payments').select('id,quote_id,type,amount_cents,status,paid_at').eq('commercial_id',user.id).order('created_at',{ascending:false}).limit(100),
    db.from('commissions').select('id,payment_id,amount_cents,status,paid_at').eq('commercial_id',user.id).order('created_at',{ascending:false}).limit(100),
    db.from('offer_permissions').select('offer_id,offers(id,name,active,fixed_price)').eq('commercial_id',user.id),
    db.from('lead_pool').select('*').eq('commercial_id',user.id).in('status',['assigned','contacted']).order('assigned_at',{ascending:false}).limit(100),
    db.from('subscriptions').select('id,status,quote_id').eq('commercial_id',user.id).limit(100)
  ]);
  const available=(permissions??[]).map((p:any)=>p.offers).filter((o:any)=>o?.active);
  return <><h1>Bonjour {user.full_name}</h1><p>Votre portefeuille et vos ventes Ortek.</p>
    <div className="grid">{[['Prospects',leads?.length??0],['Devis acceptés',quotes?.filter(q=>q.status==='accepted').length??0],['Abonnements actifs',subscriptions?.filter(s=>s.status==='active').length??0],['Paiements confirmés',euros(payments?.filter(p=>p.status==='paid').reduce((s,p)=>s+p.amount_cents,0)??0)],['Commissions acquises',euros(commissions?.filter(c=>['acquired','payable'].includes(c.status)).reduce((s,c)=>s+c.amount_cents,0)??0)]].map(([label,value])=><div className="card" key={label}><small>{label}</small><h2>{value}</h2></div>)}</div>
    <section className="card"><h2>Ajouter un prospect</h2><form action={addProspect} className="stack"><div className="grid"><label>Entreprise<input name="company" required /></label><label>Contact<input name="contact_name" required /></label><label>Email<input type="email" name="email" required /></label><label>Téléphone<input name="phone" /></label></div><label>Offre envisagée<select name="offer_id" required>{available.map((o:any)=><option key={o.id} value={o.id}>{o.name}{!o.fixed_price?' · chiffrage Ortek requis':''}</option>)}</select></label><label>Notes<textarea name="notes" /></label><button>Ajouter un prospect</button></form></section>
    <section className="card"><h2>Prospects fournis par Ortek</h2><p>Ce portefeuille vous est attribué exclusivement. Ajoutez le nom et l’email du contact pour le convertir en prospect.</p>{pool?.map(l=><div className="card" key={l.id}><strong>{l.company}</strong> · {l.city} · {l.status}<p>{l.website&&<a href={l.website} target="_blank" rel="noreferrer">Site web</a>} {l.phone} {l.email}</p><form action={updateLead}><input type="hidden" name="id" value={l.id}/><input type="hidden" name="status" value="contacted"/><button>Marquer contacté</button></form><form action={convertLead} className="grid"><input type="hidden" name="lead_id" value={l.id}/><input type="hidden" name="company" value={l.company}/><label>Contact<input name="contact_name" required/></label><label>Email<input name="email" type="email" defaultValue={l.email??''} required/></label><label>Téléphone<input name="phone" defaultValue={l.phone??''}/></label><label>Offre<select name="offer_id">{available.map((o:any)=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label><button>Convertir</button></form></div>)}</section>
    <section className="card"><h2>Mes prospects</h2><table><thead><tr><th>Entreprise</th><th>Contact</th><th>Statut</th><th>Action</th></tr></thead><tbody>{leads?.map(lead=><tr key={lead.id}><td>{lead.company}</td><td>{lead.contact_name}<br/><small>{lead.email}</small></td><td>{lead.status}</td><td><form action={createQuote}><input type="hidden" name="prospect_id" value={lead.id}/><button>Créer et envoyer le devis</button></form></td></tr>)}</tbody></table></section>
    <section className="card"><h2>Devis</h2><table><thead><tr><th>Numéro</th><th>Statut</th><th>Date</th></tr></thead><tbody>{quotes?.map(q=><tr key={q.id}><td>#{q.number}</td><td>{q.status}</td><td>{new Date(q.created_at).toLocaleDateString('fr-FR')}</td></tr>)}</tbody></table></section>
    <section className="card"><h2>Paiements et commissions</h2><table><thead><tr><th>Paiement</th><th>Statut</th><th>Montant</th><th>Commission</th></tr></thead><tbody>{payments?.map(p=>{const c=commissions?.find(c=>c.payment_id===p.id);return <tr key={p.id}><td>{p.type}</td><td>{p.status}</td><td>{euros(p.amount_cents)}</td><td>{c?`${euros(c.amount_cents)} · ${c.status}`:'—'}</td></tr>})}</tbody></table></section>
  </>;
}
