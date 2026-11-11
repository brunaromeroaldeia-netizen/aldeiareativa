import { createContext, forwardRef, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { X, Loader2, ChevronLeft, ChevronRight, Check, AlertTriangle, Info, CircleAlert } from 'lucide-react';
import { STATUS, HIST, CAMPAIGN_STATUS } from '../lib/format.js';

export const cx = (...a) => a.filter(Boolean).join(' ');

export function Button({ variant = 'secondary', size = 'md', loading, icon: Icon, children, className, ...props }) {
  const v = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm disabled:bg-brand-600/50',
    secondary: 'bg-white text-ink ring-1 ring-inset ring-line hover:bg-stone-50 shadow-xs disabled:text-muted',
    ghost: 'text-muted hover:text-ink hover:bg-stone-100',
    danger: 'bg-white text-rose-700 ring-1 ring-inset ring-rose-200 hover:bg-rose-50',
    dark: 'bg-ink text-white hover:bg-black',
  }[variant];
  const s = { sm: 'h-8 px-2.5 text-[13px] gap-1.5', md: 'h-9 px-3.5 text-sm gap-2', lg: 'h-11 px-5 text-[15px] gap-2' }[size];
  return (
    <button className={cx('inline-flex items-center justify-center rounded-lg font-medium transition-colors whitespace-nowrap disabled:cursor-not-allowed', v, s, className)}
      disabled={loading || props.disabled} {...props}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : Icon ? <Icon className="size-4 shrink-0" strokeWidth={2} /> : null}
      {children}
    </button>
  );
}

export function Card({ className, children, ...p }) {
  return <div className={cx('rounded-xl bg-white ring-1 ring-line shadow-[0_1px_2px_rgba(0,0,0,0.03)]', className)} {...p}>{children}</div>;
}

