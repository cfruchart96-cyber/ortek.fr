import { NextRequest,NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';import { serviceClient } from '@/lib/supabase';import { pdfBytes,sha256 } from '@/lib/quote';
export async function GET(_request:NextRequest,{params}:{params:Promise<{id:string}>}){
  await requireRole('admin');const {id}=await params;const {data:q}=await serviceClient().from('quotes').select('pdf_path,pdf_sha256,number').eq('id',id).single();
  if(!q)return new NextResponse(null,{status:404});const bytes=await pdfBytes(q.pdf_path);if(sha256(bytes)!==q.pdf_sha256)return new NextResponse(null,{status:409});
  return new NextResponse(Buffer.from(bytes),{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="devis-${q.number}.pdf"`,'Cache-Control':'private,no-store'}});
}
