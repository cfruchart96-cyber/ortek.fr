import { Resend } from 'resend';
import { serviceClient } from './supabase';

export async function notify(key: string, to: string, subject: string, body: string) {
  const db = serviceClient();
  const { data, error } = await db.from('notification_outbox').upsert({ dedupe_key: key, recipient: to, subject, body }, { onConflict: 'dedupe_key', ignoreDuplicates: true }).select('id,sent_at').maybeSingle();
  if (error) throw error;
  const pending = data ?? (await db.from('notification_outbox').select('id,sent_at').eq('dedupe_key',key).single()).data;
  if (!pending || pending.sent_at) return;
  if (!process.env.RESEND_API_KEY || !process.env.PORTAL_FROM_EMAIL) return;
  const result = await new Resend(process.env.RESEND_API_KEY).emails.send({ from: process.env.PORTAL_FROM_EMAIL, to, subject, text: body, headers: { 'X-Entity-Ref-ID': key } }, { idempotencyKey: key });
  if (result.error) throw new Error(result.error.message);
  await db.from('notification_outbox').update({ sent_at: new Date().toISOString() }).eq('id',pending.id);
}
