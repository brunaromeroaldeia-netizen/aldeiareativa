import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Play, Pause, Square, Pencil, Copy, Trash2, UserPlus, Shuffle, Send, Download, Search } from 'lucide-react';
import { api, download, qs } from '../lib/api.js';
import { useAuth } from '../lib/context.jsx';
import { HIST, STATUS, STATUS_ORDER, fmtDate, fmtInt, fmtPct, fmtMoney, fmtDateTime } from '../lib/format.js';
import {
  Card, CardHeader, PageHeader, Tabs, Button, CampaignBadge, Kpi, Progress, Loading, Alert, HistBadge, StatusBadge, Select, Input, Checkbox,
  Pagination, Modal, Field, DemoTag, useToast, useConfirm, cx,
} from '../components/ui.jsx';
import MessageEditor from '../components/MessageEditor.jsx';

export default function CampaignDetail() {
  const { id } = useParams();
  const { isAdmin } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'resumo';
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();
  const { data: c, isLoading, error } = useQuery({ queryKey: ['campaign', id], queryFn: () => api.get(`/campaigns/${id}`) });
  if (isLoading) return <Loading />;
  if (error) return <Alert tone="danger">{error.message}</Alert>;
  const refresh = () => { qc.invalidateQueries({ queryKey: ['campaign', id] }); qc.invalidateQueries({ queryKey: ['campaigns'] }); qc.invalidateQueries({ queryKey: ['participants'] }); qc.invalidateQueries({ queryKey: ['queues'] }); };

  const setStatus = async (action) => {
    const msgs = {
      ativar: 'As vendedoras passarão a ver os contatos atribuídos na operação.',
      pausar: 'Os contatos saem das filas de envio até a campanha ser retomada.',
      retomar: 'Os contatos voltam para as filas de envio.',
      encerrar: 'Follow-ups pendentes serão suspensos. Todo o histórico e os resultados ficam preservados para consulta. Esta ação não pode ser desfeita.',
    };
    if (!(await confirm({ title: `${action[0].toUpperCase()}${action.slice(1)} campanha`, message: msgs[action], danger: action === 'encerrar', confirmLabel: action[0].toUpperCase() + action.slice(1) }))) return;
    try { await api.post(`/campaigns/${id}/status`, { action }); toast('Status da campanha atualizado'); refresh(); } catch (e) { toast(e.message, 'error'); }
  };
  const duplicate = async () => {
    try { const r = await api.post(`/campaigns/${id}/duplicate`, {}); toast('Campanha duplicada como rascunho'); nav(`/campanhas/${r.id}/editar`); } catch (e) { toast(e.message, 'error'); }
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Excluir rascunho', message: 'O rascunho e seus participantes serão excluídos.', danger: true, confirmLabel: 'Excluir' }))) return;
    try { await api.del(`/campaigns/${id}`); toast('Rascunho excluído'); nav('/campanhas'); } catch (e) { toast(e.message, 'error'); }
  };

  const s = c.summary;
  const tabs = [
    { value: 'resumo', label: 'Resumo' },
    ...(isAdmin ? [{ value: 'participantes', label: 'Participantes e distribuição', count: s.participants }] : []),
    { value: 'mensagens', label: 'Mensagens' },
  ];

  return (
    <div>
      {confirmDialog}
      <button onClick={() => nav('/campanhas')} className="text-sm text-muted hover:text-ink flex items-center gap-1 mb-3"><ArrowLeft className="size-4" />Campanhas</button>
      <PageHeader title={c.name}
        subtitle={`${c.product_names.join(', ') || 'Todos os produtos'} · ${c.years.join(', ') || 'todos os anos'} · ${c.historical_statuses.map((h) => HIST[h]?.label).join(', ') || 'todos os status'} · ${fmtDate(c.start_date)} a ${fmtDate(c.end_date)}`}
        actions={(
          <>
            <CampaignBadge status={c.status} />
            {c.is_demo && <DemoTag />}
            {isAdmin && c.status === 'rascunho' && <Button variant="primary" icon={Play} onClick={() => setStatus('ativar')}>Ativar</Button>}
            {isAdmin && c.status === 'ativa' && <Button icon={Pause} onClick={() => setStatus('pausar')}>Pausar</Button>}
            {isAdmin && c.status === 'pausada' && <Button variant="primary" icon={Play} onClick={() => setStatus('retomar')}>Retomar</Button>}
            {isAdmin && c.status !== 'encerrada' && <Button icon={Pencil} onClick={() => nav(`/campanhas/${id}/editar`)}>Editar</Button>}
            {isAdmin && c.status !== 'encerrada' && <Button variant="danger" icon={Square} onClick={() => setStatus('encerrar')}>Encerrar</Button>}
            {isAdmin && <Button variant="ghost" icon={Copy} onClick={duplicate}>Reutilizar</Button>}
            {isAdmin && c.status === 'rascunho' && <Button variant="ghost" icon={Trash2} onClick={remove} />}
            {c.status !== 'rascunho' && <Button icon={Send} onClick={() => nav(`/operacao?campaign_id=${id}`)}>Abrir na operação</Button>}
          </>
        )} />
      {c.status === 'encerrada' && <Alert tone="info" className="mb-4">Campanha encerrada em {fmtDateTime(c.closed_at)}. Histórico e resultados preservados para consulta.</Alert>}
      {c.status === 'ativa' && c.end_date && c.end_date < new Date().toISOString().slice(0, 10) && <Alert tone="warning" className="mb-4">O período da campanha terminou em {fmtDate(c.end_date)}. Encerre-a quando concluir os follow-ups.</Alert>}
      <Tabs tabs={tabs} value={tab} onChange={(v) => setSp({ tab: v })} className="mb-5" />

      {tab === 'resumo' && <Summary c={c} />}
      {tab === 'participantes' && isAdmin && <Participants c={c} onChanged={refresh} />}
      {tab === 'mensagens' && <MessageEditor campaignId={Number(id)} campaign={c} readOnly={c.status === 'encerrada'} />}
    </div>
  );
}

