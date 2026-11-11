import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/context.jsx';
import { Button, Input, Field, Alert, Loading } from '../components/ui.jsx';

function Shell({ title, subtitle, children }) {
  return (
    <div className="min-h-full flex items-center justify-center px-4 py-10 bg-canvas">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 mb-8 justify-center">
          <div className="size-10 rounded-xl bg-brand-600 flex items-center justify-center">
            <svg viewBox="0 0 32 32" className="size-6"><path d="M7 23 16 8l9 15" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /><circle cx="16" cy="19" r="2" fill="white" /></svg>
          </div>
          <div><p className="font-semibold tracking-tight text-lg leading-tight">Aldeia Reativa</p><p className="text-xs text-muted">Aldeia Coworking</p></div>
        </div>
        <div className="bg-white rounded-2xl ring-1 ring-line shadow-sm p-6">
          <h1 className="text-lg font-semibold">{title}</h1>
          {subtitle && <p className="text-sm text-muted mt-1">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function Login() {
  const { refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try { await api.post('/auth/login', { email, password }); await refresh(); } catch (err) { setError(err.message); } finally { setLoading(false); }
  };
  return (
    <Shell title="Entrar" subtitle="Acesse com seu e-mail e senha.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="E-mail"><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
        <Field label="Senha"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button variant="primary" className="w-full" size="lg" loading={loading}>Entrar</Button>
        <p className="text-center text-sm"><Link to="/esqueci-senha" className="text-brand-700 hover:underline">Esqueci minha senha</Link></p>
      </form>
    </Shell>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setLoading(true);
    try { const r = await api.post('/auth/forgot', { email }); setMsg(r.message); } catch (err) { setMsg(err.message); } finally { setLoading(false); }
  };
  return (
    <Shell title="Recuperar acesso" subtitle="Informe seu e-mail cadastrado.">
      {msg ? <Alert tone="success">{msg}</Alert> : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="E-mail"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
          <Button variant="primary" className="w-full" loading={loading}>Solicitar redefinição</Button>
        </form>
      )}
      <p className="text-center text-sm mt-4"><Link to="/" className="text-brand-700 hover:underline">Voltar ao login</Link></p>
    </Shell>
  );
}

const rules = 'Mínimo de 10 caracteres, combinando letras e números.';

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const nav = useNavigate();
  const { data, error, isLoading } = useQuery({ queryKey: ['reset', token], queryFn: () => api.get(`/auth/reset/${encodeURIComponent(token)}`), retry: false });
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [err, setErr] = useState(''); const [done, setDone] = useState(false); const [loading, setLoading] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (pw !== pw2) return setErr('As senhas não conferem.');
    setLoading(true);
    try { await api.post('/auth/reset', { token, newPassword: pw }); setDone(true); } catch (e2) { setErr(e2.message); } finally { setLoading(false); }
  };
  if (isLoading) return <Loading />;
  return (
    <Shell title="Definir nova senha" subtitle={data ? `Olá, ${data.name.split(' ')[0]}!` : undefined}>
      {error ? <Alert tone="danger">{error.message}</Alert> : done ? (
        <div className="space-y-4"><Alert tone="success">Senha definida com sucesso.</Alert><Button variant="primary" className="w-full" onClick={() => nav('/')}>Ir para o login</Button></div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Nova senha" hint={rules}><Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></Field>
          <Field label="Confirmar nova senha"><Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required /></Field>
          {err && <Alert tone="danger">{err}</Alert>}
          <Button variant="primary" className="w-full" loading={loading}>Salvar senha</Button>
        </form>
      )}
    </Shell>
  );
}

export function ChangePassword({ forced }) {
  const { refresh, logout, user } = useAuth();
  const [cur, setCur] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [err, setErr] = useState(''); const [ok, setOk] = useState(false); const [loading, setLoading] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (pw !== pw2) return setErr('As senhas não conferem.');
    setLoading(true);
    try { await api.post('/auth/change-password', { currentPassword: cur, newPassword: pw }); setOk(true); setCur(''); setPw(''); setPw2(''); await refresh(); } catch (e2) { setErr(e2.message); } finally { setLoading(false); }
  };
  const form = (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Senha atual"><Input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required /></Field>
      <Field label="Nova senha" hint={rules}><Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></Field>
      <Field label="Confirmar nova senha"><Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required /></Field>
      {err && <Alert tone="danger">{err}</Alert>}
      {ok && !forced && <Alert tone="success">Senha alterada.</Alert>}
      <Button variant="primary" className={forced ? 'w-full' : ''} loading={loading}>Salvar nova senha</Button>
    </form>
  );
  if (!forced) return form;
  return (
    <Shell title="Defina sua senha" subtitle={`Olá, ${user?.name?.split(' ')[0]}! No primeiro acesso, crie uma senha pessoal.`}>
      {form}
      <p className="text-center text-sm mt-4"><button onClick={logout} className="text-muted hover:underline">Sair</button></p>
    </Shell>
  );
}
