import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export default function AuthPanel() {
  const client = supabase;
  const [email, setEmail] = useState('');
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!client) return;
    void client.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null));
    const { data } = client.auth.onAuthStateChange((_event, session) => setUserEmail(session?.user.email ?? null));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!client) return <span className="pill muted">Modo local</span>;
  if (userEmail) {
    return <button className="pill" onClick={() => void client.auth.signOut()}>Sair · {userEmail}</button>;
  }
  return (
    <form className="auth-inline" onSubmit={async (e) => {
      e.preventDefault();
      setStatus('Enviando…');
      const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
      setStatus(error ? error.message : 'Link enviado por e-mail.');
    }}>
      <input aria-label="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} type="email" required placeholder="Seu e-mail" />
      <button type="submit">Entrar</button>
      {status && <small>{status}</small>}
    </form>
  );
}
