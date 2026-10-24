import { NextRequest, NextResponse } from 'next/server';
import { userClient } from '@/lib/supabase';
export async function GET(request: NextRequest){
  const code=request.nextUrl.searchParams.get('code');
  if(code) await (await userClient()).auth.exchangeCodeForSession(code);
  return NextResponse.redirect(new URL(request.nextUrl.searchParams.get('activate')==='1'?'/activate':'/login',request.url));
}
