import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell, LabelList } from 'recharts';
import { Info } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useAuth, useProduct } from '../lib/context.jsx';
import { HIST, fmtInt, fmtPct, fmtMoney, fmtDate, todayIso, addDaysIso } from '../lib/format.js';
import { Card, CardHeader, PageHeader, Kpi, Loading, Select, Input, Button, CampaignBadge, cx } from '../components/ui.jsx';
import { useFilterOptions } from './Operation.jsx';

// paleta categórica validada (ordem fixa) + tinta de texto neutra
const C = { sent: '#2a78d6', resp: '#eb6834', conv: '#1baf7a', grid: '#ecebe7', axis: '#8a8984', brand: '#3f6b55' };
const SELLER_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];

const PRESETS = [
  { v: '30', label: 'Últimos 30 dias' }, { v: '7', label: 'Últimos 7 dias' }, { v: '90', label: 'Últimos 90 dias' },
  { v: 'all', label: 'Todo o período' }, { v: 'custom', label: 'Personalizado' },
];

export default function Dashboard() {
  const { isAdmin, user } = useAuth();
  const { productId, setProductId, products } = useProduct();
  const { campaigns, years, sellers } = useFilterOptions();
  const nav = useNavigate();
  const [preset, setPreset] = useState('all');
  const [range, setRange] = useState({ from: '', to: '' });
  const [f, setF] = useState({ year: '', hist: '', campaign_id: '', seller: '' });
  const t = todayIso();
  const period = preset === 'all' ? {} : preset === 'custom' ? range : { from: addDaysIso(t, -Number(preset) + 1), to: t };
  const filters = { ...f, ...period, product_id: productId || '' };
  const { data, isLoading } = useQuery({ queryKey: ['dashboard', filters], queryFn: () => api.get(`/dashboard${qs(filters)}`), refetchInterval: 60000, placeholderData: (p) => p });
  const drill = (metric, extra = {}) => nav(`/operacao${qs({ ...filters, metric, ...extra })}`);

  if (!data && isLoading) return <Loading />;
  const k = data.kpis;
  const b = data.base;

  return (
    <div className="space-y-5">
      <PageHeader title="Dashboard de Gestão" subtitle={isAdmin ? 'Indicadores calculados a partir dos registros do banco de dados.' : `Números gerais da operação. Use o filtro de vendedora para ver só os seus, ${user.name.split(' ')[0]}.`} />

      <Card className="p-3 sticky top-14 lg:top-0 z-10">
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2">
          <Select value={preset} onChange={(e) => setPreset(e.target.value)}>{PRESETS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}</Select>
          {preset === 'custom' && (
            <div className="col-span-2 flex gap-2"><Input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /><Input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></div>
          )}
          <Select value={productId || ''} onChange={(e) => setProductId(Number(e.target.value) || null)}><option value="">Todos os produtos</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          <Select value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })}><option value="">Todos os anos da base</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select>
          <Select value={f.hist} onChange={(e) => setF({ ...f, hist: e.target.value })}><option value="">Todos os status históricos</option>{Object.entries(HIST).map(([key, v]) => <option key={key} value={key}>{v.label}</option>)}</Select>
          <Select value={f.campaign_id} onChange={(e) => setF({ ...f, campaign_id: e.target.value })}><option value="">Todas as campanhas</option>{campaigns.filter((c) => c.status !== 'rascunho').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          <Select value={f.seller} onChange={(e) => setF({ ...f, seller: e.target.value })}><option value="">Todas as vendedoras</option>{sellers.map((s) => <option key={s.id} value={s.id}>{s.name}{!isAdmin && s.id === user.id ? ' (você)' : ''}</option>)}</Select>
        </div>
        {(period.from || period.to) && <p className="text-[12px] text-muted mt-2 flex items-center gap-1"><Info className="size-3.5" />Período {fmtDate(period.from)} a {fmtDate(period.to)}: resultados consideram os contatos cujo primeiro envio ocorreu no período; mensagens contam pela data de cada envio.</p>}
      </Card>

      <section>
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted mb-2">Base e produtividade</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <Kpi label="Contatos na base" value={fmtInt(b.contacts)} sub={`${fmtInt(b.opportunities)} oportunidades`} hint="Contatos importados/cadastrados que atendem aos filtros de produto, ano e status" />
          <Kpi label="Elegíveis p/ campanhas" value={fmtInt(b.eligible)} sub={`${fmtInt(b.dnc)} com opt-out`} />
          <Kpi label="Atribuídos" value={fmtInt(k.assigned)} onClick={() => drill('atribuidos')} />
          <Kpi label="Trabalhados" value={fmtInt(k.worked)} sub={k.assigned ? `${fmtPct((k.worked / k.assigned) * 100)} dos atribuídos` : null} onClick={() => drill('trabalhados')} />
          <Kpi label="Mensagens enviadas" value={fmtInt(k.messages)} sub={`${k.messages_per_contact ?? '—'} por contato`} hint="Total de envios confirmados (um contato pode receber várias abordagens). Mensagens apenas copiadas não contam." onClick={() => drill('enviados')} />
          <Kpi label="Pendentes de envio" value={fmtInt(k.pending)} onClick={() => drill('pendentes')} />
          <Kpi label="Follow-ups realizados" value={fmtInt(k.followups_done)} />
          <Kpi label="Follow-ups atrasados" value={fmtInt(k.followups_overdue)} tone={k.followups_overdue ? 'danger' : undefined} onClick={() => drill('followups_atrasados')} />
        </div>
      </section>

      <section>
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted mb-2">Resultados</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <Kpi label="Contatos com envio" value={fmtInt(k.sent)} hint="Contatos com ao menos um envio confirmado (base das taxas)" onClick={() => drill('enviados')} />
          <Kpi label="Responderam" value={fmtInt(k.responded)} sub={`Taxa de resposta ${fmtPct(k.response_rate)}`} onClick={() => drill('responderam')} />
          <Kpi label="Interessados" value={fmtInt(k.interested)} sub={`${fmtInt(k.negotiation)} negociações`} onClick={() => drill('interessados')} />
          <Kpi label="Conversões" value={fmtInt(k.converted)} tone="brand" sub={`Taxa de conversão ${fmtPct(k.conversion_rate)}`} onClick={() => drill('convertidos')} />
          <Kpi label="Conversão s/ respondentes" value={fmtPct(k.conversion_over_responded)} hint="Convertidos ÷ contatos que responderam" />
          <Kpi label="Conversão s/ interessados" value={fmtPct(k.conversion_over_interested)} hint="Convertidos ÷ contatos que demonstraram interesse" />
          <Kpi label="Sem interesse · sem resposta" value={`${fmtInt(k.no_interest)} · ${fmtInt(k.no_response)}`} sub={`${fmtInt(k.awaiting)} aguardando`} onClick={() => drill('sem_resposta')} />
          <Kpi label="Receita recuperada" value={fmtMoney(k.revenue, true)} tone="brand" sub="quando informada" onClick={() => drill('convertidos')} />
        </div>
        <p className="text-[12px] text-muted mt-2">Taxa de resposta = responderam ÷ contatos com envio confirmado × 100. Taxa de conversão = convertidos ÷ contatos com envio confirmado × 100. Clique em um indicador para abrir a lista de contatos.</p>
      </section>

      <div className="grid xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2">
          <CardHeader title="Mensagens enviadas e respostas por dia" subtitle={`${fmtDate(data.period.chartStart)} a ${fmtDate(data.period.chartEnd)}`} />
          <div className="h-64 px-2 pb-3">
            <ResponsiveContainer>
              <LineChart data={data.daily} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis dataKey="day" tickFormatter={(d) => d.slice(8, 10) + '/' + d.slice(5, 7)} tick={{ fontSize: 11, fill: C.axis }} axisLine={false} tickLine={false} minTickGap={20} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: C.axis }} axisLine={false} tickLine={false} />
                <Tooltip labelFormatter={(d) => fmtDate(d)} contentStyle={{ borderRadius: 8, border: '1px solid #e7e5e0', fontSize: 12 }} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
                <Line type="linear" dataKey="sent" name="Mensagens enviadas" stroke={C.sent} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                <Line type="linear" dataKey="responses" name="Respostas" stroke={C.resp} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <CardHeader title="Funil da reativação" subtitle="Clique em uma etapa para ver os contatos" />
          <div className="px-5 pb-5 space-y-2.5">
            {data.funnel.map((s, i) => {
              const max = data.funnel[0].value || 1;
              const prev = i > 0 ? data.funnel[i - 1].value : null;
              return (
                <button key={s.key} onClick={() => drill(s.key)} className="w-full text-left group">
                  <div className="flex justify-between text-[13px] mb-1"><span>{s.label}</span><span className="tabular font-medium">{fmtInt(s.value)}{prev ? <span className="text-muted font-normal"> · {fmtPct((s.value / prev) * 100)}</span> : null}</span></div>
                  <div className="h-2.5 rounded-full bg-stone-100 overflow-hidden"><div className="h-full rounded-full bg-brand-500 group-hover:bg-brand-600 transition" style={{ width: `${(s.value / max) * 100}%` }} /></div>
                </button>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="grid xl:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="Evolução das conversões" subtitle="Conversões registradas por dia" />
          <div className="h-56 px-2 pb-3">
            <ResponsiveContainer>
              <BarChart data={data.daily} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis dataKey="day" tickFormatter={(d) => d.slice(8, 10) + '/' + d.slice(5, 7)} tick={{ fontSize: 11, fill: C.axis }} axisLine={false} tickLine={false} minTickGap={20} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: C.axis }} axisLine={false} tickLine={false} />
                <Tooltip labelFormatter={(d) => fmtDate(d)} formatter={(v, n, p) => [n === 'Conversões' ? `${v}${p.payload.revenue ? ` (${fmtMoney(p.payload.revenue, true)})` : ''}` : v, n]} contentStyle={{ borderRadius: 8, border: '1px solid #e7e5e0', fontSize: 12 }} cursor={{ fill: '#f4f3ef' }} />
                <Bar dataKey="conversions" name="Conversões" fill={C.brand} radius={[4, 4, 0, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <SellerCompare rows={data.bySeller} />
      </div>

      <div className="grid xl:grid-cols-3 gap-4">
        <BreakdownCard title="Desempenho por produto" rows={data.byProduct} onPick={(r) => r.key && setProductId(r.key)} />
        <BreakdownCard title="Comparativo entre bases (ano)" rows={data.byYear} onPick={(r) => r.key && setF({ ...f, year: String(r.key) })} />
        <BreakdownCard title="Conversões por status histórico" rows={data.byHist} onPick={(r) => r.key && setF({ ...f, hist: r.key })} />
      </div>

      <Card>
        <CardHeader title="Ranking de campanhas" subtitle={`${data.campaigns.ativas} ativas · ${data.campaigns.pausadas} pausadas · ${data.campaigns.encerradas} encerradas · ${data.campaigns.planejadas} planejadas`} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-[12px] text-muted border-y border-line text-left">
              <th className="font-medium px-5 py-2">#</th><th className="font-medium py-2">Campanha</th><th className="font-medium px-2 text-right">Participantes</th><th className="font-medium px-2 text-right">Com envio</th>
              <th className="font-medium px-2 text-right">Resposta</th><th className="font-medium px-2 text-right">Conversões</th><th className="font-medium px-2 text-right">Conversão</th><th className="font-medium px-5 text-right">Receita</th>
            </tr></thead>
            <tbody>
              {data.ranking.map((r, i) => (
                <tr key={r.key} className="border-b border-line/60 last:border-0">
                  <td className="px-5 py-2.5 text-muted tabular">{i + 1}</td>
                  <td className="py-2.5"><Link to={`/campanhas/${r.key}`} className="font-medium hover:underline">{r.label}</Link> <CampaignBadge status={r.status} /></td>
                  <td className="px-2 text-right tabular">{fmtInt(r.participants)}</td><td className="px-2 text-right tabular">{fmtInt(r.sent)}</td>
                  <td className="px-2 text-right tabular">{fmtPct(r.response_rate)}</td><td className="px-2 text-right tabular font-semibold text-brand-700">{fmtInt(r.converted)}{r.goal_conversions ? <span className="text-muted font-normal">/{r.goal_conversions}</span> : ''}</td>
                  <td className="px-2 text-right tabular">{fmtPct(r.conversion_rate)}</td><td className="px-5 text-right tabular">{fmtMoney(r.revenue, true)}</td>
                </tr>
              ))}
              {!data.ranking.length && <tr><td colSpan={8} className="px-5 py-6 text-center text-muted">Sem campanhas com dados para os filtros.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      {data.unassigned?.participants > 0 && <p className="text-[12px] text-muted">{data.unassigned.participants} participante(s) sem responsável não aparecem no comparativo de vendedoras.</p>}
      <div className="flex justify-end"><Button onClick={() => nav('/relatorios')}>Exportar relatórios</Button></div>
    </div>
  );
}

function BreakdownCard({ title, rows, onPick }) {
  const data = rows.filter((r) => r.participants > 0);
  return (
    <Card>
      <CardHeader title={title} />
      <div className="h-44 px-2">
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 28, left: 8, bottom: 0 }} barCategoryGap={6}>
            <XAxis type="number" hide allowDecimals={false} />
            <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 11.5, fill: '#52514e' }} axisLine={false} tickLine={false} tickFormatter={(v) => String(v).split(' /')[0]} />
            <Tooltip cursor={{ fill: '#f4f3ef' }} contentStyle={{ borderRadius: 8, border: '1px solid #e7e5e0', fontSize: 12 }}
              formatter={(v, n, p) => [`${v} (${fmtPct(p.payload.conversion_rate)} dos contatos com envio)`, 'Conversões']} />
            <Bar dataKey="converted" name="Conversões" radius={[0, 4, 4, 0]} maxBarSize={16} onClick={(d) => onPick(d)} cursor="pointer">
              {data.map((r, i) => <Cell key={i} fill={C.brand} />)}
              <LabelList dataKey="converted" position="right" style={{ fontSize: 11, fill: '#52514e' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="w-full text-[12.5px] mt-1">
        <thead><tr className="text-muted border-y border-line text-left"><th className="font-medium px-5 py-1.5"></th><th className="font-medium px-1 text-right">Envio</th><th className="font-medium px-1 text-right">Resp.</th><th className="font-medium px-1 text-right">Conv.</th><th className="font-medium px-5 text-right">Receita</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={String(r.key)} className="border-b border-line/50 last:border-0">
            <td className="px-5 py-1.5 truncate max-w-[130px]">{String(r.label).split(' /')[0]}</td><td className="px-1 text-right tabular">{r.sent}</td>
            <td className="px-1 text-right tabular">{fmtPct(r.response_rate)}</td><td className="px-1 text-right tabular">{fmtPct(r.conversion_rate)}</td><td className="px-5 text-right tabular">{fmtMoney(r.revenue, true)}</td>
          </tr>
        ))}</tbody>
      </table>
    </Card>
  );
}

