import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Plus, Users, ArrowLeft, Ban, Download, ShieldAlert, Pencil, Megaphone, X } from 'lucide-react';
import { api, qs, download } from '../lib/api.js';
import { useAuth, useProduct } from '../lib/context.jsx';
import { HIST, fmtDate, fmtMoney, fmtDateTime } from '../lib/format.js';
import {
  Card, CardHeader, PageHeader, Button, Input, Select, HistBadge, StatusBadge, Badge, Pagination, EmptyState, Loading, Modal, Field, Textarea,
  Alert, DemoTag, useToast, useConfirm, CampaignBadge,
} from '../components/ui.jsx';
import { Timeline } from '../components/ParticipantPanel.jsx';

export function Contacts() {
  const [sp, setSp] = useSearchParams();
  const { isAdmin } = useAuth();
  const { productId, setProductId, products } = useProduct();
  const nav = useNavigate();
  const get = (k) => sp.get(k) || '';
  const set = (k, v) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); if (k !== 'page') n.delete('page'); setSp(n, { replace: true }); };
  const { data: years = [] } = useQuery({ queryKey: ['years'], queryFn: () => api.get('/contacts/years') });
  const filters = { product_id: productId || '', year: get('year'), hist: get('hist'), dnc: get('dnc'), search: get('search'), approached: get('approached'), converted: get('converted'), no_phone: get('no_phone'), no_year: get('no_year'), page: get('page') || 1 };
  const { data, isLoading } = useQuery({ queryKey: ['contacts', filters], queryFn: () => api.get(`/contacts${qs(filters)}`), placeholderData: (p) => p });
  const [newOpen, setNewOpen] = useState(false);
  const has = ['year', 'hist', 'dnc', 'search', 'approached', 'converted', 'no_phone', 'no_year'].some((k) => get(k));
  return (
    <div>
      <PageHeader title="Base de Contatos" subtitle={isAdmin ? 'Base comercial permanente: cada contato pode ter várias oportunidades históricas.' : 'Contatos que já foram atribuídos a você.'}
        actions={isAdmin && (
          <>
            <Button icon={Download} onClick={() => download(`/reports/opt_out`)}>Lista de opt-out</Button>
            <Button variant="primary" icon={Plus} onClick={() => setNewOpen(true)}>Adicionar contato</Button>
          </>
        )} />
      <Card className="p-3 mb-4">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
          <div className="relative col-span-2">
            <Search className="size-4 text-muted absolute left-2.5 top-2.5" />
            <Input className="pl-8" placeholder="Buscar por nome, empresa, e-mail ou telefone" defaultValue={get('search')} onKeyDown={(e) => e.key === 'Enter' && set('search', e.target.value)} />
          </div>
          <Select value={productId || ''} onChange={(e) => setProductId(Number(e.target.value) || null)}>
            <option value="">Todos os produtos</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Select value={get('year')} onChange={(e) => set('year', e.target.value)}><option value="">Todos os anos</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select>
          <Select value={get('hist')} onChange={(e) => set('hist', e.target.value)}><option value="">Status histórico</option>{Object.entries(HIST).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
          <Select value={get('approached') || get('dnc') && `dnc${get('dnc')}` || get('converted') && 'conv' || get('no_phone') && 'nophone' || get('no_year') && 'noyear'} onChange={(e) => {
            const n = new URLSearchParams(sp); ['approached', 'dnc', 'converted', 'no_phone', 'no_year', 'page'].forEach((k) => n.delete(k));
            const v = e.target.value;
            if (v === '0' || v === '1') n.set('approached', v); if (v === 'dnc1') n.set('dnc', '1'); if (v === 'conv') n.set('converted', '1'); if (v === 'nophone') n.set('no_phone', '1'); if (v === 'noyear') n.set('no_year', '1');
            setSp(n, { replace: true });
          }}>
            <option value="">Todas as situações</option><option value="0">Nunca abordados</option><option value="1">Já abordados</option><option value="conv">Convertidos em campanhas</option>
            <option value="dnc1">Não contatar (opt-out)</option><option value="nophone">Sem telefone</option><option value="noyear">Sem ano identificado</option>
          </Select>
        </div>
        {has && <Button size="sm" variant="ghost" icon={X} className="mt-2" onClick={() => setSp(new URLSearchParams(), { replace: true })}>Limpar filtros</Button>}
      </Card>
      <Card>
        {isLoading ? <Loading /> : !data?.rows.length ? <EmptyState icon={Users} title="Nenhum contato encontrado">{isAdmin ? 'Importe uma planilha ou ajuste os filtros.' : ''}</EmptyState> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[12px] text-muted border-b border-line">
                <th className="font-medium px-4 py-2.5">Contato</th><th className="font-medium px-3 hidden md:table-cell">Telefone</th><th className="font-medium px-3 hidden lg:table-cell">E-mail</th>
                <th className="font-medium px-3">Oportunidades</th><th className="font-medium px-3 hidden md:table-cell">Última campanha</th>
              </tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className="border-b border-line/60 last:border-0 hover:bg-stone-50 cursor-pointer" onClick={() => nav(`/contatos/${r.id}`)}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium flex items-center gap-1.5">{r.full_name}{r.do_not_contact && <Badge className="bg-rose-50 text-rose-700 ring-rose-200"><Ban className="size-3" />opt-out</Badge>}{r.is_demo && <DemoTag />}</p>
                      {r.company && <p className="text-[12px] text-muted">{r.company}</p>}
                    </td>
                    <td className="px-3 tabular whitespace-nowrap hidden md:table-cell">{r.phone || <span className="text-muted">—</span>}</td>
                    <td className="px-3 hidden lg:table-cell text-ink/80 truncate max-w-[200px]">{r.email || <span className="text-muted">—</span>}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {(r.opps || []).slice(0, 3).map((o, i) => <span key={i} className="text-[12px] inline-flex items-center gap-1 whitespace-nowrap">{o.product?.split(' /')[0] || 'Sem produto'} {o.year || ''} <HistBadge status={o.status} /></span>)}
                        {r.opportunities > 3 && <span className="text-[12px] text-muted">+{r.opportunities - 3}</span>}
                      </div>
                    </td>
                    <td className="px-3 hidden md:table-cell">{r.last_campaign ? <span className="text-[12px]"><span className="text-muted">{r.last_campaign.campaign}</span> <StatusBadge status={r.last_campaign.status} /></span> : <span className="text-[12px] text-muted">Nunca abordado</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pagination page={Number(filters.page)} total={data.total} pageSize={data.pageSize} onChange={(p) => set('page', String(p))} />}
      </Card>
      {newOpen && <NewContactModal onClose={() => setNewOpen(false)} onCreated={(id) => nav(`/contatos/${id}`)} />}
    </div>
  );
}

function OppFields({ o, setO, products, years }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      <Field label="Produto"><Select value={o.product_id} onChange={(e) => setO({ ...o, product_id: e.target.value })}><option value="">—</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
      <Field label="Data de entrada"><Input type="date" value={o.created_date} onChange={(e) => setO({ ...o, created_date: e.target.value })} /></Field>
      <Field label="Ano da base" hint="Se vazio, usa a data de entrada."><Input type="number" list="years" value={o.ref_year} onChange={(e) => setO({ ...o, ref_year: e.target.value })} /><datalist id="years">{years.map((y) => <option key={y} value={y} />)}</datalist></Field>
      <Field label="Data do ganho"><Input type="date" value={o.won_date} onChange={(e) => setO({ ...o, won_date: e.target.value })} /></Field>
      <Field label="Data da perda"><Input type="date" value={o.lost_date} onChange={(e) => setO({ ...o, lost_date: e.target.value })} /></Field>
      <Field label="Motivo da perda"><Input value={o.lost_reason} onChange={(e) => setO({ ...o, lost_reason: e.target.value })} /></Field>
      <Field label="Valor (R$)"><Input type="number" value={o.value} onChange={(e) => setO({ ...o, value: e.target.value })} /></Field>
    </div>
  );
}
const EMPTY_OPP = { product_id: '', created_date: '', ref_year: '', won_date: '', lost_date: '', lost_reason: '', value: '' };
const oppPayload = (o) => ({
  product_id: o.product_id ? Number(o.product_id) : null, ref_year: o.ref_year ? Number(o.ref_year) : null, created_date: o.created_date || null,
  won_date: o.won_date || null, lost_date: o.lost_date || null, lost_reason: o.lost_reason || null, value: o.value ? Number(o.value) : null,
});