function Summary({ c }) {
  const s = c.summary;
  const nav = useNavigate();
  const drill = (metric) => nav(`/operacao${qs({ campaign_id: c.id, metric })}`);
  return (
    <div className="space-y-5">
      {c.promo_description && <Card className="px-5 py-4"><p className="text-[12px] text-muted mb-1">Condições comerciais (visíveis para as vendedoras na ficha de cada contato)</p><p className="text-sm whitespace-pre-line">{c.promo_description}</p></Card>}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <Kpi label="Participantes" value={fmtInt(s.participants)} sub={c.goal_contacts ? `meta ${fmtInt(c.goal_contacts)}` : null} />
        <Kpi label="Trabalhados" value={fmtInt(s.worked)} sub={`${fmtInt(s.pending)} pendentes`} onClick={() => drill('trabalhados')} />
        <Kpi label="Com envio" value={fmtInt(s.sent)} onClick={() => drill('enviados')} />
        <Kpi label="Responderam" value={fmtInt(s.responded)} sub={fmtPct(s.sent ? (s.responded / s.sent) * 100 : null)} onClick={() => drill('responderam')} />
        <Kpi label="Interessados" value={fmtInt(s.interested)} onClick={() => drill('interessados')} />
        <Kpi label="Conversões" value={fmtInt(s.converted)} tone="brand" sub={c.goal_conversions ? `meta ${c.goal_conversions}` : fmtPct(s.sent ? (s.converted / s.sent) * 100 : null)} onClick={() => drill('convertidos')} />
        <Kpi label="Receita" value={fmtMoney(s.revenue, true)} sub={c.goal_revenue ? `meta ${fmtMoney(c.goal_revenue, true)}` : null} />
        <Kpi label="Sem atribuição" value={fmtInt(s.unassigned)} tone={s.unassigned ? 'danger' : undefined} />
      </div>
      {c.goal_conversions ? (
        <Card className="px-5 py-4">
          <div className="flex justify-between text-sm mb-1.5"><span>Meta de conversões</span><span className="tabular">{s.converted} / {c.goal_conversions}</span></div>
          <Progress value={s.converted} max={c.goal_conversions} />
        </Card>
      ) : null}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Por vendedora" />
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-[12px] text-muted border-y border-line text-left"><th className="font-medium px-5 py-2">Vendedora</th><th className="font-medium px-2 text-right">Atribuídos</th><th className="font-medium px-2 text-right">Trabalhados</th><th className="font-medium px-2 text-right">Pendentes</th><th className="font-medium px-2 text-right">Respostas</th><th className="font-medium px-5 text-right">Conversões</th></tr></thead>
            <tbody>
              {c.bySeller.map((r) => (
                <tr key={r.id} className="border-b border-line/60 last:border-0">
                  <td className="px-5 py-2.5 font-medium">{r.name}<Progress value={r.worked} max={r.assigned} className="mt-1 w-28" /></td>
                  <td className="px-2 text-right tabular">{r.assigned}</td><td className="px-2 text-right tabular">{r.worked}</td><td className="px-2 text-right tabular">{r.pending}</td>
                  <td className="px-2 text-right tabular">{r.responded}</td><td className="px-5 text-right tabular font-medium text-brand-700">{r.converted}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </Card>
        <Card>
          <CardHeader title="Situação da reativação" />
          <div className="px-5 pb-5 space-y-1.5">
            {STATUS_ORDER.filter((st) => c.byStatus.find((b) => b.status === st)).map((st) => {
              const n = c.byStatus.find((b) => b.status === st)?.n || 0;
              return (
                <button key={st} onClick={() => nav(`/operacao${qs({ campaign_id: c.id, status: st })}`)} className="w-full flex items-center gap-3 text-sm hover:bg-stone-50 rounded-md px-1 py-0.5">
                  <span className="w-44 text-left"><StatusBadge status={st} /></span>
                  <div className="flex-1 h-2 rounded-full bg-stone-100 overflow-hidden"><div className="h-full bg-brand-500/70" style={{ width: `${(n / s.participants) * 100}%` }} /></div>
                  <span className="tabular w-10 text-right">{n}</span>
                </button>
              );
            })}
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader title="Resultados por segmento" subtitle="Produto × ano da base × status histórico" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-[12px] text-muted border-y border-line text-left"><th className="font-medium px-5 py-2">Segmento</th><th className="font-medium px-2 text-right">Participantes</th><th className="font-medium px-2 text-right">Enviados</th><th className="font-medium px-2 text-right">Respostas</th><th className="font-medium px-2 text-right">Taxa de resposta</th><th className="font-medium px-2 text-right">Conversões</th><th className="font-medium px-5 text-right">Taxa de conversão</th></tr></thead>
            <tbody>
              {c.bySegment.map((r, i) => (
                <tr key={i} className="border-b border-line/60 last:border-0">
                  <td className="px-5 py-2.5"><span className="font-medium">{r.product_name || 'Sem produto'}</span> · {r.ref_year || 's/ ano'} <HistBadge status={r.historical_status} /></td>
                  <td className="px-2 text-right tabular">{r.participants}</td><td className="px-2 text-right tabular">{r.sent}</td><td className="px-2 text-right tabular">{r.responded}</td>
                  <td className="px-2 text-right tabular">{fmtPct(r.sent ? (r.responded / r.sent) * 100 : null)}</td>
                  <td className="px-2 text-right tabular font-medium text-brand-700">{r.converted}</td>
                  <td className="px-5 text-right tabular">{fmtPct(r.sent ? (r.converted / r.sent) * 100 : null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="px-5 py-4 text-sm text-muted grid sm:grid-cols-3 gap-2">
        {Array.from({ length: Math.max(0, c.max_attempts - 1) }, (_, i) => i + 2).map((step) => {
          const r = c.followup_schedule?.steps?.find((x) => x.step === step) || { min: c.followup_days, max: c.followup_days };
          return <p key={step}>Follow-up {step - 1}: <b className="text-ink">{r.min === r.max ? `${r.min} dias` : `${r.min} a ${r.max} dias`}</b> após o envio anterior, sem resposta</p>;
        })}
        <p>Limite: <b className="text-ink">{c.max_attempts} abordagens</b> · encerra sem resposta após <b className="text-ink">{c.followup_schedule?.close_after_days ?? c.followup_days} dias</b></p>
        {c.end_date && <p>Nenhum follow-up depois de <b className="text-ink">{fmtDate(c.end_date)}</b></p>}
        {c.filters?.exclude_active_clients !== false && <p>Clientes ativos não entram na campanha</p>}
        <p>Vendedoras: <b className="text-ink">{c.sellers.map((x) => x.name).join(', ') || '—'}</b></p>
        {c.filters?.exclude_recent_days ? <p>Exclui abordados nos últimos <b className="text-ink">{c.filters.exclude_recent_days} dias</b></p> : null}
        {c.filters?.lost_reasons?.length ? <p>Motivos de perda: <b className="text-ink">{c.filters.lost_reasons.join(', ')}</b></p> : null}
        <p>Criada por {c.created_by_name} em {fmtDate(c.created_at)}</p>
      </Card>
    </div>
  );
}

function Participants({ c, onChanged }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [confirm, confirmDialog] = useConfirm();
  const closed = c.status === 'encerrada';
  const { data: elig, refetch: refetchElig } = useQuery({ queryKey: ['eligibility', c.id], queryFn: () => api.get(`/campaigns/${c.id}/eligibility`), enabled: !closed });
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => api.get('/users') });
  const sellers = users.filter((u) => u.role === 'vendedora' && u.active);
  const [segSel, setSegSel] = useState(null);
  const [includeRecent, setIncludeRecent] = useState(false);
  const [includeActive, setIncludeActive] = useState(false);
  const [adding, setAdding] = useState(false);
  const [distOpen, setDistOpen] = useState(false);
  const [filter, setFilter] = useState({ assigned: '', search: '', page: 1 });
  const [selected, setSelected] = useState([]);
  const [assignTo, setAssignTo] = useState('');
  const { data: parts } = useQuery({ queryKey: ['campaign-parts', c.id, filter], queryFn: () => api.get(`/campaigns/${c.id}/participants${qs(filter)}`), placeholderData: (p) => p });
  const segKey = (s) => `${s.product_id}|${s.ref_year}|${s.historical_status}`;
  const selectedSegs = segSel ?? (elig?.segments || []).filter((s) => s.eligible > 0).map(segKey);
  const reload = () => { onChanged(); refetchElig(); qc.invalidateQueries({ queryKey: ['campaign-parts', c.id] }); setSelected([]); };

  const add = async () => {
    setAdding(true);
    try {
      const segments = (elig?.segments || []).filter((s) => selectedSegs.includes(segKey(s))).map((s) => ({ product_id: s.product_id, ref_year: s.ref_year, historical_status: s.historical_status }));
      const r = await api.post(`/campaigns/${c.id}/participants`, { segments, include_recent: includeRecent, include_active: includeActive });
      toast(`${r.added} contato(s) adicionados à campanha`);
      reload();
    } catch (e) { toast(e.message, 'error'); } finally { setAdding(false); }
  };
  const assign = async () => {
    try {
      const r = await api.post(`/campaigns/${c.id}/distribute`, { method: 'manual', participant_ids: selected, user_id: assignTo === 'none' ? null : Number(assignTo) });
      toast(`${r.changed} contato(s) atribuídos`); reload();
    } catch (e) { toast(e.message, 'error'); }
  };
  const removeSel = async () => {
    if (!(await confirm({ title: 'Remover da campanha', message: 'Somente contatos ainda sem envio podem ser removidos.', danger: true, confirmLabel: 'Remover' }))) return;
    try { const r = await api.post(`/campaigns/${c.id}/participants/remove`, { ids: selected }); toast(`${r.removed} removido(s)${r.kept ? `, ${r.kept} mantido(s) por já terem histórico` : ''}`); reload(); } catch (e) { toast(e.message, 'error'); }
  };
  const allIds = (parts?.rows || []).map((r) => r.id);

  return (
    <div className="space-y-5">
      {confirmDialog}
      {!closed && elig && (
        <Card>
          <CardHeader title="Adicionar contatos elegíveis" subtitle="Selecione os segmentos da base. Contatos já na campanha e com opt-out não são incluídos."
            actions={<Button variant="primary" icon={UserPlus} onClick={add} loading={adding} disabled={!selectedSegs.length}>Adicionar selecionados</Button>} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-[12px] text-muted border-y border-line text-left">
                <th className="px-5 py-2 w-10"><Checkbox checked={selectedSegs.length === elig.segments.length && elig.segments.length > 0} onChange={(v) => setSegSel(v ? elig.segments.map(segKey) : [])} /></th>
                <th className="font-medium py-2">Segmento</th><th className="font-medium px-2 text-right">No segmento</th><th className="font-medium px-2 text-right">Já incluídos</th>
                <th className="font-medium px-2 text-right">Abordagem recente</th><th className="font-medium px-2 text-right">Outra campanha ativa</th><th className="font-medium px-2 text-right">Opt-out</th><th className="font-medium px-5 text-right">Disponíveis</th>
              </tr></thead>
              <tbody>
                {elig.segments.map((s) => (
                  <tr key={segKey(s)} className="border-b border-line/60 last:border-0">
                    <td className="px-5 py-2"><Checkbox checked={selectedSegs.includes(segKey(s))} onChange={(v) => setSegSel(v ? [...selectedSegs, segKey(s)] : selectedSegs.filter((x) => x !== segKey(s)))} /></td>
                    <td className="py-2"><span className="font-medium">{s.product_name || 'Sem produto'}</span> · {s.ref_year || 's/ ano'} <HistBadge status={s.historical_status} /></td>
                    <td className="px-2 text-right tabular">{s.matching}</td><td className="px-2 text-right tabular text-muted">{s.already}</td>
                    <td className="px-2 text-right tabular text-muted">{s.recent}</td><td className="px-2 text-right tabular text-muted">{s.in_active}</td><td className="px-2 text-right tabular text-muted">{s.excluded_dnc}</td>
                    <td className="px-5 text-right tabular font-semibold">{s.eligible}</td>
                  </tr>
                ))}
                {!elig.segments.length && <tr><td colSpan={8} className="px-5 py-6 text-center text-muted">Nenhum contato na base corresponde à segmentação. Ajuste a campanha em “Editar”.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-4 px-5 py-3 border-t border-line">
            <Checkbox checked={includeRecent} onChange={setIncludeRecent} label={`Incluir abordados nos últimos ${elig.recentDays} dias`} />
            {elig.excludeActive && <Checkbox checked={includeActive} onChange={setIncludeActive} label="Incluir contatos em outra campanha ativa" />}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Distribuição entre vendedoras"
          subtitle={`${c.summary.assigned} atribuídos · ${c.summary.unassigned} sem responsável`}
          actions={!closed && <Button icon={Shuffle} onClick={() => setDistOpen(true)}>Distribuir automaticamente</Button>} />
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 px-5 pb-5">
          {c.bySeller.map((r) => (
            <div key={r.id} className="rounded-lg ring-1 ring-line px-4 py-3">
              <p className="font-medium">{r.name}</p>
              <p className="text-[13px] text-muted tabular">{r.assigned} atribuídos · {r.worked} trabalhados · {r.pending} pendentes</p>
              <Progress value={r.worked} max={r.assigned} className="mt-2" />
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-line">
          <div className="relative"><Search className="size-4 text-muted absolute left-2.5 top-2.5" /><Input className="pl-8 w-56" placeholder="Buscar participante" onKeyDown={(e) => e.key === 'Enter' && setFilter({ ...filter, search: e.target.value, page: 1 })} /></div>
          <Select className="w-48" value={filter.assigned} onChange={(e) => setFilter({ ...filter, assigned: e.target.value, page: 1 })}>
            <option value="">Todas as responsáveis</option><option value="none">Sem responsável</option>{sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Button variant="ghost" icon={Download} onClick={() => download(`/reports/participantes${qs({ campaign_id: c.id })}`).catch((e) => toast(e.message, 'error'))}>Exportar</Button>
          {selected.length > 0 && !closed && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-sm text-muted">{selected.length} selecionado(s)</span>
              <Select className="w-44" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
                <option value="">Atribuir a…</option><option value="none">Remover atribuição</option>{sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
              <Button variant="primary" disabled={!assignTo} onClick={assign}>Aplicar</Button>
              <Button variant="danger" onClick={removeSel}>Remover</Button>
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-[12px] text-muted border-b border-line text-left">
              <th className="px-5 py-2 w-10"><Checkbox checked={allIds.length > 0 && allIds.every((x) => selected.includes(x))} onChange={(v) => setSelected(v ? [...new Set([...selected, ...allIds])] : selected.filter((x) => !allIds.includes(x)))} /></th>
              <th className="font-medium py-2">Cliente</th><th className="font-medium px-2">Telefone</th><th className="font-medium px-2">Segmento</th><th className="font-medium px-2">Responsável</th><th className="font-medium px-2">Situação</th><th className="font-medium px-5 text-right">Tentativas</th>
            </tr></thead>
            <tbody>
              {(parts?.rows || []).map((r) => (
                <tr key={r.id} className="border-b border-line/60 last:border-0">
                  <td className="px-5 py-2"><Checkbox checked={selected.includes(r.id)} onChange={(v) => setSelected(v ? [...selected, r.id] : selected.filter((x) => x !== r.id))} /></td>
                  <td className="py-2"><Link to={`/contatos/${r.contact_id}`} className="font-medium hover:underline">{r.full_name}</Link>{r.company && <span className="text-muted text-[12px]"> · {r.company}</span>}</td>
                  <td className="px-2 tabular whitespace-nowrap">{r.phone || '—'}</td>
                  <td className="px-2 whitespace-nowrap">{r.product_name?.split(' /')[0]} · {r.ref_year} <HistBadge status={r.historical_status} /></td>
                  <td className="px-2">{r.assigned_name || <span className="text-muted">—</span>}</td>
                  <td className="px-2"><StatusBadge status={r.status} /></td>
                  <td className="px-5 text-right tabular">{r.attempts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {parts && <Pagination page={filter.page} total={parts.total} pageSize={parts.pageSize} onChange={(p) => setFilter({ ...filter, page: p })} />}
      </Card>
      {distOpen && <DistributeModal c={c} sellers={sellers} onClose={() => setDistOpen(false)} onDone={() => { setDistOpen(false); reload(); }} />}
    </div>
  );
}

function DistributeModal({ c, sellers, onClose, onDone }) {
  const toast = useToast();
  const [method, setMethod] = useState('igual');
  const [scope, setScope] = useState('nao_atribuidos');
  const campaignSellers = c.sellers.length ? sellers.filter((s) => c.sellers.some((x) => x.id === s.id)) : sellers;
  const [weights, setWeights] = useState(() => Object.fromEntries(campaignSellers.map((s) => [s.id, Math.round(100 / Math.max(1, campaignSellers.length))])));
  const segments = useMemo(() => c.bySegment.map((s) => ({ ...s, user_id: s.seller_ids.length === 1 ? s.seller_ids[0] : '' })), [c.bySegment]);
  const [segUsers, setSegUsers] = useState(() => Object.fromEntries(segments.map((s, i) => [i, s.user_id])));
  const [loading, setLoading] = useState(false);
  const total = Object.values(weights).reduce((a, b) => a + Number(b || 0), 0);
  const run = async () => {
    setLoading(true);
    try {
      const body = method === 'segmento'
        ? { method, segments: segments.map((s, i) => ({ product_id: s.product_id, ref_year: s.ref_year, historical_status: s.historical_status, user_id: segUsers[i] ? Number(segUsers[i]) : null })).filter((_, i) => segUsers[i] !== '') }
        : { method, scope, weights: method === 'proporcional' ? weights : undefined };
      const r = await api.post(`/campaigns/${c.id}/distribute`, body);
      toast(`${r.changed} contato(s) distribuídos`);
      onDone();
    } catch (e) { toast(e.message, 'error'); } finally { setLoading(false); }
  };
  return (
    <Modal open onClose={onClose} title="Distribuir contatos" size="lg"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={loading} onClick={run} disabled={method === 'proporcional' && total <= 0}>Distribuir</Button></>}>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-3 gap-2">
          {[['igual', 'Automática 50/50', 'Divide igualmente entre as vendedoras da campanha'], ['proporcional', 'Proporcional', 'Percentual configurável por vendedora'], ['segmento', 'Por segmento', 'Segmentos inteiros para uma vendedora']].map(([v, t, d]) => (
            <button key={v} onClick={() => setMethod(v)} className={cx('text-left rounded-lg ring-1 px-3 py-2.5', method === v ? 'ring-2 ring-brand-500 bg-brand-50/50' : 'ring-line hover:bg-stone-50')}>
              <p className="text-sm font-medium">{t}</p><p className="text-[12px] text-muted">{d}</p>
            </button>
          ))}
        </div>
        {method !== 'segmento' && (
          <Field label="Quais contatos">
            <Select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="nao_atribuidos">Somente os ainda sem responsável</option>
              <option value="pendentes">Redistribuir todos os pendentes (ainda sem nenhum envio)</option>
            </Select>
          </Field>
        )}
        {method === 'proporcional' && (
          <div className="space-y-2">
            {campaignSellers.map((s) => (
              <div key={s.id} className="flex items-center gap-3">
                <span className="w-32 text-sm font-medium">{s.name}</span>
                <Input type="number" min={0} max={100} className="w-24" value={weights[s.id] ?? 0} onChange={(e) => setWeights({ ...weights, [s.id]: Number(e.target.value) })} />
                <span className="text-sm text-muted">% ({total ? Math.round(((weights[s.id] || 0) / total) * 100) : 0}% efetivo)</span>
              </div>
            ))}
          </div>
        )}
        {method === 'segmento' && (
          <div className="divide-y divide-line rounded-lg ring-1 ring-line">
            {segments.map((s, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="flex-1">{s.product_name?.split(' /')[0]} · {s.ref_year || 's/ ano'} <HistBadge status={s.historical_status} /> <span className="text-muted">({s.participants})</span></span>
                <Select className="w-44" value={segUsers[i] ?? ''} onChange={(e) => setSegUsers({ ...segUsers, [i]: e.target.value })}>
                  <option value="">Não alterar</option>{sellers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </Select>
              </div>
            ))}
          </div>
        )}
        <Alert tone="info">Contatos que já receberam mensagem nunca são redistribuídos automaticamente (evita abordagens duplicadas). Para reatribuir individualmente, selecione-os na lista.</Alert>
      </div>
    </Modal>
  );
}

export { STATUS };
