import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useAuth, useProduct } from '../lib/context.jsx';
import { fmtDate, relDays, HIST } from '../lib/format.js';
import { Card, PageHeader, Loading, EmptyState, StatusBadge, Select, Drawer, Alert, cx } from '../components/ui.jsx';
import ParticipantPanel from '../components/ParticipantPanel.jsx';
import { useFilterOptions } from './Operation.jsx';

const WEEK = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export default function Followups() {
  const { isAdmin } = useAuth();
  const { productId } = useProduct();
  const { campaigns, sellers } = useFilterOptions();
  const [f, setF] = useState({ campaign_id: '', seller: '', days: 14 });
  const [openId, setOpenId] = useState(null);
  const { data, isLoading } = useQuery({ queryKey: ['agenda', f, productId], queryFn: () => api.get(`/dashboard/agenda${qs({ ...f, product_id: productId })}`) });
  const today = data?.today;
  const rows = data?.rows || [];
  const until = (r) => r.due_until || r.due_date;
  const overdue = rows.filter((r) => until(r) < today);
  const byDay = rows.filter((r) => until(r) >= today).map((r) => ({ ...r, due_date: r.due_date < today ? today : r.due_date })).reduce((a, r) => { (a[r.due_date] ||= []).push(r); return a; }, {});
  const ids = rows.map((r) => r.id);
  const idx = ids.indexOf(openId);

  const Section = ({ title, items, tone, sub }) => (
    <Card className={cx(tone === 'danger' && 'ring-rose-200')}>
      <div className={cx('px-5 py-3 border-b border-line flex items-center justify-between', tone === 'danger' && 'bg-rose-50/60')}>
        <p className={cx('font-semibold text-sm', tone === 'danger' && 'text-rose-700')}>{title}</p>
        <span className="text-[12px] text-muted">{sub} · {items.length} contato(s)</span>
      </div>
      <ul className="divide-y divide-line">
        {items.map((r) => (
          <li key={`${r.followup_id}`} onClick={() => setOpenId(r.id)} className="px-5 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm cursor-pointer hover:bg-stone-50">
            <span className="font-medium min-w-40">{r.full_name}</span>
            <span className="text-muted tabular">{r.phone}</span>
            <span className="text-[12.5px] text-muted">{r.product_name?.split(' /')[0]} · {r.ref_year} · {HIST[r.historical_status]?.label}</span>
            <span className="text-[12.5px]">{r.followup_type === 'retorno' ? 'Retorno combinado' : `Follow-up ${r.step - 1} (${r.step}ª abordagem)`}{r.due_until && r.due_until !== r.due_date ? ` · até ${fmtDate(r.due_until)}` : ''}</span>
            <StatusBadge status={r.status} />
            {tone === 'danger' && <span className="text-[12px] text-rose-600 font-medium">prazo até {fmtDate(until(r))} ({relDays(until(r), today)})</span>}
            {isAdmin && <span className="text-[12px] text-muted ml-auto">{r.assigned_name || 'sem responsável'}</span>}
            <span className="text-[12px] text-muted hidden lg:inline">{r.campaign_name}</span>
          </li>
        ))}
      </ul>
    </Card>
  );

  return (
    <div>
      <PageHeader title="Follow-ups" subtitle="Agenda persistente de próximas ações. Nenhuma mensagem é enviada automaticamente."
        actions={(
          <>
            <Select className="w-56" value={f.campaign_id} onChange={(e) => setF({ ...f, campaign_id: e.target.value })}><option value="">Campanhas ativas</option>{campaigns.filter((c) => c.status === 'ativa').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
            {isAdmin && <Select className="w-44" value={f.seller} onChange={(e) => setF({ ...f, seller: e.target.value })}><option value="">Todas</option>{sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}
            <Select className="w-36" value={f.days} onChange={(e) => setF({ ...f, days: Number(e.target.value) })}><option value={7}>7 dias</option><option value={14}>14 dias</option><option value={30}>30 dias</option><option value={60}>60 dias</option></Select>
          </>
        )} />
      {data?.suspended > 0 && <Alert tone="info" className="mb-4">{data.suspended} follow-up(s) suspensos por encerramento de campanha (podem ser reprogramados pela administradora na ficha do contato).</Alert>}
      {isLoading ? <Loading /> : !rows.length ? <Card><EmptyState icon={CalendarCheck} title="Nenhum follow-up no período">Os follow-ups são criados automaticamente após cada envio confirmado.</EmptyState></Card> : (
        <div className="space-y-4">
          {overdue.length > 0 && <Section title="Atrasados" items={overdue} tone="danger" sub="prioridade" />}
          {Object.entries(byDay).map(([d, items]) => (
            <Section key={d} title={d === today ? 'Hoje' : `${WEEK[new Date(`${d}T12:00:00`).getDay()]}, ${fmtDate(d)}`} items={items} sub={relDays(d, today)} />
          ))}
        </div>
      )}
      <Drawer open={!!openId} onClose={() => setOpenId(null)}>
        {openId && <ParticipantPanel id={openId} onClose={() => setOpenId(null)} position={idx >= 0 ? `${idx + 1} de ${ids.length}` : undefined}
          onPrev={idx > 0 ? () => setOpenId(ids[idx - 1]) : undefined} onNext={idx >= 0 && idx < ids.length - 1 ? () => setOpenId(ids[idx + 1]) : undefined} />}
      </Drawer>
    </div>
  );
}