function NewContactModal({ onClose, onCreated }) {
  const toast = useToast();
  const { products } = useProduct();
  const { data: years = [] } = useQuery({ queryKey: ['years'], queryFn: () => api.get('/contacts/years') });
  const [f, setF] = useState({ full_name: '', company: '', phone: '', email: '', notes: '' });
  const [o, setO] = useState(EMPTY_OPP);
  const [dups, setDups] = useState(null);
  const [saving, setSaving] = useState(false);
  const save = async (force) => {
    setSaving(true);
    try {
      const r = await api.post('/contacts', { ...f, opportunity: o.product_id || o.ref_year || o.created_date ? oppPayload(o) : undefined, force });
      toast('Contato adicionado'); onCreated(r.id);
    } catch (e) {
      if (e.status === 409) setDups(e.details?.duplicates || []); else toast(e.message, 'error');
    } finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title="Adicionar contato manualmente" size="lg"
      footer={<><Button onClick={onClose}>Cancelar</Button>{dups ? <Button variant="primary" loading={saving} onClick={() => save(true)}>Criar mesmo assim</Button> : <Button variant="primary" loading={saving} onClick={() => save(false)} disabled={!f.full_name}>Salvar</Button>}</>}>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Nome completo"><Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
          <Field label="Empresa"><Input value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></Field>
          <Field label="Telefone / WhatsApp"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="(41) 99999-0000" /></Field>
          <Field label="E-mail"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        </div>
        <p className="text-sm font-medium">Oportunidade histórica (opcional)</p>
        <OppFields o={o} setO={setO} products={products} years={years} />
        {dups && (
          <Alert tone="warning" title="Possível duplicidade">
            {dups.map((d) => <p key={d.id}><Link className="underline" to={`/contatos/${d.id}`}>{d.full_name}</Link> · {d.phone || ''} {d.email || ''}</p>)}
            <p className="mt-1">Se for a mesma pessoa, abra o cadastro existente e adicione a oportunidade lá.</p>
          </Alert>
        )}
      </div>
    </Modal>
  );
}

