import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createHash, randomBytes } from 'node:crypto';
import { serviceClient } from './supabase';
import { euros } from './money';

export function sha256(value:string|Uint8Array){return createHash('sha256').update(value).digest('hex');}
export function token(){return randomBytes(32).toString('base64url');}
export async function createPdf(snapshot: Record<string, any>, number: number) {
  const pdf=await PDFDocument.create();const page=pdf.addPage([595,842]);const font=await pdf.embedFont(StandardFonts.Helvetica);const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const text=(str:string,x:number,y:number,size=11,heavy=false)=>page.drawText(str.replace(/[^\x20-\x7e\u00a0-\u00ff]/g,'?').slice(0,95),{x,y,size,font:heavy?bold:font,color:rgb(.09,.16,.30)});
  text('ORTEK',40,790,24,true);text(`DEVIS N° ${number}`,40,755,17,true);
  text(snapshot.legal.name,40,718);text(snapshot.legal.address,40,699);text(`SIRET : ${snapshot.legal.registration}`,40,680);text(snapshot.legal.email,40,661);
  text('CLIENT',40,618,13,true);text(snapshot.client.company,40,597);text(snapshot.client.name,40,578);text(snapshot.client.email,40,559);
  text('PRESTATION',40,514,13,true);text(snapshot.offer.name,40,493,12,true);text(snapshot.offer.description,40,474);
  text(`Creation : ${euros(snapshot.offer.setup_cents)}`,40,447,12);text(`Abonnement : ${euros(snapshot.offer.monthly_cents)} / mois`,40,425,12);
  text(`Valable jusqu'au : ${new Date(snapshot.expires_at).toLocaleDateString('fr-FR')}`,40,388);
  text(snapshot.legal.vat_notice,40,359);
  let y=320; text('CONDITIONS CONTRACTUELLES',40,y,12,true);
  for(const line of snapshot.legal.terms.match(/.{1,80}(?:\s|$)/g)??[]){y-=18;if(y<60)break;text(line.trim(),40,y,9);}
  text('Acceptation et paiement selon les liens sécurisés transmis séparément.',40,45,9);
  return new Uint8Array(await pdf.save());
}

export async function pdfBytes(path:string) {
  const {data,error}=await serviceClient().storage.from('quotes').download(path);
  if(error||!data)throw new Error('Document introuvable');return new Uint8Array(await data.arrayBuffer());
}
