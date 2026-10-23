import { redirect } from 'next/navigation';
import { serviceClient, userClient } from './supabase';

export async function requireRole(role: 'admin' | 'commercial') {
  const client = await userClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) redirect('/login');
  const { data: profile, error: profileError } = await serviceClient().from('profiles')
    .select('id,email,full_name,role,status').eq('id',user.id).single();
  if (profileError || profile?.status !== 'active' || profile.role !== role) redirect('/login?error=acces');
  if (role === 'admin') {
    const { data: assurance } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance?.currentLevel !== 'aal2') redirect('/login?error=mfa');
  }
  return profile as { id: string; email: string; full_name: string; role: string; status: string };
}

export async function audit(actor: string | null, type: string, id: string, action: string, details: Record<string, unknown> = {}) {
  const { error } = await serviceClient().from('audit_events').insert({ actor_id: actor, subject_type: type, subject_id: id, action, details });
  if (error) throw error;
}
