import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, List, Columns3, Inbox, X } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useAuth, useProduct } from '../lib/context.jsx';
import { STATUS, STATUS_ORDER, HIST, fmtDate } from '../lib/format.js';
import {
  Card, PageHeader, Tabs, Select, Input, StatusBadge, HistBadge, Progress, Pagination, EmptyState, Loading, Drawer, Button, cx, useToast, Badge,
} from '../components/ui.jsx';
import ParticipantPanel from '../components/ParticipantPanel.jsx';

export const METRIC_LABEL = {
  atribuidos: 'Atribuídos', trabalhados: 'Trabalhados', pendentes: 'Pendentes', enviados: 'Com envio confirmado', responderam: 'Responderam',
  interessados: 'Interessados', negociacoes: 'Negociações iniciadas', convertidos: 'Convertidos', sem_interesse: 'Sem interesse',
  sem_resposta: 'Sem resposta', aguardando_resposta: 'Aguardando resposta', opt_out: 'Opt-out', followups_atrasados: 'Follow-ups atrasados',
  followups_pendentes: 'Follow-ups pendentes',
};

export function useFilterOptions() {
  const { isAdmin } = useAuth();
  const { data: campaigns = [] } = useQuery({ queryKey: ['campaigns', 'options'], queryFn: () => api.get('/campaigns') });
  const { data: years = [] } = useQuery({ queryKey: ['years'], queryFn: () => api.get('/contacts/years'), staleTime: 300000 });
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => api.get('/users'), staleTime: 300000 });
  return { campaigns, years, sellers: users.filter((u) => u.role === 'vendedora'), isAdmin };
}

