export const STATUS = {
  pendente: { label: 'Pendente', long: 'Pendente de primeiro contato', cls: 'bg-stone-100 text-stone-700 ring-stone-200' },
  enviada: { label: 'Mensagem enviada', long: 'Mensagem enviada', cls: 'bg-sky-50 text-sky-800 ring-sky-200' },
  aguardando: { label: 'Aguardando resposta', long: 'Aguardando resposta', cls: 'bg-sky-50 text-sky-800 ring-sky-200' },
  followup_pendente: { label: 'Follow-up pendente', long: 'Follow-up pendente', cls: 'bg-amber-50 text-amber-800 ring-amber-200' },
  respondeu: { label: 'Respondeu', long: 'Cliente respondeu', cls: 'bg-violet-50 text-violet-800 ring-violet-200' },
  interesse: { label: 'Interesse', long: 'Demonstrou interesse', cls: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  retorno_futuro: { label: 'Retorno futuro', long: 'Quer conversar futuramente', cls: 'bg-indigo-50 text-indigo-800 ring-indigo-200' },
  negociacao: { label: 'Em negociação', long: 'Em negociação', cls: 'bg-teal-50 text-teal-800 ring-teal-200' },
  convertido: { label: 'Convertido', long: 'Convertido', cls: 'bg-brand-500 text-[#111] ring-brand-500 font-semibold' },
  sem_interesse: { label: 'Sem interesse', long: 'Sem interesse', cls: 'bg-stone-100 text-stone-500 ring-stone-200' },
  sem_resposta: { label: 'Sem resposta', long: 'Sem resposta após tentativas', cls: 'bg-stone-100 text-stone-500 ring-stone-200' },
  opt_out: { label: 'Não contatar', long: 'Não contatar / opt-out', cls: 'bg-rose-50 text-rose-700 ring-rose-200' },
};
export const STATUS_ORDER = ['pendente', 'enviada', 'aguardando', 'followup_pendente', 'respondeu', 'interesse', 'retorno_futuro', 'negociacao', 'convertido', 'sem_interesse', 'sem_resposta', 'opt_out'];

export const HIST = {
  ganho: { label: 'Ganho', cls: 'text-emerald-700 bg-emerald-50 ring-emerald-200' },
  perdido: { label: 'Perdido', cls: 'text-rose-700 bg-rose-50 ring-rose-200' },
  aberto: { label: 'Aberto', cls: 'text-sky-700 bg-sky-50 ring-sky-200' },
  revisao: { label: 'Revisão', cls: 'text-amber-800 bg-amber-50 ring-amber-200' },
};

export const CAMPAIGN_STATUS = {
  rascunho: { label: 'Rascunho', cls: 'bg-stone-100 text-stone-600 ring-stone-200' },
  ativa: { label: 'Ativa', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  pausada: { label: 'Pausada', cls: 'bg-amber-50 text-amber-800 ring-amber-200' },
  encerrada: { label: 'Encerrada', cls: 'bg-stone-200 text-stone-600 ring-stone-300' },
};

export const fmtInt = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('pt-BR'));
export const fmtPct = (n) => (n === null || n === undefined ? '—' : `${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
export const fmtMoney = (n, compact) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: compact ? 0 : 2 }));
export function fmtDate(d) {
  if (!d) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d.split('-').reverse().join('/');
  return new Date(d).toLocaleDateString('pt-BR');
}
export function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}
export function relDays(iso, today) {
  if (!iso) return '';
  const a = Date.parse(iso.slice(0, 10)); const b = Date.parse(today);
  const d = Math.round((a - b) / 86400000);
  if (d === 0) return 'hoje';
  if (d === 1) return 'amanhã';
  if (d === -1) return 'ontem';
  return d > 0 ? `em ${d} dias` : `há ${-d} dias`;
}
export const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
export function addDaysIso(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export const waLink = (phone) => {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length >= 10 ? `https://wa.me/55${d}` : null;
};
