import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, FileText, Eye } from 'lucide-react';
import { api, qs, download } from '../lib/api.js';
import { useAuth, useProduct } from '../lib/context.jsx';
import { HIST } from '../lib/format.js';
import { Card, CardHeader, PageHeader, Button, Select, Input, Field, Modal, Loading, useToast } from '../components/ui.jsx';
import { useFilterOptions } from './Operation.jsx';

const DESCR = {
  campanhas: 'Indicadores completos de cada campanha', produtos: 'Resultados agrupados por produto', anos: 'Comparativo entre bases (2024, 2025, 2026…)',
  status_historico: 'Ganho × perdido × aberto', vendedoras: 'Produtividade e eficiência por vendedora', sem_resposta: 'Encerrados sem resposta após as tentativas',
  aguardando: 'Contatos com envio aguardando resposta', interessados: 'Responderam, interessados, em negociação ou retorno futuro', convertidos: 'Conversões com data e valor',
  opt_out: 'Pedidos de não contato (LGPD)', followups: 'Follow-ups pendentes e atrasados', participantes: 'Todos os contatos das campanhas filtradas',
};

export default function Reports() {
  const { isAdmin } = useAuth();
  const { productId, setProductId, products } = useProduct();
  const { campaigns, years, sellers } = useFilterOptions();
  const toast = useToast();
  const { data: reports = [] } = useQuery({ queryKey: ['reports'], queryFn: () => api.get('/reports') });
  const [f, setF] = useState({ campaign_id: '', year: '', hist: '', seller: '', from: '', to: '' });
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const params = { ...f, product_id: productId || '' };
  const exp = async (key, format) => {
    setBusy(`${key}${format}`);
    try { await download(`/reports/${key}${qs({ ...params, format })}`); } catch (e) { toast(e.message, 'error'); } finally { setBusy(''); }
  };
  const open = async (r) => {
    setPreview({ title: r.title, loading: true });
    try { setPreview(await api.get(`/reports/${r.key}${qs({ ...params, format: 'json' })}`)); } catch (e) { toast(e.message, 'error'); setPreview(null); }
  };
  return (
    <div>
      <PageHeader title="Relatórios e exportação" subtitle={isAdmin ? 'Exporte em Excel (.xlsx) ou CSV aplicando os filtros abaixo.' : 'Relatórios com os seus contatos e resultados.'} />
      <Card className="p-4 mb-5">
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <Field label="Campanha" className="col-span-2"><Select value={f.campaign_id} onChange={(e) => setF({ ...f, campaign_id: e.target.value })}><option value="">Todas</option>{campaigns.filter((c) => c.status !== 'rascunho').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Produto"><Select value={productId || ''} onChange={(e) => setProductId(Number(e.target.value) || null)}><option value="">Todos</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label="Ano da base"><Select value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })}><option value="">Todos</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select></Field>
          <Field label="Status histórico"><Select value={f.hist} onChange={(e) => setF({ ...f, hist: e.target.value })}><option value="">Todos</option>{Object.entries(HIST).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
          {isAdmin && <Field label="Vendedora"><Select value={f.seller} onChange={(e) => setF({ ...f, seller: e.target.value })}><option value="">Todas</option>{sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>}
          <Field label="1º envio de"><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
          <Field label="até"><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        </div>
      </Card>
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        {reports.filter((r) => isAdmin || r.key !== 'opt_out').map((r) => (
          <Card key={r.key} className="p-4 flex flex-col">
            <p className="font-medium">{r.title}</p>
            <p className="text-[13px] text-muted mt-0.5 flex-1">{DESCR[r.key]}</p>
            <div className="flex gap-2 mt-3">
              <Button size="sm" variant="ghost" icon={Eye} onClick={() => open(r)}>Ver</Button>
              <Button size="sm" icon={FileSpreadsheet} loading={busy === `${r.key}xlsx`} onClick={() => exp(r.key, 'xlsx')}>Excel</Button>
              <Button size="sm" icon={FileText} loading={busy === `${r.key}csv`} onClick={() => exp(r.key, 'csv')}>CSV</Button>
            </div>
          </Card>
        ))}
      </div>
      {preview && (
        <Modal open onClose={() => setPreview(null)} title={preview.title} size="xl">
          {preview.loading ? <Loading /> : !preview.rows.length ? <p className="text-sm text-muted">Nenhum registro para os filtros.</p> : (
            <div className="overflow-x-auto scroll-thin">
              <p className="text-[12px] text-muted mb-2">{preview.total} registro(s){preview.total > preview.rows.length ? ` — exibindo ${preview.rows.length}; exporte para ver todos` : ''}</p>
              <table className="text-[12.5px] w-full">
                <thead><tr className="border-b border-line text-left text-muted">{Object.keys(preview.rows[0]).map((h) => <th key={h} className="font-medium px-2 py-1.5 whitespace-nowrap">{h}</th>)}</tr></thead>
                <tbody>{preview.rows.map((row, i) => <tr key={i} className="border-b border-line/50">{Object.values(row).map((v, j) => <td key={j} className="px-2 py-1.5 whitespace-nowrap tabular">{v === null ? '—' : String(v)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
        </Modal>
      )}
      <Card className="mt-5"><CardHeader title="Sobre os números" subtitle="Mensagens apenas copiadas nunca contam como enviadas. Contatos trabalhados ≠ mensagens enviadas: um contato pode receber várias abordagens. Campanhas encerradas permanecem nos relatórios para análises futuras." /></Card>
    </div>
  );
}
