import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/context.jsx';
import { Button, Input, Field, Alert, Loading } from '../components/ui.jsx';
import { Logo } from '../components/Layout.jsx';

function Shell({ title, subtitle, children }) {
  return (
    <div className="min-h-full grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] bg-canvas">
      <aside className="hidden lg:flex flex-col justify-between bg-side text-[#fff] border-l-[6px] border-brand-500 px-12 py-12">
        <Logo dark size={48} />
        <div className="max-w-md">
          <span className="block w-10 h-[5px] bg-brand-500 mb-5" />
          <p className="font-display text-[40px] leading-[1.05] font-extrabold tracking-[-0.03em]">Leads antigos,<br />novas oportunidades.</p>
          <p className="text-side-text mt-4 text-[15px] leading-relaxed">Base comercial permanente, campanhas de reativação e acompanhamento da operação de vendas da Aldeia.</p>
        </div>
        <p className="text-[12px] text-side-faint">Aldeia Coworking · uso interno</p>
      </aside>
      <div className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex justify-center mb-8"><Logo /></div>
          <div className="bg-white rounded-2xl ring-1 ring-line p-6">
            <h1 className="page-title font-display text-[24px] font-extrabold tracking-[-0.02em]">{title}</h1>
            {subtitle && <p className="text-sm text-muted mt-1">{subtitle}</p>}
            <div className="mt-5">{children}</div>
          </div>
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
  const doLogin = async (em, pw) => {
    setError(''); setLoading(true);
    try { await api.post('/auth/login', { email: em, password: pw }); await refresh(); } catch (err) { setError(err.message); } finally { setLoading(false); }
  };
  const submit = (e) => { e.preventDefault(); doLogin(email, password); };
  const testUsers = window.__ALDEIA_TESTE__?.users;
  return (
    <Shell title="Entrar" subtitle="Acesse com seu e-mail e senha.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="E-mail"><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
        <Field label="Senha"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button variant="primary" className="w-full" size="lg" loading={loading}>Entrar</Button>
        <p className="text-center text-sm"><Link to="/esqueci-senha" className="text-brand-700 hover:underline">Esqueci minha senha</Link></p>
      </form>
      {testUsers && (
        <div className="mt-6 pt-5 border-t border-line">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Versão de testes · entrar como</p>
          <div className="mt-2 grid gap-2">
            {testUsers.map((u) => (
              <button key={u.email} type="button" disabled={loading} onClick={() => { setEmail(u.email); setPassword(u.password); doLogin(u.email, u.password); }}
                className="text-left rounded-xl ring-1 ring-line px-3 py-2 hover:ring-ink hover:bg-brand-50 disabled:opacity-50">
                <span className="text-sm font-medium block">{u.label}</span>
                <span className="text-[12px] text-muted">{u.email} · {u.password}</span>
              </button>
            ))}
          </div>
        </div>
      )}
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

/** Primeiro acesso ao site: cria a conta da administradora (só aparece enquanto não existe nenhuma usuária). */
export function FirstAccess({ codeRequired }) {
  const { refresh } = useAuth();
  const [f, setF] = useState({ name: '', email: '', password: '', password2: '', code: '' });
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    if (f.password !== f.password2) return setErr('As senhas não conferem.');
    setLoading(true);
    try { await api.post('/auth/setup', { name: f.name, email: f.email, password: f.password, code: f.code || undefined }); await refresh(); } catch (e2) { setErr(e2.message); } finally { setLoading(false); }
  };
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Shell title="Primeiro acesso" subtitle="Crie a conta da administradora. Depois, convide a equipe em Configurações › Usuárias.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Seu nome"><Input value={f.name} onChange={up('name')} required autoFocus /></Field>
        <Field label="E-mail (será o seu login)"><Input type="email" autoComplete="username" value={f.email} onChange={up('email')} required /></Field>
        <Field label="Senha" hint={rules}><Input type="password" autoComplete="new-password" value={f.password} onChange={up('password')} required /></Field>
        <Field label="Confirmar senha"><Input type="password" autoComplete="new-password" value={f.password2} onChange={up('password2')} required /></Field>
        {codeRequired && <Field label="Código de instalação" hint="Fica nas configurações do servidor (variável SETUP_CODE)."><Input value={f.code} onChange={up('code')} required /></Field>}
        {err && <Alert tone="danger">{err}</Alert>}
        <Button variant="primary" className="w-full" size="lg" loading={loading}>Criar conta e entrar</Button>
      </form>
    </Shell>
  );
}
