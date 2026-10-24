import { NextRequest,NextResponse } from 'next/server';import { serviceClient } from '@/lib/supabase';import { notify } from '@/lib/email';
export async function POST(request:NextRequest){
  if(!process.env.CRON_SECRET||request.headers.get('authorization')!==`Bearer ${process.env.CRON_SECRET}`)return new NextResponse(null,{status:401});
  const {data,error}=await serviceClient().from('notification_outbox').select('dedupe_key,recipient,subject,body').is('sent_at',null).order('created_at').limit(50);
  if(error)return new NextResponse(null,{status:503});let sent=0;
  for(const n of data??[]){try{await notify(n.dedupe_key,n.recipient,n.subject,n.body);sent++;}catch{ /* Remains queued for next retry. */ }}
  return NextResponse.json({attempted:data?.length??0,sent});
}
