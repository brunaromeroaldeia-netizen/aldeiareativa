import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { api } from '../lib/api.js';
import { useProduct } from '../lib/context.jsx';
import { HIST, fmtInt } from '../lib/format.js';
import { Card, CardHeader, PageHeader, Button, Field, Input, Textarea, Select, ChipSelect, Checkbox, Loading, Alert, HistBadge, useToast } from '../components/ui.jsx';

const EMPTY = {
  name: '', description: '', promo_description: '', start_date: '', end_date: '', product_ids: [], years: [], historical_statuses: [],
  filters: { lost_reasons: [], exclude_recent_days: 30, exclude_active_campaigns: true, exclude_converted: false, exclude_active_clients: true, previous: 'todos' },
  followup_schedule: {},
  goal_contacts: '', goal_conversions: '', goal_revenue: '', followup_days: 3, max_attempts: 3, seller_ids: [],
};

export default function CampaignForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { products, productId } = useProduct();
  const { data: years = [] } = useQuery({ queryKey: ['years'], queryFn: () => api.get('/contacts/years') });
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: () => api.get('/users') });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => api.get('/settings') });
  const { data: existing, isLoading } = useQuery({ queryKey: ['campaign', id], queryFn: () => api.get(`/campaigns/${id}`), enabled: !!id });
  const [f, setF] = useState(null);
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const sellers = users.filter((u) => u.role === 'vendedora' && u.active);

  useEffect(() => {
    if (id && existing) {
      setF({ ...EMPTY, ...existing, filters: { ...EMPTY.filters, ...existing.filters }, seller_ids: existing.sellers.map((s) => s.id),
        goal_contacts: existing.goal_contacts ?? '', goal_conversions: existing.goal_conversions ?? '', goal_revenue: existing.goal_revenue ?? '',
        start_date: existing.start_date || '', end_date: existing.end_date || '', description: existing.description || '', promo_description: existing.promo_description || '' });
    } else if (!id && !f && settings && users.length) {
      setF({ ...EMPTY, product_ids: productId ? [productId] : [], seller_ids: sellers.map((s) => s.id),
        followup_days: settings.followup_dias_padrao ?? 3, max_attempts: settings.max_tentativas_padrao ?? 3,
        filters: { ...EMPTY.filters, exclude_recent_days: settings.janela_abordagem_recente_dias ?? 30 } });
    }
  }, [id, existing, settings, users]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: lostReasons = [] } = useQuery({
    queryKey: ['lost-reasons', f?.product_ids], enabled: !!f,
    queryFn: () => api.get(`/contacts/lost-reasons?product_id=${(f.product_ids || []).join(',')}`),
  });

  useEffect(() => {
    if (!f) return undefined;
    const h = setTimeout(() => {
      api.post('/campaigns/eligibility-preview', { ...payload(f), ...(id ? { campaign_id: Number(id) } : {}) }).then(setPreview).catch(() => {});
    }, 350);
    return () => clearTimeout(h);
  }, [f, id]);

  if ((id && isLoading) || !f) return <Loading />;
  if (existing?.status === 'encerrada') return <Alert tone="warning">Campanhas encerradas não podem ser editadas. Use “Reutilizar como modelo”.</Alert>;
  const up = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const upF = (k, v) => setF((x) => ({ ...x, filters: { ...x.filters, [k]: v } }));

  const save = async () => {
    setSaving(true);
    try {
      const body = payload(f);
      if (id) { await api.patch(`/campaigns/${id}`, body); toast('Campanha atualizada'); qc.invalidateQueries({ queryKey: ['campaign', id] }); nav(`/campanhas/${id}`); }
      else { const r = await api.post('/campaigns', body); toast('Campanha criada como rascunho'); nav(`/campanhas/${r.id}?tab=participantes`); }
      qc.invalidateQueries({ queryKey: ['campaigns'] });
    } catch (e) { toast(e.message, 'error'); } finally { setSaving(false); }
  };

  return (
    <div className="max-w-5xl">
      <button onClick={() => nav(-1)} className="text-sm text-muted hover:text-ink flex items-center gap-1 mb-3"><ArrowLeft className="size-4" />Voltar</button>
      <PageHeader title={id ? 'Editar campanha' : 'Nova campanha'} subtitle="A campanha é criada sobre a base permanente; nada é reimportado nem alterado no histórico." />
      <div className="grid lg:grid-cols-[1fr_320px] gap-5 items-start">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Informações" />
            <div className="px-5 pb-5 space-y-4">
              <Field label="Nome da campanha"><Input value={f.name} onChange={(e) => up('name', e.target.value)} placeholder="Ex.: Black Friday Mesas — Novembro 2026" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Início"><Input type="date" value={f.start_date} onChange={(e) => up('start_date', e.target.value)} /></Field>
                <Field label="Encerramento"><Input type="date" value={f.end_date} onChange={(e) => up('end_date', e.target.value)} /></Field>
              </div>
              <Field label="Descrição da promoção / condição comercial"><Textarea rows={3} value={f.promo_description} onChange={(e) => up('promo_description', e.target.value)} placeholder="O que está sendo oferecido?" /></Field>
              <Field label="Observações internas"><Textarea rows={2} value={f.description} onChange={(e) => up('description', e.target.value)} /></Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="Segmentação da base" subtitle="Combine produtos, anos e status históricos. Cada segmento pode receber uma mensagem própria." />
            <div className="px-5 pb-5 space-y-4">
              <Field label="Produtos"><ChipSelect options={products.map((p) => ({ value: p.id, label: p.name }))} value={f.product_ids} onChange={(v) => up('product_ids', v)} /></Field>
              <Field label="Anos da base" hint="Nenhum selecionado = todos os anos."><ChipSelect options={years.map((y) => ({ value: y, label: String(y) }))} value={f.years} onChange={(v) => up('years', v)} /></Field>
              <Field label="Status histórico elegível"><ChipSelect options={['ganho', 'perdido', 'aberto', 'revisao'].map((h) => ({ value: h, label: HIST[h].label }))} value={f.historical_statuses} onChange={(v) => up('historical_statuses', v)} /></Field>
              {f.historical_statuses.includes('perdido') && lostReasons.length > 0 && (
                <Field label="Motivos de perda (opcional)" hint="Filtra apenas os perdidos pelos motivos selecionados."><ChipSelect options={lostReasons.map((r) => ({ value: r.reason, label: `${r.reason} (${r.n})` }))} value={f.filters.lost_reasons || []} onChange={(v) => upF('lost_reasons', v)} /></Field>
              )}
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Situação em campanhas anteriores">
                  <Select value={f.filters.previous} onChange={(e) => upF('previous', e.target.value)}>
                    <option value="todos">Todos os contatos</option>
                    <option value="nunca_abordados">Somente nunca abordados</option>
                    <option value="ja_abordados">Somente já abordados antes</option>
                  </Select>
                </Field>
                <Field label="Excluir abordados nos últimos (dias)"><Input type="number" min={0} value={f.filters.exclude_recent_days} onChange={(e) => upF('exclude_recent_days', Number(e.target.value))} /></Field>
              </div>
              <div className="flex flex-col gap-2">
                <Checkbox checked={f.filters.exclude_active_campaigns} onChange={(v) => upF('exclude_active_campaigns', v)} label="Excluir contatos que estão em outra campanha ativa" />
                <Checkbox checked={f.filters.exclude_converted} onChange={(v) => upF('exclude_converted', v)} label="Excluir contatos já convertidos em campanhas anteriores" />
                <Checkbox checked={f.filters.exclude_active_clients !== false} onChange={(v) => upF('exclude_active_clients', v)} label="Excluir clientes ativos (situação do cliente = ativo)" />
                <p className="text-[12px] text-muted">Contatos com pedido de não contato (opt-out) são sempre excluídos.</p>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Equipe, metas e follow-up" />
            <div className="px-5 pb-5 space-y-4">
              <Field label="Vendedoras responsáveis"><ChipSelect options={sellers.map((s) => ({ value: s.id, label: s.name }))} value={f.seller_ids} onChange={(v) => up('seller_ids', v)} /></Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Meta de contatos"><Input type="number" min={0} value={f.goal_contacts} onChange={(e) => up('goal_contacts', e.target.value)} /></Field>
                <Field label="Meta de conversões"><Input type="number" min={0} value={f.goal_conversions} onChange={(e) => up('goal_conversions', e.target.value)} /></Field>
                <Field label="Meta de receita (R$)"><Input type="number" min={0} value={f.goal_revenue} onChange={(e) => up('goal_revenue', e.target.value)} /></Field>
              </div>
              <div className="space-y-2">
                <p className="text-[13px] font-medium">Intervalo de cada follow-up (dias corridos após o envio anterior)</p>
                {Array.from({ length: Math.max(0, (Number(f.max_attempts) || 1) - 1) }, (_, i) => i + 2).map((step) => {
                  const rule = schedule(f).steps.find((x) => x.step === step) || { step, min: Number(f.followup_days) || 3, max: Number(f.followup_days) || 3 };
                  const setRule = (patch) => up('followup_schedule', { ...schedule(f), steps: [...schedule(f).steps.filter((x) => x.step !== step), { ...rule, ...patch }].sort((a, b) => a.step - b.step) });
                  return (
                    <div key={step} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="w-48">Follow-up {step - 1} ({step}ª abordagem)</span>
                      <span className="text-muted">de</span><Input type="number" min={1} max={60} className="w-20" value={rule.min} onChange={(e) => setRule({ min: Number(e.target.value), max: Math.max(Number(e.target.value), rule.max) })} />
                      <span className="text-muted">a</span><Input type="number" min={1} max={60} className="w-20" value={rule.max} onChange={(e) => setRule({ max: Math.max(rule.min, Number(e.target.value)) })} />
                      <span className="text-muted">dias</span>
                    </div>
                  );
                })}
                <p className="text-[12px] text-muted">Nenhum follow-up é agendado depois da data de encerramento da campanha.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Limite de abordagens" hint="Inclui a mensagem inicial. Ex.: 3 = inicial + 2 follow-ups."><Input type="number" min={1} max={6} value={f.max_attempts} onChange={(e) => up('max_attempts', Number(e.target.value))} /></Field>
                <Field label="Encerrar sem resposta após (dias)" hint="Contados da última abordagem."><Input type="number" min={1} max={60} value={schedule(f).close_after_days} onChange={(e) => up('followup_schedule', { ...schedule(f), close_after_days: Number(e.target.value) })} /></Field>
              </div>
            </div>
          </Card>
        </div>

        <div className="lg:sticky lg:top-6 space-y-4">
          <Card>
            <CardHeader title="Contatos elegíveis" subtitle="Prévia em tempo real" />
            <div className="px-5 pb-5">
              {!preview ? <Loading /> : (
                <>
                  <p className="text-3xl font-semibold tabular">{fmtInt(preview.total.eligible || 0)}</p>
                  <p className="text-[12.5px] text-muted">de {fmtInt(preview.total.matching || 0)} no segmento</p>
                  <div className="text-[12.5px] text-muted mt-3 space-y-0.5">
                    {!!preview.total.excluded_dnc && <p>− {preview.total.excluded_dnc} com opt-out</p>}
                    {!!preview.total.recent && <p>− {preview.total.recent} abordados nos últimos {preview.recentDays} dias</p>}
                    {!!preview.total.in_active && <p>{preview.excludeActive ? '−' : '⚠'} {preview.total.in_active} em outra campanha ativa</p>}
                    {!!preview.total.already && <p>{preview.total.already} já na campanha</p>}
                  </div>
                  <div className="mt-4 divide-y divide-line text-[13px] max-h-72 overflow-y-auto scroll-thin">
                    {preview.segments.map((s, i) => (
                      <div key={i} className="flex items-center justify-between py-1.5 gap-2">
                        <span className="truncate">{s.product_name?.split(' /')[0] || 'Sem produto'} · {s.ref_year || 's/ ano'}</span>
                        <span className="flex items-center gap-2"><HistBadge status={s.historical_status} /><span className="tabular w-8 text-right">{s.eligible}</span></span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </Card>
          <Button variant="primary" size="lg" className="w-full" loading={saving} onClick={save} disabled={!f.name.trim()}>{id ? 'Salvar alterações' : 'Criar campanha (rascunho)'}</Button>
          {!id && <p className="text-[12px] text-muted text-center">Em seguida você adiciona os contatos, cadastra as mensagens e distribui entre as vendedoras.</p>}
        </div>
      </div>
    </div>
  );
}

function schedule(f) {
  const s = f.followup_schedule || {};
  return { steps: s.steps || [], close_after_days: s.close_after_days ?? (Number(f.followup_days) || 3) };
}

function payload(f) {
  const n = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
  return {
    name: f.name || 'prévia', description: f.description || null, promo_description: f.promo_description || null,
    start_date: f.start_date || null, end_date: f.end_date || null, product_ids: f.product_ids, years: f.years, historical_statuses: f.historical_statuses,
    filters: f.filters, goal_contacts: n(f.goal_contacts), goal_conversions: n(f.goal_conversions), goal_revenue: n(f.goal_revenue),
    followup_days: schedule(f).steps.find((x) => x.step === 2)?.min || Number(f.followup_days) || 3, max_attempts: Number(f.max_attempts) || 3, seller_ids: f.seller_ids,
    followup_schedule: { steps: schedule(f).steps.filter((x) => x.step <= (Number(f.max_attempts) || 3)), close_after_days: schedule(f).close_after_days },
  };
}