export function ContactDetail() {
  const { id } = useParams();
  const { isAdmin } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();
  const { data, isLoading, error } = useQuery({ queryKey: ['contact', id], queryFn: () => api.get(`/contacts/${id}`) });
  const { products } = useProduct();
  const { data: years = [] } = useQuery({ queryKey: ['years'], queryFn: () => api.get('/contacts/years') });
  const [edit, setEdit] = useState(false);
  const [oppOpen, setOppOpen] = useState(false);
  const [adjust, setAdjust] = useState(null);
  const [addCampaign, setAddCampaign] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');
  if (isLoading) return <Loading />;
  if (error) return <Alert tone="danger">{error.message}</Alert>;
  const { contact: c, opportunities, participations } = data;
  const refresh = () => qc.invalidateQueries({ queryKey: ['contact', id] });

  const optOut = async () => {
    if (!(await confirm({ title: 'Registrar pedido de não contato', message: 'O contato será bloqueado para todas as campanhas atuais e futuras. Follow-ups pendentes serão cancelados.', danger: true, confirmLabel: 'Bloquear' }))) return;
    try { await api.post(`/contacts/${id}/opt-out`, { reason: 'Pedido registrado na ficha do contato' }); toast('Opt-out registrado'); refresh(); } catch (e) { toast(e.message, 'error'); }
  };
  const revoke = async (reason) => {
    try { await api.del(`/contacts/${id}/opt-out`, { reason }); toast('Bloqueio removido'); setRevokeOpen(false); refresh(); } catch (e) { toast(e.message, 'error'); }
  };
  const anonymize = async () => {
    if (!(await confirm({ title: 'Anonimizar contato (LGPD)', message: 'Nome, telefone, e-mail, empresa, observações e textos de mensagens serão apagados definitivamente. Os números agregados permanecem. Não pode ser desfeito.', danger: true, confirmLabel: 'Anonimizar' }))) return;
    try { await api.post(`/contacts/${id}/anonymize`, { confirm: 'ANONIMIZAR' }); toast('Contato anonimizado'); refresh(); } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div className="space-y-5">
      {confirmDialog}
      <button onClick={() => nav(-1)} className="text-sm text-muted hover:text-ink flex items-center gap-1"><ArrowLeft className="size-4" />Voltar</button>
      <PageHeader title={c.full_name} subtitle={[c.company, c.phone, c.email].filter(Boolean).join(' · ') || 'Sem dados de contato'}
        actions={isAdmin && !c.anonymized_at && (
          <>
            <Button icon={Pencil} onClick={() => setEdit(true)}>Editar</Button>
            <Button icon={Megaphone} onClick={() => setAddCampaign(true)} disabled={c.do_not_contact}>Incluir em campanha</Button>
            {c.do_not_contact ? <Button onClick={() => setRevokeOpen(true)}>Remover bloqueio</Button> : <Button variant="danger" icon={Ban} onClick={optOut}>Não contatar</Button>}
          </>
        )} />
      {c.do_not_contact && <Alert tone="danger" title="Não contatar (opt-out)">Registrado em {fmtDateTime(c.dnc_at)}{c.dnc_by_name ? ` por ${c.dnc_by_name}` : ''}. {c.dnc_reason}</Alert>}
      {c.is_demo && <Alert tone="info">Contato fictício de demonstração.</Alert>}
      {c.anonymized_at && <Alert tone="info">Dados pessoais anonimizados em {fmtDateTime(c.anonymized_at)}.</Alert>}

      <div className="grid lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader title="Oportunidades históricas" subtitle="Dados importados — a classificação histórica nunca é alterada por novas conversões."
              actions={isAdmin && <Button size="sm" icon={Plus} onClick={() => setOppOpen(true)}>Adicionar</Button>} />
            <div className="divide-y divide-line">
              {opportunities.map((o) => (
                <div key={o.id} className="px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{o.product_name || 'Sem produto'}</span>
                    <span>{o.ref_year || <span className="text-amber-700">sem ano</span>}{o.year_inferred && <span className="text-[11px] text-amber-700"> (inferido: {o.year_source})</span>}</span>
                    <HistBadge status={o.historical_status} />
                    {o.status_manual && <Badge className="bg-white text-muted ring-line">classificado manualmente</Badge>}
                    {isAdmin && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setAdjust(o)}>Ajustar</Button>}
                  </div>
                  <p className="text-[12.5px] text-muted mt-1">
                    Entrada {fmtDate(o.created_date)} · Ganho {fmtDate(o.won_date)} · Perda {fmtDate(o.lost_date)}
                    {o.lost_reason ? ` · Motivo: ${o.lost_reason}` : ''}{o.value ? ` · ${fmtMoney(o.value)}` : ''}{o.original_owner ? ` · Resp.: ${o.original_owner}` : ''}
                  </p>
                  {o.review_reasons?.length > 0 && <p className="text-[12px] text-amber-800 mt-1">{o.review_reasons.join(' · ')}</p>}
                  {isAdmin && o.import_filename && <p className="text-[11.5px] text-muted mt-0.5">Origem: {o.import_filename}{o.source_sheet ? ` › ${o.source_sheet}` : ''}{o.source_row ? `, linha ${o.source_row}` : ''}</p>}
                </div>
              ))}
              {!opportunities.length && <p className="px-5 py-4 text-sm text-muted">Nenhuma oportunidade registrada.</p>}
            </div>
          </Card>
          <Card>
            <CardHeader title="Histórico de relacionamento" subtitle="Todas as campanhas de que o contato participou" />
            <div className="px-5 pb-5 space-y-4">
              {!participations.length && <p className="text-sm text-muted">Ainda não participou de campanhas.</p>}
              {participations.map((p) => (
                <div key={p.id} className="rounded-lg ring-1 ring-line p-4">
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <Link to={`/campanhas/${p.campaign_id}`} className="font-medium hover:underline">{p.campaign_name}</Link>
                    <CampaignBadge status={p.campaign_status} /><StatusBadge status={p.status} long />
                    <span className="text-[12px] text-muted ml-auto">{p.attempts} envio(s){p.assigned_name ? ` · ${p.assigned_name}` : ''}</span>
                  </div>
                  {p.converted_at && <p className="text-sm text-brand-700 font-medium mb-2">Convertido em {fmtDate(p.converted_at)}{p.conversion_value ? ` · ${fmtMoney(p.conversion_value)}` : ''}</p>}
                  {p.notes && <p className="text-sm text-ink/80 mb-2 whitespace-pre-line">📝 {p.notes}</p>}
                  <Timeline events={(p.events || []).map((e) => ({ ...e, created_at: e.at, message_text: e.text, to_status: e.to, user_name: e.user }))} />
                </div>
              ))}
            </div>
          </Card>
        </div>
        <Card className="p-5 space-y-3 text-sm">
          <Row label="Telefone">{c.phone || '—'}</Row>
          <Row label="E-mail">{c.email || '—'}</Row>
          <Row label="Empresa">{c.company || '—'}</Row>
          <Row label="Origem">{c.source === 'manual' ? 'Cadastro manual' : c.source === 'demo' ? 'Demonstração' : 'Importação'}</Row>
          <Row label="Cadastrado em">{fmtDateTime(c.created_at)}</Row>
          {c.notes && <Row label="Observações"><span className="whitespace-pre-line">{c.notes}</span></Row>}
          {isAdmin && !c.anonymized_at && (
            <div className="pt-3 border-t border-line space-y-2">
              <p className="text-[12px] font-semibold text-muted flex items-center gap-1"><ShieldAlert className="size-3.5" />LGPD</p>
              <Button size="sm" className="w-full" icon={Download} onClick={() => download(`/contacts/${id}/export`)}>Exportar dados do titular</Button>
              <Button size="sm" variant="danger" className="w-full" onClick={anonymize}>Anonimizar dados pessoais</Button>
            </div>
          )}
        </Card>
      </div>
      {edit && <EditContactModal c={c} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); refresh(); }} />}
      {oppOpen && <AddOppModal id={id} products={products} years={years} onClose={() => setOppOpen(false)} onSaved={() => { setOppOpen(false); refresh(); }} />}
      {adjust && <AdjustOppModal o={adjust} products={products} onClose={() => setAdjust(null)} onSaved={() => { setAdjust(null); refresh(); }} />}
      <Modal open={revokeOpen} onClose={() => setRevokeOpen(false)} title="Remover bloqueio de comunicação"
        footer={<><Button onClick={() => setRevokeOpen(false)}>Cancelar</Button><Button variant="primary" disabled={revokeReason.trim().length < 5} onClick={() => revoke(revokeReason)}>Remover bloqueio</Button></>}>
        <Field label="Motivo da liberação" hint="Fica registrado na auditoria. Ex.: cliente pediu para voltar a receber ofertas."><Input value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} /></Field>
      </Modal>
      {addCampaign && <AddToCampaignModal contactId={Number(id)} opportunities={opportunities} onClose={() => setAddCampaign(false)} onSaved={() => { setAddCampaign(false); refresh(); }} />}
    </div>
  );
}