function SellerCompare({ rows }) {
  const lines = [
    ['Contatos atribuídos', (r) => fmtInt(r.assigned)],
    ['Contatos trabalhados', (r) => fmtInt(r.worked)],
    ['Mensagens enviadas', (r) => fmtInt(r.messages)],
    ['Respostas recebidas', (r) => fmtInt(r.responded)],
    ['Taxa de resposta', (r) => fmtPct(r.response_rate), 'response_rate'],
    ['Conversões', (r) => fmtInt(r.converted), 'converted'],
    ['Taxa de conversão', (r) => fmtPct(r.conversion_rate), 'conversion_rate'],
    ['Conversão s/ respondentes', (r) => fmtPct(r.conversion_over_responded), 'conversion_over_responded'],
    ['Receita recuperada', (r) => fmtMoney(r.revenue, true), 'revenue'],
    ['Follow-ups atrasados', (r) => fmtInt(r.followups_overdue)],
  ];
  return (
    <Card>
      <CardHeader title="Comparativo das vendedoras" subtitle="Produtividade (volume) e eficiência (taxas) lado a lado" />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-[12px] text-muted border-y border-line text-left"><th className="font-medium px-5 py-2">Indicador</th>
            {rows.map((r, i) => <th key={r.key} className="font-medium px-5 text-right"><span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: SELLER_COLORS[i % 4] }} />{r.label}</span></th>)}</tr></thead>
          <tbody>
            {lines.map(([label, fn, best]) => {
              const vals = rows.map((r) => (best ? r[best] ?? -1 : null));
              const top = best ? Math.max(...vals) : null;
              return (
                <tr key={label} className="border-b border-line/60 last:border-0">
                  <td className="px-5 py-2 text-ink/80">{label}</td>
                  {rows.map((r, i) => <td key={r.key} className={cx('px-5 text-right tabular', best && vals[i] === top && top > 0 && rows.length > 1 && 'font-semibold text-brand-700')}>{fn(r)}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
