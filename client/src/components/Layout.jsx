import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutGrid, Send, Package, Megaphone, Users, CalendarClock, BarChart3, Upload, Settings, LogOut, Menu, X, FileSpreadsheet, Layers,
} from 'lucide-react';
import { useAuth, useProduct } from '../lib/context.jsx';
import { api } from '../lib/api.js';
import { cx } from './ui.jsx';

const NAV = [
  { to: '/', label: 'Visão Geral', icon: LayoutGrid, end: true },
  { to: '/operacao', label: 'Minha Operação', icon: Send, badge: 'op' },
  { to: '/produtos', label: 'Produtos', icon: Package },
  { to: '/campanhas', label: 'Campanhas', icon: Megaphone },
  { to: '/contatos', label: 'Base de Contatos', icon: Users },
  { to: '/followups', label: 'Follow-ups', icon: CalendarClock, badge: 'fu' },
  { to: '/dashboard', label: 'Dashboard de Gestão', icon: BarChart3 },
  { to: '/relatorios', label: 'Relatórios', icon: FileSpreadsheet },
  { to: '/importacoes', label: 'Importações', icon: Upload, admin: true },
  { to: '/configuracoes', label: 'Configurações', icon: Settings },
];

function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <div className="size-8 rounded-lg bg-brand-600 flex items-center justify-center">
        <svg viewBox="0 0 32 32" className="size-5"><path d="M7 23 16 8l9 15" stroke="white" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /><circle cx="16" cy="19" r="2" fill="white" /></svg>
      </div>
      <div className="leading-tight">
        <p className="text-[15px] font-semibold tracking-tight text-ink">Aldeia Reativa</p>
        <p className="text-[11px] text-muted">Reativação comercial</p>
      </div>
    </div>
  );
}

export default function Layout() {
  const { user, isAdmin, logout } = useAuth();
  const { products, productId, setProductId } = useProduct();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const { data: queues } = useQuery({
    queryKey: ['queues', 'nav', productId],
    queryFn: () => api.get(`/participants/queues${productId ? `?product_id=${productId}` : ''}`),
    refetchInterval: 60000,
  });
  const badge = (k) => {
    if (!queues) return null;
    if (k === 'op') return queues.para_enviar + queues.followups_hoje + queues.atrasados || null;
    if (k === 'fu') return queues.atrasados ? { n: queues.atrasados, danger: true } : queues.followups_hoje || null;
    return null;
  };

  const sidebar = (
    <nav className="flex flex-col h-full">
      <div className="h-16 flex items-center px-3 border-b border-line"><Logo /></div>
      <div className="px-3 pt-4 pb-2">
        <label className="text-[11px] font-medium uppercase tracking-wide text-muted px-1 flex items-center gap-1"><Layers className="size-3" />Produto</label>
        <select value={productId || ''} onChange={(e) => setProductId(Number(e.target.value) || null)}
          className="mt-1.5 w-full h-9 rounded-lg bg-stone-50 ring-1 ring-inset ring-line px-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-500">
          <option value="">Todos os produtos (consolidado)</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin px-3 py-2 space-y-0.5">
        {NAV.filter((n) => !n.admin || isAdmin).map((n) => {
          const b = n.badge ? badge(n.badge) : null;
          const count = typeof b === 'object' && b ? b.n : b;
          return (
            <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)}
              className={({ isActive }) => cx('flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-sm transition-colors',
                isActive ? 'bg-brand-50 text-brand-800 font-semibold' : 'text-ink/75 hover:bg-stone-100 hover:text-ink')}>
              <n.icon className="size-[18px] shrink-0" strokeWidth={1.9} />
              <span className="flex-1 truncate">{n.label}</span>
              {count ? <span className={cx('text-[11px] tabular rounded-full px-1.5 leading-5', typeof b === 'object' && b?.danger ? 'bg-rose-100 text-rose-700' : 'bg-stone-200/70 text-ink/70')}>{count}</span> : null}
            </NavLink>
          );
        })}
      </div>
      <div className="border-t border-line p-3">
        <div className="flex items-center gap-2.5 px-1">
          <div className="size-8 rounded-full bg-stone-200 flex items-center justify-center text-[13px] font-semibold text-ink/70">{user?.name?.[0]}</div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.name}</p>
            <p className="text-[11px] text-muted">{isAdmin ? 'Administradora' : 'Vendedora'}</p>
          </div>
          <button onClick={logout} title="Sair" className="p-1.5 rounded-md text-muted hover:text-ink hover:bg-stone-100"><LogOut className="size-4" /></button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-full">
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-60 bg-white border-r border-line z-30">{sidebar}</aside>
      {open && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-white shadow-xl animate-slide-in">{sidebar}</aside>
        </div>
      )}
      <header className="lg:hidden sticky top-0 z-20 h-14 bg-white/90 backdrop-blur border-b border-line flex items-center justify-between px-4">
        <button onClick={() => setOpen(true)} className="p-1.5 -ml-1.5 rounded-md" aria-label="Menu"><Menu className="size-5" /></button>
        <Logo />
        <span className="w-6" />
      </header>
      <main className="lg:pl-60">
        <div key={loc.pathname} className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8 py-6 animate-fade-in">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export { X };