export default function Operation() {
  const [sp, setSp] = useSearchParams();
  const { productId, setProductId, products } = useProduct();
  const { isAdmin, user } = useAuth();
  const { campaigns, years, sellers } = useFilterOptions();
  const qc = useQueryClient();
  const toast = useToast();
  const [view, setView] = useState('lista');
  const [openId, setOpenId] = useState(null);
  const get = (k) => sp.get(k) || '';
  const set = (k, v) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); if (k !== 'page') n.delete('page'); setSp(n, { replace: true }); };
  const queue = get('queue');
  const page = Number(get('page')) || 1;

  const filters = {
    campaign_id: get('campaign_id'), product_id: productId || '', year: get('year'), hist: get('hist'), status: get('status'),
    seller: get('seller'), search: get('search'), metric: get('metric'), from: get('from'), to: get('to'),
    campaign_status: get('campaign_id') || get('metric') ? '' : 'ativa,pausada',
  };
  const listKey = ['participants', filters, queue, page];
  const { data, isLoading } = useQuery({ queryKey: listKey, queryFn: () => api.get(`/participants${qs({ ...filters, queue, page })}`), placeholderData: (prev) => prev });
  const { data: counts } = useQuery({ queryKey: ['queues', filters], queryFn: () => api.get(`/participants/queues${qs(filters)}`) });
  const { data: board } = useQuery({ queryKey: ['board', filters], queryFn: () => api.get(`/participants/board${qs(filters)}`), enabled: view === 'kanban' });

  const rows = data?.rows || [];
  const idx = rows.findIndex((r) => r.id === openId);
  const activeCampaigns = campaigns.filter((c) => c.status !== 'rascunho');

  const tabs = [
    { value: '', label: 'Todos', count: counts?.total },
    { value: 'para_enviar', label: 'Para enviar', count: counts?.para_enviar },
    { value: 'followups_hoje', label: 'Follow-ups de hoje', count: counts?.followups_hoje, tone: 'warning' },
    { value: 'atrasados', label: 'Atrasados', count: counts?.atrasados, tone: 'danger' },
    { value: 'aguardando', label: 'Aguardando resposta', count: counts?.aguardando },
    { value: 'negociacao', label: 'Em negociação', count: counts?.negociacao },
    { value: 'retornos', label: 'Retornos', count: counts?.retornos },
  ];

  const clearAll = () => { setSp(new URLSearchParams(), { replace: true }); };
  const hasFilters = ['campaign_id', 'year', 'hist', 'status', 'seller', 'search', 'metric', 'from', 'to'].some((k) => get(k));

  return (
    <div>
      <PageHeader title={isAdmin ? 'Operação comercial' : 'Minha Operação'}
        subtitle={isAdmin ? 'Todos os contatos em campanhas ativas. Filtre por vendedora para ver a fila de cada uma.' : `Olá, ${user.name.split(' ')[0]}! Estes são os contatos atribuídos a você.`}
        actions={(
          <div className="flex rounded-lg ring-1 ring-line bg-white p-0.5">
            {[['lista', List, 'Lista'], ['kanban', Columns3, 'Quadro']].map(([v, Icon, l]) => (
              <button key={v} onClick={() => setView(v)} className={cx('h-8 px-3 rounded-md text-sm flex items-center gap-1.5', view === v ? 'bg-stone-100 font-medium' : 'text-muted')}><Icon className="size-4" />{l}</button>
            ))}
          </div>
        )} />

      {counts && (
        <Card className="px-5 py-4 mb-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
            <p className="text-sm"><span className="text-xl font-semibold tabular">{counts.trabalhados}</span> <span className="text-muted">de</span> <span className="font-semibold tabular">{counts.total}</span> <span className="text-muted">contatos {isAdmin ? 'nesta seleção' : 'atribuídos'} já trabalhados</span></p>
            <p className="text-[13px] text-muted">{counts.para_enviar} para enviar · {counts.followups_hoje} follow-ups hoje · <span className={counts.atrasados ? 'text-rose-600 font-medium' : ''}>{counts.atrasados} atrasados</span></p>
          </div>
          <Progress value={counts.trabalhados} max={counts.total} />
        </Card>
      )}

      {/* filtros */}
      <Card className="p-3 mb-4">
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2">
          <Select value={get('campaign_id')} onChange={(e) => set('campaign_id', e.target.value)}>
            <option value="">Campanhas ativas</option>
            {activeCampaigns.map((c) => <option key={c.id} value={c.id}>{c.name}{c.status !== 'ativa' ? ` (${c.status})` : ''}</option>)}
          </Select>
          <Select value={productId || ''} onChange={(e) => setProductId(Number(e.target.value) || null)}>
            <option value="">Todos os produtos</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Select value={get('year')} onChange={(e) => set('year', e.target.value)}>
            <option value="">Todos os anos</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}
          </Select>
          <Select value={get('hist')} onChange={(e) => set('hist', e.target.value)}>
            <option value="">Status histórico</option>{Object.entries(HIST).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
          <Select value={get('status')} onChange={(e) => set('status', e.target.value)}>
            <option value="">Situação da reativação</option>{STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS[s].long}</option>)}
          </Select>
          {isAdmin ? (
            <Select value={get('seller')} onChange={(e) => set('seller', e.target.value)}>
              <option value="">Todas as responsáveis</option><option value="none">Sem responsável</option>
              {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          ) : <div className="hidden xl:block" />}
          <div className="relative col-span-2 md:col-span-2 xl:col-span-1">
            <Search className="size-4 text-muted absolute left-2.5 top-2.5" />
            <Input className="pl-8" placeholder="Nome, empresa, telefone" defaultValue={get('search')} onKeyDown={(e) => e.key === 'Enter' && set('search', e.target.value)} onBlur={(e) => e.target.value !== get('search') && set('search', e.target.value)} />
          </div>
        </div>
        {hasFilters && (
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {get('metric') && <Badge className="bg-brand-50 text-brand-800 ring-brand-200">Indicador: {METRIC_LABEL[get('metric')] || get('metric')}{get('from') || get('to') ? ` · ${fmtDate(get('from')) || '…'} a ${fmtDate(get('to')) || '…'}` : ''}</Badge>}
            <Button size="sm" variant="ghost" icon={X} onClick={clearAll}>Limpar filtros</Button>
          </div>
        )}
      </Card>

      {view === 'lista' ? (
        <Card>
          <Tabs className="px-3" tabs={tabs} value={queue} onChange={(v) => set('queue', v)} />
          {isLoading ? <Loading /> : !rows.length ? (
            <EmptyState icon={Inbox} title={queue === 'para_enviar' ? 'Nenhum contato para enviar' : 'Nenhum contato encontrado'}>
              {queue ? 'Fila em dia! Confira as outras abas.' : 'Ajuste os filtros ou aguarde a distribuição de contatos.'}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto scroll-thin">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[12px] text-muted border-b border-line">
                    <th className="font-medium px-4 py-2.5">Cliente</th>
                    <th className="font-medium px-3 py-2.5 hidden md:table-cell">Telefone</th>
                    <th className="font-medium px-3 py-2.5 hidden lg:table-cell">Produto · ano</th>
                    <th className="font-medium px-3 py-2.5">Histórico</th>
                    <th className="font-medium px-3 py-2.5">Reativação</th>
                    <th className="font-medium px-3 py-2.5">Próxima ação</th>
                    {isAdmin && <th className="font-medium px-3 py-2.5 hidden lg:table-cell">Responsável</th>}
                    <th className="font-medium px-3 py-2.5 hidden xl:table-cell">Campanha</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} onClick={() => setOpenId(r.id)}
                      className={cx('border-b border-line/70 last:border-0 cursor-pointer hover:bg-stone-50', openId === r.id && 'bg-brand-50/60')}>
                      <td className="px-4 py-2.5 max-w-[220px]">
                        <p className="font-medium truncate">{r.full_name}</p>
                        {r.company && <p className="text-[12px] text-muted truncate">{r.company}</p>}
                      </td>
                      <td className="px-3 py-2.5 tabular whitespace-nowrap hidden md:table-cell">{r.phone || <span className="text-rose-600 text-[12px]">sem telefone</span>}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap hidden lg:table-cell text-ink/80">{r.product_name?.split(' /')[0] || '—'} · {r.ref_year || '—'}</td>
                      <td className="px-3 py-2.5"><HistBadge status={r.historical_status} /></td>
                      <td className="px-3 py-2.5"><StatusBadge status={r.status} /></td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className={cx('text-[13px]', r.next_action.tone === 'danger' ? 'text-rose-600 font-medium' : r.next_action.tone === 'warning' ? 'text-amber-700 font-medium' : r.next_action.tone === 'primary' ? 'text-brand-700 font-medium' : 'text-muted')}>{r.next_action.label}</span>
                      </td>
                      {isAdmin && <td className="px-3 py-2.5 hidden lg:table-cell">{r.assigned_name || <span className="text-muted">—</span>}</td>}
                      <td className="px-3 py-2.5 hidden xl:table-cell text-muted max-w-[200px] truncate">{r.campaign_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data && <Pagination page={page} total={data.total} pageSize={data.pageSize} onChange={(p) => set('page', String(p))} />}
        </Card>
      ) : (
        <Kanban board={board} onOpen={setOpenId} onMoved={() => { ['participants', 'queues', 'board', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); }} toast={toast} />
      )}

      <Drawer open={!!openId} onClose={() => setOpenId(null)}>
        {openId && (
          <ParticipantPanel id={openId} onClose={() => setOpenId(null)}
            position={idx >= 0 ? `${idx + 1} de ${rows.length}` : undefined}
            onPrev={idx > 0 ? () => setOpenId(rows[idx - 1].id) : undefined}
            onNext={idx >= 0 && idx < rows.length - 1 ? () => setOpenId(rows[idx + 1].id) : undefined} />
        )}
      </Drawer>
    </div>
  );
}