const Row = ({ label, children }) => <div><p className="text-[12px] text-muted">{label}</p><div>{children}</div></div>;

function EditContactModal({ c, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ full_name: c.full_name, company: c.company || '', phone: c.phone || '', email: c.email || '', notes: c.notes || '' });
  const save = async () => { try { await api.patch(`/contacts/${c.id}`, f); toast('Contato atualizado'); onSaved(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <Modal open onClose={onClose} title="Editar contato" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={save}>Salvar</Button></>}>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Nome completo"><Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <Field label="Empresa"><Input value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></Field>
        <Field label="Telefone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="E-mail"><Input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Observações" className="sm:col-span-2"><Textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function AddOppModal({ id, products, years, onClose, onSaved }) {
  const toast = useToast();
  const [o, setO] = useState(EMPTY_OPP);
  const save = async () => { try { await api.post(`/contacts/${id}/opportunities`, oppPayload(o)); toast('Oportunidade adicionada'); onSaved(); } catch (e) { toast(e.message, 'error'); } };
  return (
    <Modal open onClose={onClose} title="Adicionar oportunidade" size="lg" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={save}>Salvar</Button></>}>
      <OppFields o={o} setO={setO} products={products} years={years} />
      <p className="text-[12px] text-muted mt-3">A classificação (ganho, perdido, aberto, revisão) é calculada pelas datas.</p>
    </Modal>
  );
}

function AdjustOppModal({ o, products, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ product_id: o.product_id || '', ref_year: o.ref_year || '', historical_status: o.historical_status, note: '' });
  const save = async () => {
    try {
      const body = { product_id: f.product_id ? Number(f.product_id) : null, ref_year: f.ref_year ? Number(f.ref_year) : null };
      if (f.historical_status !== o.historical_status) Object.assign(body, { historical_status: f.historical_status, note: f.note || undefined });
      await api.patch(`/contacts/opportunities/${o.id}`, body); toast('Oportunidade ajustada (registrado no histórico de auditoria)'); onSaved();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal open onClose={onClose} title="Ajustar oportunidade" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={save}>Salvar</Button></>}>
      <div className="space-y-3">
        {o.historical_status === 'revisao' && <Alert tone="warning">{(o.review_reasons || []).join(' · ') || 'Registro marcado para revisão.'} As datas originais são preservadas.</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Produto"><Select value={f.product_id} onChange={(e) => setF({ ...f, product_id: e.target.value })}><option value="">Sem produto</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label="Ano da base"><Input type="number" value={f.ref_year} onChange={(e) => setF({ ...f, ref_year: e.target.value })} /></Field>
        </div>
        <Field label="Classificação histórica"><Select value={f.historical_status} onChange={(e) => setF({ ...f, historical_status: e.target.value })}>{Object.entries(HIST).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
        {f.historical_status !== o.historical_status && <Field label="Justificativa"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>}
      </div>
    </Modal>
  );
}

function AddToCampaignModal({ contactId, opportunities, onClose, onSaved }) {
  const toast = useToast();
  const { data: campaigns = [] } = useQuery({ queryKey: ['campaigns'], queryFn: () => api.get('/campaigns') });
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => api.get('/users') });
  const [f, setF] = useState({ campaign_id: '', opportunity_id: opportunities[0]?.id || '', assigned_to: '' });
  const save = async () => {
    try {
      await api.post(`/campaigns/${f.campaign_id}/participants/add-contact`, { contact_id: contactId, opportunity_id: f.opportunity_id ? Number(f.opportunity_id) : null, assigned_to: f.assigned_to ? Number(f.assigned_to) : null });
      toast('Contato incluído na campanha'); onSaved();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal open onClose={onClose} title="Incluir em campanha" footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" disabled={!f.campaign_id} onClick={save}>Incluir</Button></>}>
      <div className="space-y-3">
        <Field label="Campanha"><Select value={f.campaign_id} onChange={(e) => setF({ ...f, campaign_id: e.target.value })}><option value="">Selecione…</option>{campaigns.filter((c) => c.status !== 'encerrada').map((c) => <option key={c.id} value={c.id}>{c.name} ({c.status})</option>)}</Select></Field>
        <Field label="Oportunidade de referência (segmento)"><Select value={f.opportunity_id} onChange={(e) => setF({ ...f, opportunity_id: e.target.value })}>{opportunities.map((o) => <option key={o.id} value={o.id}>{o.product_name || 'Sem produto'} · {o.ref_year || 's/ ano'} · {HIST[o.historical_status].label}</option>)}</Select></Field>
        <Field label="Responsável"><Select value={f.assigned_to} onChange={(e) => setF({ ...f, assigned_to: e.target.value })}><option value="">Sem responsável</option>{users.filter((u) => u.role === 'vendedora' && u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
      </div>
    </Modal>
  );
}