export function CardHeader({ title, subtitle, actions, className }) {
  return (
    <div className={cx('flex items-start justify-between gap-3 px-5 pt-4 pb-3', className)}>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        {subtitle && <p className="text-[13px] text-muted mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function Badge({ className, children }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium ring-1 ring-inset whitespace-nowrap', className)}>{children}</span>;
}
export const StatusBadge = ({ status, long }) => <Badge className={STATUS[status]?.cls}>{long ? STATUS[status]?.long : STATUS[status]?.label || status}</Badge>;
export const HistBadge = ({ status }) => (status ? <Badge className={HIST[status]?.cls}>{HIST[status]?.label}</Badge> : <span className="text-muted">—</span>);
export const CampaignBadge = ({ status }) => <Badge className={CAMPAIGN_STATUS[status]?.cls}>{CAMPAIGN_STATUS[status]?.label}</Badge>;
export function DemoTag() { return <Badge className="bg-amber-50 text-amber-800 ring-amber-200">Exemplo</Badge>; }

export function Field({ label, hint, error, children, className }) {
  return (
    <label className={cx('block', className)}>
      {label && <span className="block text-[13px] font-medium text-ink mb-1">{label}</span>}
      {children}
      {hint && !error && <span className="block text-[12px] text-muted mt-1">{hint}</span>}
      {error && <span className="block text-[12px] text-rose-600 mt-1">{error}</span>}
    </label>
  );
}

const widthOf = (c) => (/(^|\s)(!?w-|max-w-|flex-1)/.test(c || '') ? '' : 'w-full ');
const inputCls = 'rounded-lg bg-white ring-1 ring-inset ring-line px-3 h-9 text-sm text-ink placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-stone-50';
export const Input = forwardRef(({ className, ...p }, ref) => <input ref={ref} className={cx(widthOf(className) + inputCls, className)} {...p} />);
export const Textarea = forwardRef(({ className, ...p }, ref) => <textarea ref={ref} className={cx('w-full', inputCls, 'h-auto py-2 leading-relaxed', className)} {...p} />);
export function Select({ className, children, ...p }) {
  return <select className={cx(widthOf(className) + inputCls, 'pr-8 appearance-none bg-[url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2020%2020%27%20fill=%27%236b6a65%27%3E%3Cpath%20d=%27M5.5%207.5l4.5%204.5%204.5-4.5%27%20stroke=%27%236b6a65%27%20stroke-width=%271.5%27%20fill=%27none%27/%3E%3C/svg%3E")] bg-no-repeat bg-[right_0.5rem_center] bg-[length:1rem]', className)} {...p}>{children}</select>;
}

export function Checkbox({ checked, onChange, label, className, disabled }) {
  return (
    <label className={cx('inline-flex items-center gap-2 text-sm cursor-pointer select-none', disabled && 'opacity-50 cursor-not-allowed', className)}>
      <input type="checkbox" className="size-4 rounded border-stone-300 accent-brand-600" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** Seleção múltipla em "chips". */
export function ChipSelect({ options, value = [], onChange, className }) {
  const toggle = (v) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div className={cx('flex flex-wrap gap-1.5', className)}>
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button type="button" key={String(o.value)} onClick={() => toggle(o.value)}
            className={cx('h-8 px-3 rounded-full text-[13px] ring-1 ring-inset transition-colors inline-flex items-center gap-1.5',
              on ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-ink ring-line hover:bg-stone-50')}>
            {on && <Check className="size-3.5" />}{o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Spinner({ className }) { return <Loader2 className={cx('size-5 animate-spin text-muted', className)} />; }
export function Loading({ label = 'Carregando…' }) {
  return <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted"><Spinner />{label}</div>;
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      {Icon && <div className="size-11 rounded-full bg-stone-100 flex items-center justify-center mb-3"><Icon className="size-5 text-muted" /></div>}
      <p className="font-medium text-ink">{title}</p>
      {children && <p className="text-sm text-muted mt-1 max-w-md">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({ tone = 'info', children, className, title }) {
  const t = {
    info: ['bg-sky-50 text-sky-900 ring-sky-200', Info],
    warning: ['bg-amber-50 text-amber-900 ring-amber-200', AlertTriangle],
    danger: ['bg-rose-50 text-rose-900 ring-rose-200', CircleAlert],
    success: ['bg-emerald-50 text-emerald-900 ring-emerald-200', Check],
  }[tone];
  const Icon = t[1];
  return (
    <div className={cx('flex gap-2.5 rounded-lg px-3 py-2.5 text-[13px] ring-1 ring-inset', t[0], className)}>
      <Icon className="size-4 shrink-0 mt-0.5" />
      <div className="min-w-0">{title && <p className="font-semibold">{title}</p>}{children}</div>
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className={cx('relative w-full bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] flex flex-col', w)}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="font-semibold text-ink">{title}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink p-1 rounded-md" aria-label="Fechar"><X className="size-5" /></button>
        </div>
        <div className="px-5 py-4 overflow-y-auto scroll-thin">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-line flex justify-end gap-2 bg-stone-50/60 rounded-b-2xl">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, children, width = 'max-w-2xl' }) {
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/20 animate-fade-in" onClick={onClose} />
      <aside className={cx('relative h-full w-full bg-white shadow-2xl flex flex-col animate-slide-in', width)}>{children}</aside>
    </div>
  );
}

export function Tabs({ tabs, value, onChange, className }) {
  return (
    <div className={cx('flex gap-1 overflow-x-auto scroll-thin border-b border-line', className)}>
      {tabs.map((t) => (
        <button key={t.value} onClick={() => onChange(t.value)}
          className={cx('relative h-10 px-3 text-sm whitespace-nowrap font-medium transition-colors inline-flex items-center gap-2',
            value === t.value ? 'text-ink' : 'text-muted hover:text-ink')}>
          {t.icon && <t.icon className="size-4" />}
          {t.label}
          {t.count !== undefined && t.count !== null && (
            <span className={cx('rounded-full px-1.5 text-[11px] tabular leading-5', t.tone === 'danger' && t.count ? 'bg-rose-100 text-rose-700' : t.tone === 'warning' && t.count ? 'bg-amber-100 text-amber-800' : 'bg-stone-100 text-muted')}>{t.count}</span>
          )}
          {value === t.value && <span className="absolute left-2 right-2 -bottom-px h-0.5 bg-brand-600 rounded-full" />}
        </button>
      ))}
    </div>
  );
}

export function Kpi({ label, value, sub, onClick, tone, hint }) {
  const C = onClick ? 'button' : 'div';
  return (
    <C onClick={onClick} title={hint}
      className={cx('text-left rounded-xl bg-white ring-1 ring-line px-4 py-3.5 transition-shadow min-w-0', onClick && 'hover:ring-brand-200 hover:shadow-sm cursor-pointer')}>
      <p className="text-[12.5px] text-muted leading-snug line-clamp-2">{label}</p>
      <p className={cx('text-[22px] font-semibold tabular tracking-tight mt-0.5', tone === 'danger' ? 'text-rose-600' : tone === 'brand' ? 'text-brand-700' : 'text-ink')}>{value}</p>
      {sub && <p className="text-[12px] text-muted mt-0.5 leading-snug line-clamp-2">{sub}</p>}
    </C>
  );
}

export function Pagination({ page, total, pageSize, onChange }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return <p className="text-[13px] text-muted px-4 py-3">{total} registro(s)</p>;
  return (
    <div className="flex items-center justify-between px-4 py-3 text-[13px] text-muted border-t border-line">
      <span>{(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} de {total.toLocaleString('pt-BR')}</span>
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" icon={ChevronLeft} disabled={page <= 1} onClick={() => onChange(page - 1)}>Anterior</Button>
        <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => onChange(page + 1)}>Próxima<ChevronRight className="size-4" /></Button>
      </div>
    </div>
  );
}

export function Progress({ value, max, className, tone = 'brand' }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className={cx('h-1.5 rounded-full bg-stone-100 overflow-hidden', className)}>
      <div className={cx('h-full rounded-full transition-all', tone === 'brand' ? 'bg-brand-500' : 'bg-amber-500')} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, children }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-5">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="text-sm text-muted mt-0.5">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------------- Toasts ----------------
const ToastCtx = createContext(null);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const idRef = useRef(0);
  const push = useCallback((msg, tone = 'success') => {
    const id = ++idRef.current;
    setItems((x) => [...x, { id, msg, tone }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), tone === 'error' ? 6000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 sm:left-auto sm:right-4 sm:translate-x-0 z-[60] flex flex-col gap-2 w-[calc(100%-2rem)] sm:w-auto">
        {items.map((t) => (
          <div key={t.id} className={cx('rounded-lg px-4 py-2.5 text-sm shadow-lg animate-fade-in flex items-center gap-2 sm:max-w-sm',
            t.tone === 'error' ? 'bg-rose-600 text-white' : 'bg-ink text-white')}>
            {t.tone === 'error' ? <CircleAlert className="size-4 shrink-0" /> : <Check className="size-4 shrink-0" />}
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------------- Confirmação ----------------
export function useConfirm() {
  const [state, setState] = useState(null);
  const confirm = (opts) => new Promise((resolve) => setState({ ...opts, resolve }));
  const close = (v) => { state?.resolve(v); setState(null); };
  const dialog = (
    <Modal open={!!state} onClose={() => close(false)} title={state?.title || 'Confirmar'} size="sm"
      footer={<><Button onClick={() => close(false)}>Cancelar</Button><Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{state?.confirmLabel || 'Confirmar'}</Button></>}>
      <p className="text-sm text-ink/80 whitespace-pre-line">{state?.message}</p>
    </Modal>
  );
  return [confirm, dialog];
}
