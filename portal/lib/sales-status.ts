export type SaleStage = 'draft'|'awaiting_acceptance'|'refused'|'expired'|'awaiting_payment'|'payment_link'|'payment_failed'|'payment_confirmed';

export function saleStage(quoteStatus:string, latestInvoiceStatus:'failed'|'paid'|null, checkoutCreated:boolean, hasPaidInvoice:boolean):SaleStage {
  if(quoteStatus==='draft')return 'draft';
  if(quoteStatus==='refused')return 'refused';
  if(quoteStatus==='expired')return 'expired';
  if(quoteStatus==='sent')return 'awaiting_acceptance';
  if(quoteStatus!=='accepted')return 'draft';
  if(latestInvoiceStatus==='failed')return 'payment_failed';
  if(latestInvoiceStatus==='paid'||hasPaidInvoice)return 'payment_confirmed';
  return checkoutCreated?'payment_link':'awaiting_payment';
}

export const saleStageLabels:Record<SaleStage,string>={
  draft:'Devis en préparation',
  awaiting_acceptance:'Devis envoyé · accord client attendu',
  refused:'Devis refusé',
  expired:'Devis expiré',
  awaiting_payment:'Devis accepté · paiement attendu',
  payment_link:'Lien de paiement créé · confirmation Stripe attendue',
  payment_failed:'Paiement échoué · aucune commission sur cette tentative',
  payment_confirmed:'Paiement confirmé par Stripe'
};
