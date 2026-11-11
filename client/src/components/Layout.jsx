import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutGrid, Send, Package, Megaphone, Users, CalendarClock, BarChart3, Upload, Settings, LogOut, Menu, X, FileSpreadsheet, Layers, ListChecks, TriangleAlert,
} from 'lucide-react';
import { useAuth, useProduct } from '../lib/context.jsx';
import { api } from '../lib/api.js';
import { cx } from './ui.jsx';

const GROUPS = [
  { title: 'Operação', items: [
    { to: '/', label: 'Visão Geral', icon: LayoutGrid, end: true },
    { to: '/operacao', label: 'Minha Operação', icon: Send, badge: 'op' },
    { to: '/followups', label: 'Follow-ups', icon: CalendarClock, badge: 'fu' },
  ] },
  { title: 'Comercial', items: [
    { to: '/campanhas', label: 'Campanhas', icon: Megaphone },
    { to: '/contatos', label: 'Base de Contatos', icon: Users },
    { to: '/produtos', label: 'Produtos', icon: Package },
  ] },
  { title: 'Resultados', items: [
    { to: '/dashboard', label: 'Dashboard de Gestão', icon: BarChart3 },
    { to: '/relatorios', label: 'Relatórios', icon: FileSpreadsheet },
  ] },
  { title: 'Administração', items: [
    { to: '/importacoes', label: 'Importações', icon: Upload, admin: true },
    { to: '/configuracoes', label: 'Configurações', icon: Settings },
  ] },
];
const TEST_GROUP = { title: 'Versão de testes', items: [{ to: '/guia-de-testes', label: 'Guia de testes', icon: ListChecks }] };

/** Marca Aldeia: logo + nome do sistema. `dark` = sobre o menu preto. */
export function Logo({ dark, size = 40 }) {
  return (
    <div className="flex items-center gap-3">
      <span className={cx('logo-mask', dark ? 'text-[#fff]' : 'text-ink')} style={{ width: size, height: size }} aria-hidden="true" />
      <div className="leading-tight">
        <p className={cx('font-display text-[18px] font-extrabold tracking-[-0.02em]', dark ? 'text-[#fff]' : 'text-ink')}>Aldeia Reativa</p>
        <p className={cx('text-[11.5px]', dark ? 'text-side-faint' : 'text-muted')}>Aldeia Coworking</p>
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

  const IS_TEST = !!window.__ALDEIA_TESTE__; // versão de testes publicada
  const groups = IS_TEST ? [...GROUPS, TEST_GROUP] : GROUPS;
  const initials = (user?.name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  const sidebar = (
    <nav className="flex flex-col h-full bg-side text-[#fff] border-l-[6px] border-brand-500" aria-label="Navegação">
      <div className="px-4 pt-5 pb-3"><Logo dark /></div>
      <div className="px-4 pb-1">
        <label htmlFor="produto-global" className="text-[11px] font-bold uppercase tracking-[0.14em] text-side-faint flex items-center gap-1.5 py-2"><Layers className="size-3" />Produto</label>
        <select id="produto-global" value={productId || ''} onChange={(e) => setProductId(Number(e.target.value) || null)}
          className="w-full h-9 rounded-lg bg-side-hover text-[#fff] ring-1 ring-inset ring-side-line px-2.5 text-[13px] font-medium focus:outline-none focus:ring-2 focus:ring-brand-500 [color-scheme:dark]">
          <option value="">Todos os produtos (consolidado)</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin pb-3">
        {groups.map((g) => {
          const items = g.items.filter((n) => !n.admin || isAdmin);
          if (!items.length) return null;
          return (
            <div key={g.title}>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-side-faint px-5 pt-4 pb-1.5">{g.title}</p>
              {items.map((n) => {
                const b = n.badge ? badge(n.badge) : null;
                const count = typeof b === 'object' && b ? b.n : b;
                return (
                  <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)}
                    className={({ isActive }) => cx('group relative flex items-center gap-2.5 h-9 px-2.5 mx-2.5 my-px rounded-lg text-[14px] font-medium transition-colors',
                      isActive ? 'bg-side-on text-[#fff]' : 'text-side-text hover:bg-side-hover hover:text-[#fff]')}>
                    {({ isActive }) => (
                      <>
                        {isActive && <span className="absolute -left-2.5 top-[7px] bottom-[7px] w-[3px] rounded-r bg-brand-500" />}
                        <n.icon className={cx('size-[18px] shrink-0', isActive && 'text-brand-500')} strokeWidth={1.9} />
                        <span className="flex-1 truncate">{n.label}</span>
                        {count ? <span className={cx('text-[10.5px] font-bold tabular rounded-full px-1.5 leading-[18px]', typeof b === 'object' && b?.danger ? 'bg-[#C0261C] text-[#fff]' : 'ring-1 ring-[#3A3A3A] text-side-faint')}>{count}</span> : null}
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          );
        })}
      </div>
      {IS_TEST && (
        <div className="mx-3.5 mb-3 flex gap-2 rounded-[9px] bg-[rgba(255,194,14,.1)] px-3 py-2.5 text-[12px] leading-snug text-brand-500">
          <TriangleAlert className="size-4 shrink-0 mt-px" />
          <span>Ambiente de testes: dados fictícios, salvos apenas neste navegador. Nenhuma mensagem é enviada.</span>
        </div>
      )}
      <div className="border-t border-side-line px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="size-8 rounded-full bg-brand-500 text-[#111] grid place-items-center text-[11.5px] font-bold">{initials}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate text-[#fff]">{user?.name}</p>
            <p className="text-[11.5px] text-side-faint">{isAdmin ? 'Administradora' : 'Vendedora'}</p>
          </div>
          <button onClick={logout} title="Sair" className="p-1.5 rounded-md text-side-faint hover:text-[#fff] hover:bg-side-hover"><LogOut className="size-4" /></button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-full">
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-[258px] z-30">{sidebar}</aside>
      {open && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-[284px] shadow-xl animate-slide-in">{sidebar}</aside>
        </div>
      )}
      <header className="lg:hidden sticky top-0 z-20 h-14 bg-side border-l-[6px] border-brand-500 flex items-center justify-between px-4">
        <button onClick={() => setOpen(true)} className="p-1.5 -ml-1.5 rounded-md text-[#fff]" aria-label="Abrir menu"><Menu className="size-5" /></button>
        <Logo dark size={30} />
        <span className="w-6" />
      </header>
      <main className="lg:pl-[258px]">
        <div key={loc.pathname} className="mx-auto max-w-[1380px] px-4 sm:px-6 lg:px-7 pt-7 pb-14 animate-fade-in">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export { X };
