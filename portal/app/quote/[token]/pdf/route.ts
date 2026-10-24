import { NextRequest, NextResponse } from 'next/server';
import { sha256, pdfBytes } from '@/lib/quote';
import { serviceClient } from '@/lib/supabase';
export async function GET(_request:NextRequest,{params}:{params:Promise<{token:string}>}){
  const {token}=await params;const {data:q}=await serviceClient().from('quotes').select('pdf_path,pdf_sha256').eq('token_hash',sha256(token)).single();
  if(!q||q.pdf_path.endsWith('pending'))return new NextResponse(null,{status:404});
  const bytes=await pdfBytes(q.pdf_path);if(sha256(bytes)!==q.pdf_sha256)return new NextResponse(null,{status:409});
  return new NextResponse(Buffer.from(bytes),{headers:{'Content-Type':'application/pdf','Content-Disposition':'inline; filename="devis-ortek.pdf"','Cache-Control':'private,no-store'}});
}
