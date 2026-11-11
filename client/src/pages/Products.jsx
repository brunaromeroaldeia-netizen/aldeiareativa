import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, ArrowLeft, Users, Megaphone } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth, useProduct } from '../lib/context.jsx';
import { HIST, fmtInt, fmtPct, fmtMoney, fmtDate } from '../lib/format.js';
import { Card, CardHeader, PageHeader, Button, Modal, Field, Input, Textarea, Checkbox, Badge, Loading, CampaignBadge, useToast, cx } from '../components/ui.jsx';

export function Products() {
  const { isAdmin } = useAuth();
  const { setProductId, productId } = useProduct();
  const { data = [], isLoading } = useQuery({ queryKey: ['products', 'all'], queryFn: () => api.get('/products?all=1') });
  const [edit, setEdit] = useState(null);
  const qc = useQueryClient();
  if (isLoading) return <Loading />;
  return (
    <div>
      <PageHeader title="Produtos" subtitle="Cada produto tem sua base, campanhas e indicadores. Selecione um produto no menu lateral para filtrar todo o sistema."
        actions={isAdmin && <Button variant="primary" icon={Plus} onClick={() => setEdit({ name: '', description: '', aliases: [], color: '#3f6b55', active: true })}>Novo produto</Button>} />
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {data.map((p) => (
          <Card key={p.id} className={cx('p-5 flex flex-col', !p.active && 'opacity-60')}>
            <div className="flex items-start gap-3">
              <span className="size-3 rounded-full mt-1.5 shrink-0" style={{ background: p.color }} />
              <div className="flex-1 min-w-0">
                <Link to={`/produtos/${p.id}`} className="font-semibold hover:underline">{p.name}</Link>
                {!p.active && <Badge className="ml-2 bg-stone-100 text-muted ring-line">Inativo</Badge>}
                {p.description && <p className="text-[13px] text-muted mt-0.5">{p.description}</p>}
              </div>
              {isAdmin && <button onClick={() => setEdit(p)} className="p-1.5 rounded-md text-muted hover:bg-stone-100"><Pencil className="size-4" /></button>}
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4 text-center">
              <div><p className="text-lg font-semibold tabular">{fmtInt(p.contacts)}</p><p className="text-[11px] text-muted">contatos</p></div>
              <div><p className="text-lg font-semibold tabular">{fmtInt(p.opportunities)}</p><p className="text-[11px] text-muted">oportunidades</p></div>
              <div><p className="text-lg font-semibold tabular">{fmtInt(p.active_campaigns)}</p><p className="text-[11px] text-muted">campanhas ativas</p></div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button size="sm" className="flex-1" onClick={() => setProductId(p.id)} disabled={productId === p.id}>{productId === p.id ? 'Selecionado' : 'Trabalhar neste produto'}</Button>
              <Link to={`/produtos/${p.id}`}><Button size="sm" variant="ghost">Detalhes</Button></Link>
            </div>
          </Card>
        ))}
      </div>
      {edit && <ProductModal p={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['products'] }); }} />}
    </div>
  );
}

function ProductModal({ p, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ ...p, aliasesText: (p.aliases || []).join(', '), description: p.description || '' });
  const save = async () => {
    const body = { name: f.name, description: f.description || null, aliases: f.aliasesText.split(',').map((s) => s.trim()).filter(Boolean), color: f.color, active: f.active };
    try {
      if (p.id) await api.patch(`/products/${p.id}`, body); else await api.post('/products', body);
      toast('Produto salvo'); onSaved();
    } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <Modal open onClose={onClose} title={p.id ? 'Editar produto' : 'Novo produto'} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={save} disabled={!f.name}>Salvar</Button></>}>
      <div className="space-y-3">
        <Field label="Nome"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Descrição"><Textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Sinônimos para reconhecimento na importação" hint="Separados por vírgula. Ex.: mesa, plano full, coworking"><Input value={f.aliasesText} onChange={(e) => setF({ ...f, aliasesText: e.target.value })} /></Field>
        <div className="flex items-center gap-4">
          <Field label="Cor"><input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} className="h-9 w-14 rounded-md ring-1 ring-line" /></Field>
          <Checkbox checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="Produto ativo" className="mt-5" />
        </div>
        {!f.active && <p className="text-[12px] text-muted">Produtos inativos deixam de aparecer nos seletores, mas o histórico é preservado.</p>}
      </div>
    </Modal>
  );
}

