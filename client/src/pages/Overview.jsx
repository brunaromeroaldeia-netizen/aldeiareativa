import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Send, CalendarClock, AlertTriangle, Handshake, ArrowRight, Megaphone, Upload, FlaskConical } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth, useProduct } from '../lib/context.jsx';
import { fmtInt, fmtPct, fmtMoney, fmtDateTime, fmtDate, STATUS } from '../lib/format.js';
import { Card, CardHeader, PageHeader, Loading, Kpi, Progress, CampaignBadge, Button, Alert, EmptyState, cx } from '../components/ui.jsx';

export default function Overview() {
  const { user, isAdmin } = useAuth();
  const { productId, product } = useProduct();
  const nav = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['overview', productId],
    queryFn: () => api.get(`/dashboard/overview${productId ? `?product_id=${productId}` : ''}`),
    refetchInterval: 60000,
  });
  if (isLoading || !data) return <Loading />;
  const { agenda, mine, all, active, recent } = data;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const tiles = [
    { label: 'Para enviar hoje', value: agenda.para_enviar, icon: Send, to: '/operacao?queue=para_enviar' },
    { label: 'Follow-ups de hoje', value: agenda.followups_hoje, icon: CalendarClock, to: '/operacao?queue=followups_hoje', tone: 'warning' },
    { label: 'Atrasados', value: agenda.atrasados, icon: AlertTriangle, to: '/operacao?queue=atrasados', tone: 'danger' },
    { label: 'Em negociação', value: agenda.negociacao, icon: Handshake, to: '/operacao?queue=negociacao' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={`${greet}, ${user.name.split(' ')[0]}!`}
        subtitle={`${product ? product.name : 'Todos os produtos'} · ${isAdmin ? 'visão da operação' : 'sua fila de trabalho'} em ${fmtDate(data.today)}`}
        actions={<Button variant="primary" icon={Send} onClick={() => nav('/operacao')}>{isAdmin ? 'Abrir operação' : 'Começar a trabalhar'}</Button>} />

      {isAdmin && (data.accessRequests?.n > 0 || data.demo?.contacts > 0 || data.pendingImports?.n > 0 || data.review?.revisao > 0) && (
        <div className="grid gap-2">
          {data.accessRequests?.n > 0 && <Alert tone="warning" title="Pedido de recuperação de acesso"><Link to="/configuracoes" className="underline">{data.accessRequests.n} usuária(s) pediram redefinição de senha — gerar link em Configurações</Link></Alert>}
          {data.demo?.contacts > 0 && <Alert tone="info" title="Dados de demonstração ativos">A base contém {data.demo.contacts} contatos fictícios e {data.demo.campaigns} campanhas de exemplo (marcados como “Exemplo”). <Link to="/configuracoes?tab=dados" className="underline">Remover antes da importação real</Link>.</Alert>}
          {data.pendingImports?.n > 0 && <Alert tone="info"><Link to="/importacoes" className="underline">{data.pendingImports.n} importação(ões) aguardando confirmação</Link></Alert>}
          {data.review?.revisao > 0 && <Alert tone="warning"><Link to="/contatos?hist=revisao" className="underline">{data.review.revisao} oportunidade(s) com “revisão necessária”</Link>{data.review.sem_ano ? ` · ${data.review.sem_ano} sem ano identificado` : ''}</Alert>}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map((t) => (
          <Link key={t.label} to={t.to} className={cx('group rounded-xl bg-white ring-1 ring-line border-t-[3px] px-4 py-4 hover:shadow-md transition', t.tone === 'danger' && t.value ? 'border-rose-600' : t.tone === 'warning' && t.value ? 'border-amber-700' : 'border-ink')}>
            <div className="flex items-center justify-between">
              <p className="text-[13px] text-muted">{t.label}</p>
              <t.icon className={cx('size-4', t.tone === 'danger' && t.value ? 'text-rose-500' : t.tone === 'warning' && t.value ? 'text-amber-500' : 'text-stone-400')} />
            </div>
            <p className={cx('font-display text-[30px] font-extrabold tabular mt-1 tracking-tight', t.tone === 'danger' && t.value ? 'text-rose-600' : '')}>{fmtInt(t.value)}</p>
            <p className="text-[12px] text-brand-700 mt-1 opacity-0 group-hover:opacity-100 transition flex items-center gap-1">Abrir fila <ArrowRight className="size-3" /></p>
          </Link>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader title="Campanhas em andamento" subtitle="Progresso e resultados das campanhas ativas e pausadas"
            actions={<Link to="/campanhas" className="text-sm text-brand-700 hover:underline">Ver todas</Link>} />
          {!active.length ? (
            <EmptyState icon={Megaphone} title="Nenhuma campanha ativa" action={isAdmin && <Button variant="primary" onClick={() => nav('/campanhas/nova')}>Criar campanha</Button>}>
              Crie uma campanha sobre a base permanente para começar.
            </EmptyState>
          ) : (
            <div className="divide-y divide-line">
              {active.map((c) => {
                const total = isAdmin ? c.participants : c.mine;
                const worked = isAdmin ? c.worked : c.mine_worked;
                return (
                  <Link key={c.id} to={`/campanhas/${c.id}`} className="block px-5 py-3.5 hover:bg-stone-50">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{c.name}</p><CampaignBadge status={c.status} />
                      <span className="text-[12px] text-muted ml-auto">{c.end_date ? `até ${fmtDate(c.end_date)}` : ''}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-2">
                      <Progress value={worked} max={total} className="flex-1" />
                      <span className="text-[12px] text-muted tabular whitespace-nowrap">{worked}/{total} {isAdmin ? 'trabalhados' : 'seus trabalhados'}</span>
                    </div>
                    <p className="text-[12.5px] text-muted mt-1.5 tabular">
                      {c.sent} enviados · {c.responded} responderam ({fmtPct(c.sent ? (c.responded / c.sent) * 100 : null)}) · <span className="text-brand-700 font-medium">{c.converted} conversões</span>
                      {c.goal_conversions ? ` de ${c.goal_conversions}` : ''}{c.revenue ? ` · ${fmtMoney(c.revenue, true)}` : ''}
                    </p>
                  </Link>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title={isAdmin ? 'Resultados gerais' : 'Seus resultados'} subtitle="Campanhas ativas e pausadas" />
          <div className="grid grid-cols-2 gap-2 px-5 pb-5">
            <Kpi label="Contatos com envio" value={fmtInt(mine.sent)} />
            <Kpi label="Taxa de resposta" value={fmtPct(mine.response_rate)} />
            <Kpi label="Conversões" value={fmtInt(mine.converted)} tone="brand" />
            <Kpi label="Taxa de conversão" value={fmtPct(mine.conversion_rate)} />
            <Kpi label="Mensagens enviadas" value={fmtInt(mine.messages)} sub={`${fmtInt(mine.followups_done)} follow-ups`} />
            <Kpi label="Receita recuperada" value={fmtMoney(mine.revenue, true)} />
          </div>
          {!isAdmin && (
            <p className="px-5 pb-4 -mt-2 text-[12px] text-muted">Operação geral: {fmtInt(all.converted)} conversões · {fmtPct(all.response_rate)} de resposta. <Link to="/dashboard" className="text-brand-700 hover:underline">Ver dashboard</Link></p>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Atividade recente" />
        {!recent.length ? <p className="px-5 pb-5 text-sm text-muted">Nenhuma atividade registrada ainda.</p> : (
          <ul className="divide-y divide-line">
            {recent.map((r) => (
              <li key={r.id} className="px-5 py-2.5 text-sm flex flex-wrap items-center gap-x-2">
                <span className="font-medium">{r.user_name || 'Sistema'}</span>
                <span className="text-muted">{r.type === 'envio' ? `enviou ${r.attempt > 1 ? `follow-up (${r.attempt}ª)` : 'mensagem'} para` : r.type === 'conversao' ? 'registrou conversão de' : r.type === 'opt_out' ? 'registrou opt-out de' : `marcou "${STATUS[r.to_status]?.long}" em`}</span>
                <span className="font-medium">{r.full_name}</span>
                {r.value ? <span className="text-brand-700 font-medium">{fmtMoney(r.value)}</span> : null}
                <span className="text-[12px] text-muted ml-auto">{r.campaign_name} · {fmtDateTime(r.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {isAdmin && (
        <div className="grid sm:grid-cols-3 gap-3">
          {[
            { to: '/importacoes', icon: Upload, t: 'Importar planilha', d: 'Adicionar novas bases sem apagar o histórico' },
            { to: '/campanhas/nova', icon: Megaphone, t: 'Nova campanha', d: 'Segmentar a base por produto, ano e status' },
            { to: '/configuracoes?tab=dados', icon: FlaskConical, t: 'Dados de demonstração', d: 'Carregar ou remover exemplos' },
          ].map((x) => (
            <Link key={x.to} to={x.to} className="rounded-xl bg-white ring-1 ring-line p-4 hover:ring-brand-200 flex gap-3">
              <x.icon className="size-5 text-brand-600 shrink-0 mt-0.5" />
              <div><p className="font-medium text-sm">{x.t}</p><p className="text-[12.5px] text-muted">{x.d}</p></div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
