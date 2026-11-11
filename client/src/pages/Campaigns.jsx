import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Megaphone, Copy } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth, useProduct } from '../lib/context.jsx';
import { fmtDate, fmtInt, fmtPct, fmtMoney, HIST } from '../lib/format.js';
import { Card, PageHeader, Tabs, Button, CampaignBadge, Progress, EmptyState, Loading, DemoTag, useToast } from '../components/ui.jsx';
import MessageEditor from '../components/MessageEditor.jsx';

export default function Campaigns() {
  const { isAdmin } = useAuth();
  const { productId, product } = useProduct();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'andamento';
  const nav = useNavigate();
  const toast = useToast();
  const { data = [], isLoading } = useQuery({ queryKey: ['campaigns', productId], queryFn: () => api.get(`/campaigns${productId ? `?product_id=${productId}` : ''}`) });
  const groups = {
    andamento: data.filter((c) => ['ativa', 'pausada'].includes(c.status)),
    planejadas: data.filter((c) => c.status === 'rascunho'),
    encerradas: data.filter((c) => c.status === 'encerrada'),
  };
  const tabs = [
    { value: 'andamento', label: 'Em andamento', count: groups.andamento.length },
    ...(isAdmin ? [{ value: 'planejadas', label: 'Planejadas (rascunho)', count: groups.planejadas.length }] : []),
    { value: 'encerradas', label: 'Encerradas', count: groups.encerradas.length },
    ...(isAdmin ? [{ value: 'biblioteca', label: 'Banco de mensagens' }] : []),
  ];
  const list = groups[tab] || [];
  const duplicate = async (c) => {
    try { const r = await api.post(`/campaigns/${c.id}/duplicate`, {}); toast('Campanha duplicada como rascunho'); nav(`/campanhas/${r.id}/editar`); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <div>
      <PageHeader title="Campanhas" subtitle={`Campanhas criadas sobre a base permanente${product ? ` · ${product.name}` : ''}`}
        actions={isAdmin && <Button variant="primary" icon={Plus} onClick={() => nav('/campanhas/nova')}>Nova campanha</Button>} />
      <Tabs tabs={tabs} value={tab} onChange={(v) => setSp({ tab: v })} className="mb-4" />
      {tab === 'biblioteca' ? (
        <div>
          <p className="text-sm text-muted mb-4">Modelos reutilizáveis. Para usar em uma campanha, abra a campanha › Mensagens › “Usar modelo existente”.</p>
          <MessageEditor campaignId={null} />
        </div>
      ) : isLoading ? <Loading /> : !list.length ? (
        <Card><EmptyState icon={Megaphone} title="Nenhuma campanha aqui" action={isAdmin && tab !== 'encerradas' && <Button variant="primary" icon={Plus} onClick={() => nav('/campanhas/nova')}>Criar campanha</Button>}>
          {tab === 'encerradas' ? 'Campanhas encerradas ficam preservadas aqui para consulta.' : 'Crie campanhas a qualquer momento, sem reimportar a base.'}
        </EmptyState></Card>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {list.map((c) => (
            <Card key={c.id} className="flex flex-col hover:ring-brand-200 transition">
              <Link to={`/campanhas/${c.id}`} className="p-5 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold leading-snug">{c.name}</p>
                  <CampaignBadge status={c.status} />
                </div>
                <p className="text-[12.5px] text-muted mt-1">{c.product_names.join(', ') || 'Todos os produtos'} · {c.years.join(', ') || 'todos os anos'} · {c.historical_statuses.map((h) => HIST[h]?.label).join(', ') || 'todos os status'}</p>
                <p className="text-[12.5px] text-muted mt-0.5">{fmtDate(c.start_date)} – {fmtDate(c.end_date)}{c.is_demo && <span className="ml-2"><DemoTag /></span>}</p>
                <div className="mt-4">
                  <div className="flex justify-between text-[12px] text-muted mb-1"><span>{isAdmin ? 'Trabalhados' : 'Participantes'}</span><span className="tabular">{fmtInt(c.worked)} / {fmtInt(c.participants)}</span></div>
                  <Progress value={c.worked} max={c.participants} />
                </div>
                <div className="grid grid-cols-4 gap-2 mt-4 text-center">
                  <Stat label="Enviados" v={fmtInt(c.sent)} />
                  <Stat label="Resposta" v={fmtPct(c.sent ? (c.responded / c.sent) * 100 : null)} />
                  <Stat label="Conversões" v={`${fmtInt(c.converted)}${c.goal_conversions ? `/${c.goal_conversions}` : ''}`} />
                  <Stat label="Receita" v={fmtMoney(c.revenue, true)} />
                </div>
              </Link>
              {isAdmin && (
                <div className="border-t border-line px-5 py-2.5 flex justify-end">
                  <Button size="sm" variant="ghost" icon={Copy} onClick={() => duplicate(c)}>Reutilizar como modelo</Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

const Stat = ({ label, v }) => <div><p className="text-[15px] font-semibold tabular">{v}</p><p className="text-[11px] text-muted">{label}</p></div>;