export function ProductDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { setProductId } = useProduct();
  const { data, isLoading } = useQuery({ queryKey: ['product', id], queryFn: () => api.get(`/products/${id}/overview`) });
  if (isLoading) return <Loading />;
  const { product, matrix, lostReasons, campaigns } = data;
  const years = [...new Set(matrix.map((m) => m.ref_year))];
  const cell = (y, h) => matrix.find((m) => m.ref_year === y && m.historical_status === h)?.n || 0;
  const goContacts = (y, h) => { setProductId(product.id); nav(`/contatos?${y ? `year=${y}&` : ''}${h ? `hist=${h}` : ''}`); };
  return (
    <div className="space-y-5">
      <button onClick={() => nav('/produtos')} className="text-sm text-muted hover:text-ink flex items-center gap-1"><ArrowLeft className="size-4" />Produtos</button>
      <PageHeader title={product.name} subtitle={product.description || 'Base histórica e campanhas do produto'}
        actions={<><Button icon={Users} onClick={() => goContacts()}>Ver contatos</Button><Button icon={Megaphone} onClick={() => { setProductId(product.id); nav('/campanhas'); }}>Campanhas</Button></>} />
      <Card>
        <CardHeader title="Base por ano e status histórico" subtitle="Clique em um número para abrir os contatos do segmento" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-[12px] text-muted border-y border-line"><th className="font-medium text-left px-5 py-2">Ano</th>{Object.entries(HIST).map(([k, v]) => <th key={k} className="font-medium text-right px-3">{v.label}</th>)}<th className="font-medium text-right px-5">Total</th></tr></thead>
            <tbody>
              {years.map((y) => (
                <tr key={String(y)} className="border-b border-line/60 last:border-0">
                  <td className="px-5 py-2.5 font-medium">{y || 'Sem ano'}</td>
                  {Object.keys(HIST).map((h) => <td key={h} className="px-3 text-right tabular"><button className="hover:underline disabled:no-underline disabled:text-stone-300" disabled={!cell(y, h) || !y} onClick={() => goContacts(y, h)}>{cell(y, h)}</button></td>)}
                  <td className="px-5 text-right tabular font-semibold">{Object.keys(HIST).reduce((a, h) => a + cell(y, h), 0)}</td>
                </tr>
              ))}
              {!years.length && <tr><td colSpan={6} className="px-5 py-6 text-center text-muted">Nenhuma oportunidade importada para este produto.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader title="Campanhas do produto" />
          <div className="divide-y divide-line">
            {campaigns.map((c) => (
              <Link key={c.id} to={`/campanhas/${c.id}`} className="flex flex-wrap items-center gap-2 px-5 py-3 text-sm hover:bg-stone-50">
                <span className="font-medium">{c.name}</span><CampaignBadge status={c.status} />
                <span className="text-[12.5px] text-muted ml-auto tabular">{fmtDate(c.start_date)} · {c.sent} enviados · {fmtPct(c.sent ? (c.responded / c.sent) * 100 : null)} resp. · {c.converted} conv. · {fmtMoney(c.revenue, true)}</span>
              </Link>
            ))}
            {!campaigns.length && <p className="px-5 py-4 text-sm text-muted">Nenhuma campanha para este produto.</p>}
          </div>
        </Card>
        <Card>
          <CardHeader title="Principais motivos de perda" />
          <div className="px-5 pb-5 space-y-2">
            {lostReasons.map((r) => (
              <div key={r.reason} className="text-sm"><div className="flex justify-between"><span>{r.reason}</span><span className="tabular text-muted">{r.n}</span></div>
                <div className="h-1.5 bg-stone-100 rounded-full mt-1"><div className="h-full bg-rose-300 rounded-full" style={{ width: `${(r.n / lostReasons[0].n) * 100}%` }} /></div></div>
            ))}
            {!lostReasons.length && <p className="text-sm text-muted">Sem perdas registradas.</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}
