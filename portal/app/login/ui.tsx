'use client';
import { createBrowserClient } from '@supabase/ssr';
import { useState } from 'react';

const auth = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
export default function Login() {
  const [step,setStep] = useState<'login'|'mfa'>('login');
  const [error,setError] = useState('');
  const [factor,setFactor] = useState('');
  const [qr,setQr] = useState('');
  async function route() {
    const client=auth();
    const {data:{user}}=await client.auth.getUser();
    const {data:profile}=await client.from('profiles').select('role,status').eq('id',user?.id).single();
    if(profile?.status!=='active'){setError('Compte inactif ou invitation non configurée.');return;}
    if(profile.role==='admin'){
      const {data:assurance}=await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if(assurance?.currentLevel!=='aal2'){
        const {data:factors}=await client.auth.mfa.listFactors();
        const current=factors?.totp.find(f=>f.status==='verified');
        if(current)setFactor(current.id);
        else { const {data,error:enrollmentError}=await client.auth.mfa.enroll({factorType:'totp',friendlyName:'Ortek admin'}); if(enrollmentError){setError(enrollmentError.message);return;} setFactor(data!.id);setQr(data!.totp.qr_code); }
        setStep('mfa');return;
      }
    }
    window.location.assign(profile.role==='admin'?'/admin':'/commercial');
  }
  async function signIn(form:FormData){setError('');const {error}=await auth().auth.signInWithPassword({email:String(form.get('email')),password:String(form.get('password'))});if(error){setError('Identifiants invalides.');return;}await route();}
  async function verify(form:FormData){setError('');const client=auth();const challenge=await client.auth.mfa.challenge({factorId:factor});if(challenge.error){setError(challenge.error.message);return;}const result=await client.auth.mfa.verify({factorId:factor,challengeId:challenge.data.id,code:String(form.get('code'))});if(result.error){setError('Code incorrect.');return;}await route();}
  return <>{step==='login'?<form action={signIn} className="stack"><label>Email<input name="email" type="email" required autoComplete="email" /></label><label>Mot de passe<input name="password" type="password" required autoComplete="current-password" /></label><button>Se connecter</button></form>:<form action={verify} className="stack"><h2>Double authentification</h2>{qr&&<><p>Scannez ce code avec votre application d'authentification.</p><img src={qr} alt="Code QR MFA" width="180" height="180" /></>}<label>Code à 6 chiffres<input name="code" inputMode="numeric" pattern="[0-9]{6}" required /></label><button>Valider</button></form>}{error&&<p className="error" role="alert">{error}</p>}</>;
}