const BOARD_COLS = ['pendente', 'enviada', 'aguardando', 'followup_pendente', 'respondeu', 'interesse', 'negociacao', 'retorno_futuro', 'convertido', 'sem_interesse', 'sem_resposta', 'opt_out'];
const DROPPABLE = ['respondeu', 'interesse', 'negociacao', 'sem_interesse', 'sem_resposta'];

function Kanban({ board, onOpen, onMoved, toast }) {
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const grouped = useMemo(() => {
    const g = Object.fromEntries(BOARD_COLS.map((s) => [s, []]));
    (board?.rows || []).forEach((r) => g[r.status]?.push(r));
    return g;
  }, [board]);
  const count = (s) => board?.counts.find((c) => c.status === s)?.n || 0;
  if (!board) return <Loading />;
  const drop = async (status) => {
    setOver(null);
    if (!drag || drag.status === status) return;
    if (!DROPPABLE.includes(status) || drag.status === 'pendente') {
      toast(drag.status === 'pendente' ? 'Confirme o envio na ficha do contato antes de movê-lo.' : 'Para esta etapa, use a ficha do contato (requer informações adicionais).', 'error');
      onOpen(drag.id);
      return;
    }
    try { await api.post(`/participants/${drag.id}/outcome`, { status }); toast(`Movido para "${STATUS[status].long}"`); onMoved(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div className="flex gap-3 overflow-x-auto scroll-thin pb-3">
      {BOARD_COLS.map((s) => (
        <div key={s} onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver(null)} onDrop={() => drop(s)}
          className={cx('w-64 shrink-0 rounded-xl bg-stone-100/70 ring-1 ring-line flex flex-col max-h-[70vh]', over === s && 'ring-2 ring-brand-500')}>
          <div className="flex items-center justify-between px-3 py-2.5">
            <StatusBadge status={s} /><span className="text-[12px] text-muted tabular">{count(s)}</span>
          </div>
          <div className="px-2 pb-2 space-y-2 overflow-y-auto scroll-thin">
            {grouped[s].map((r) => (
              <button key={r.id} draggable onDragStart={() => setDrag(r)} onDragEnd={() => setDrag(null)} onClick={() => onOpen(r.id)}
                className="w-full text-left rounded-lg bg-white ring-1 ring-line px-3 py-2 hover:ring-brand-200 shadow-xs">
                <p className="text-[13px] font-medium truncate">{r.full_name}</p>
                <p className="text-[11.5px] text-muted truncate">{r.product_name?.split(' /')[0]} · {r.ref_year} · {HIST[r.historical_status]?.label}</p>
                <p className={cx('text-[11.5px] mt-1', r.next_action.tone === 'danger' ? 'text-rose-600' : r.next_action.tone === 'warning' ? 'text-amber-700' : 'text-muted')}>{r.next_action.label}</p>
              </button>
            ))}
            {count(s) > grouped[s].length && <p className="text-[11.5px] text-muted text-center py-1">+{count(s) - grouped[s].length} na lista</p>}
          </div>
        </div>
      ))}
    </div>
  );
}
