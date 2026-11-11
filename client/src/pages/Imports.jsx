import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UploadCloud, FileSpreadsheet, ArrowLeft, CheckCircle2, Download, AlertTriangle } from 'lucide-react';
import { api, download } from '../lib/api.js';
import { fmtDateTime, fmtInt } from '../lib/format.js';
import {
  Card, CardHeader, PageHeader, Button, Select, Input, Checkbox, Alert, Loading, Badge, Tabs, Pagination, HistBadge, Kpi, DemoTag, Field, useToast, useConfirm, cx,
} from '../components/ui.jsx';

const STATUS_LABEL = { rascunho: 'Mapeamento', analisada: 'Aguardando confirmação', concluida: 'Concluída', cancelada: 'Cancelada' };

export function Imports() {
  const nav = useNavigate();
  const toast = useToast();
  const { data = [], isLoading } = useQuery({ queryKey: ['imports'], queryFn: () => api.get('/imports') });
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef(null);
  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.upload('/imports', fd);
      if (r.previousImport) toast(`Atenção: este mesmo arquivo já foi importado em ${fmtDateTime(r.previousImport.created_at)}.`, 'error');
      nav(`/importacoes/${r.id}`);
    } catch (e) { toast(e.message, 'error'); } finally { setUploading(false); }
  };
  return (
    <div>
      <PageHeader title="Importações" subtitle="Novas planilhas são incorporadas à base permanente — nada é apagado. Cada importação fica registrada com data, usuária e arquivo." />
      <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files[0]); }}
        onClick={() => input.current?.click()}
        className={cx('rounded-2xl border-2 border-dashed px-6 py-10 text-center cursor-pointer transition mb-6 bg-white', drag ? 'border-brand-500 bg-brand-50/50' : 'border-stone-300 hover:border-brand-400')}>
        <input ref={input} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => upload(e.target.files[0])} />
        {uploading ? <Loading label="Lendo planilha…" /> : (
          <>
            <UploadCloud className="size-9 mx-auto text-brand-600" />
            <p className="font-medium mt-2">Arraste a planilha aqui ou clique para selecionar</p>
            <p className="text-sm text-muted mt-1">.xlsx, .xls ou .csv — inclusive com várias abas. Você revisa o mapeamento e a prévia antes de confirmar.</p>
          </>
        )}
      </div>
      <Card>
        <CardHeader title="Histórico de importações" />
        {isLoading ? <Loading /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-[12px] text-muted border-y border-line text-left"><th className="font-medium px-5 py-2">Arquivo</th><th className="font-medium px-2">Abas</th><th className="font-medium px-2">Situação</th><th className="font-medium px-2 text-right">Linhas</th><th className="font-medium px-2 text-right">Contatos novos</th><th className="font-medium px-2 text-right">Oportunidades</th><th className="font-medium px-5">Enviada por</th></tr></thead>
              <tbody>
                {data.map((i) => (
                  <tr key={i.id} className="border-b border-line/60 last:border-0 hover:bg-stone-50 cursor-pointer" onClick={() => nav(`/importacoes/${i.id}`)}>
                    <td className="px-5 py-2.5"><span className="font-medium flex items-center gap-2"><FileSpreadsheet className="size-4 text-brand-600" />{i.filename}{i.is_demo && <DemoTag />}</span></td>
                    <td className="px-2 text-muted text-[12.5px]">{(i.sheets || []).join(', ')}</td>
                    <td className="px-2"><Badge className={i.status === 'concluida' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-amber-50 text-amber-800 ring-amber-200'}>{STATUS_LABEL[i.status]}</Badge></td>
                    <td className="px-2 text-right tabular">{fmtInt(i.total)}</td>
                    <td className="px-2 text-right tabular">{fmtInt(i.commit?.contactsCreated)}</td>
                    <td className="px-2 text-right tabular">{fmtInt(i.commit?.opportunitiesCreated)}</td>
                    <td className="px-5 text-[12.5px] text-muted">{i.created_by_name} · {fmtDateTime(i.created_at)}</td>
                  </tr>
                ))}
                {!data.length && <tr><td colSpan={7} className="px-5 py-8 text-center text-muted">Nenhuma importação ainda.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export function ImportWizard() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();
  const { data: imp, isLoading, refetch } = useQuery({ queryKey: ['import', id], queryFn: () => api.get(`/imports/${id}`) });
  const { data: fields = [] } = useQuery({ queryKey: ['import-fields'], queryFn: () => api.get('/imports/fields'), staleTime: Infinity });
  const { data: products = [] } = useQuery({ queryKey: ['products'], queryFn: () => api.get('/products') });
  const [sheets, setSheets] = useState(null);
  const [rule, setRule] = useState('preencher_vazios');
  const [step, setStep] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!imp) return;
    setSheets(imp.sheets.map((s) => ({ ...s })));
    setRule(imp.update_rule);
    setStep((cur) => cur || (imp.status === 'rascunho' ? 'mapear' : imp.status === 'analisada' ? 'validar' : 'fim'));
  }, [imp]);

  if (isLoading || !sheets) return <Loading />;
  const stats = imp.stats || {};
  const upSheet = (sid, patch) => setSheets((all) => all.map((s) => (s.id === sid ? { ...s, ...patch } : s)));

  const analyze = async (overrides) => {
    setBusy(true);
    try {
      await api.post(`/imports/${id}/analyze`, {
        update_rule: rule,
        sheets: (overrides || sheets).map((s) => ({ id: s.id, include: s.include, mapping: s.mapping, default_product_id: s.default_product_id ? Number(s.default_product_id) : null, default_year: s.default_year ? Number(s.default_year) : null, product_value_map: s.product_value_map || {} })),
      });
      await refetch();
      qc.invalidateQueries({ queryKey: ['import-rows', id] });
      setStep('validar');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const commit = async () => {
    const msg = `Serão processadas ${stats.total - stats.skipped} linha(s): ${stats.new_contacts} contato(s) novo(s) e ${stats.existing} vínculo(s) com contatos existentes. ${stats.skipped} linha(s) serão ignoradas. A base atual não será apagada.`;
    if (!(await confirm({ title: 'Confirmar importação', message: msg, confirmLabel: 'Importar' }))) return;
    setBusy(true);
    try { const r = await api.post(`/imports/${id}/commit`); setResult(r); await refetch(); setStep('fim'); qc.invalidateQueries(); toast('Importação concluída'); } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const cancel = async () => {
    if (!(await confirm({ title: 'Cancelar importação', message: 'Nada será gravado na base.', danger: true, confirmLabel: 'Cancelar importação' }))) return;
    await api.del(`/imports/${id}`); nav('/importacoes');
  };

  return (
    <div>
      {confirmDialog}
      <button onClick={() => nav('/importacoes')} className="text-sm text-muted hover:text-ink flex items-center gap-1 mb-3"><ArrowLeft className="size-4" />Importações</button>
      <PageHeader title={imp.filename} subtitle={`Enviada por ${imp.created_by_name} em ${fmtDateTime(imp.created_at)}`}
        actions={(
          <>
            {imp.stored_path !== null && <Button icon={Download} onClick={() => download(`/imports/${id}/file`).catch((e) => toast(e.message, 'error'))}>Arquivo original</Button>}
            {imp.status !== 'concluida' && imp.status !== 'cancelada' && <Button variant="ghost" onClick={cancel}>Cancelar importação</Button>}
          </>
        )} />
      {imp.status !== 'concluida' && (
        <div className="flex gap-2 mb-5 text-sm">
          {[['mapear', '1. Mapeamento'], ['validar', '2. Validação e prévia'], ['fim', '3. Confirmação']].map(([k, l]) => (
            <span key={k} className={cx('px-3 h-8 inline-flex items-center rounded-full', step === k ? 'bg-brand-600 text-white' : 'bg-white ring-1 ring-line text-muted')}>{l}</span>
          ))}
        </div>
      )}

      {step === 'mapear' && (
        <div className="space-y-5">
          {sheets.map((s) => <SheetMapping key={s.id} s={s} fields={fields} products={products} onChange={(patch) => upSheet(s.id, patch)} multi={sheets.length > 1} />)}
          <Card className="p-5">
            <p className="font-medium text-sm mb-2">Contatos que já existem na base</p>
            <div className="grid sm:grid-cols-3 gap-2">
              {[['preencher_vazios', 'Preencher só campos vazios', 'Recomendado: completa e-mail/empresa/telefone que estavam em branco'], ['nao_atualizar', 'Não atualizar cadastro', 'Apenas adiciona as novas oportunidades'], ['sobrescrever', 'Atualizar com os dados da planilha', 'Substitui empresa, telefone e e-mail diferentes (nome nunca)']].map(([v, t, d]) => (
                <button key={v} onClick={() => setRule(v)} className={cx('text-left rounded-lg ring-1 px-3 py-2.5', rule === v ? 'ring-2 ring-brand-500 bg-brand-50/50' : 'ring-line hover:bg-stone-50')}>
                  <p className="text-sm font-medium">{t}</p><p className="text-[12px] text-muted">{d}</p>
                </button>
              ))}
            </div>
            <p className="text-[12px] text-muted mt-2">Você verá a prévia de cada alteração antes de confirmar. Oportunidades anteriores nunca são apagadas.</p>
          </Card>
          <div className="flex justify-end"><Button variant="primary" size="lg" loading={busy} onClick={() => analyze()}>Analisar planilha</Button></div>
        </div>
      )}

      {step === 'validar' && (
        <Validation id={id} stats={stats} sheets={sheets} products={products} busy={busy}
          onBack={() => setStep('mapear')} onCommit={commit}
          onRemapProducts={(map) => { const next = sheets.map((s) => ({ ...s, product_value_map: { ...(s.product_value_map || {}), ...(map[s.id] || {}) } })); setSheets(next); analyze(next); }}
          onChanged={() => refetch()} />
      )}

      {step === 'fim' && (
        <Card className="p-8 text-center">
          <CheckCircle2 className="size-10 text-brand-600 mx-auto" />
          <p className="text-lg font-semibold mt-2">Importação concluída</p>
          <p className="text-sm text-muted">em {fmtDateTime(imp.committed_at)}</p>
          {(() => {
            const c = result || stats.commit || {};
            return (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-6 max-w-3xl mx-auto">
                <Kpi label="Contatos novos" value={fmtInt(c.contactsCreated)} />
                <Kpi label="Vinculados a existentes" value={fmtInt(c.contactsLinked)} />
                <Kpi label="Cadastros atualizados" value={fmtInt(c.contactsUpdated)} />
                <Kpi label="Oportunidades criadas" value={fmtInt(c.opportunitiesCreated)} />
                <Kpi label="Linhas ignoradas" value={fmtInt(c.rowsSkipped)} />
              </div>
            );
          })()}
          <div className="flex justify-center gap-2 mt-6">
            <Link to={`/contatos`}><Button>Ver base de contatos</Button></Link>
            <Link to="/campanhas/nova"><Button variant="primary">Criar campanha</Button></Link>
          </div>
        </Card>
      )}
    </div>
  );
}

function SheetMapping({ s, fields, products, onChange, multi }) {
  const colSample = (i) => (s.sample || []).map((r) => r[i]).filter((v) => v !== null && v !== '').slice(0, 3).join(' · ');
  const mapped = new Set(Object.values(s.mapping || {}).map(Number));
  return (
    <Card className={cx(!s.include && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-line">
        {multi && <Checkbox checked={s.include} onChange={(v) => onChange({ include: v })} />}
        <div className="flex-1 min-w-0"><p className="font-semibold">Aba “{s.name}”</p><p className="text-[12.5px] text-muted">{s.row_count} linha(s) · {s.headers.length} coluna(s)</p></div>
        <Field label="Produto do arquivo/aba" hint="Usado quando a planilha não informa o produto">
          <Select className="w-56" value={s.default_product_id || ''} onChange={(e) => onChange({ default_product_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Não definido</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Ano do lote" hint="Só se não houver datas">
          <Input type="number" className="w-28" placeholder="ex.: 2024" value={s.default_year || ''} onChange={(e) => onChange({ default_year: e.target.value ? Number(e.target.value) : null })} />
        </Field>
      </div>
      {s.include && (
        <div className="grid lg:grid-cols-2 gap-x-6 gap-y-2.5 px-5 py-4">
          {fields.map((f) => {
            const v = s.mapping?.[f.key];
            return (
              <div key={f.key} className="grid grid-cols-[170px_1fr] items-center gap-3">
                <span className="text-sm">{f.label}{['full_name', 'phone'].includes(f.key) && <span className="text-rose-500"> *</span>}</span>
                <div>
                  <Select value={v ?? ''} onChange={(e) => onChange({ mapping: { ...s.mapping, [f.key]: e.target.value === '' ? null : Number(e.target.value) } })} className={cx(v !== undefined && v !== null && 'ring-brand-200 bg-brand-50/30')}>
                    <option value="">— não importar —</option>
                    {s.headers.map((h, i) => <option key={i} value={i}>{h}{mapped.has(i) && v !== i ? ' (já usada)' : ''}</option>)}
                  </Select>
                  {v !== undefined && v !== null && <p className="text-[11.5px] text-muted mt-0.5 truncate">ex.: {colSample(v) || '(vazio nas primeiras linhas)'}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {s.include && (
        <details className="px-5 pb-4">
          <summary className="text-sm text-brand-700 cursor-pointer">Ver primeiras linhas da aba</summary>
          <div className="overflow-x-auto scroll-thin mt-2 rounded-lg ring-1 ring-line">
            <table className="text-[12px] w-full">
              <thead><tr className="bg-stone-50">{s.headers.map((h, i) => <th key={i} className="text-left font-medium px-2 py-1.5 whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody>{(s.sample || []).map((r, j) => <tr key={j} className="border-t border-line">{s.headers.map((_, i) => <td key={i} className="px-2 py-1 whitespace-nowrap">{r[i] === null ? '' : String(r[i])}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </details>
      )}
      <p className="text-[12px] text-muted px-5 pb-4">Colunas não mapeadas são preservadas junto ao registro para consulta futura.</p>
    </Card>
  );
}

const FILTERS = [
  ['todos', 'Todas'], ['novos', 'Novos'], ['existentes', 'Já existentes'], ['ambiguos', 'Ambíguos'], ['duplicados', 'Duplicidades'],
  ['problemas', 'Inconsistências'], ['revisao', 'Revisão necessária'], ['sem_telefone', 'Sem telefone'], ['atualizacoes', 'Atualizações de cadastro'],
];
const MATCH = { novo: ['Novo', 'bg-emerald-50 text-emerald-700 ring-emerald-200'], interno: ['Novo (repetido no arquivo)', 'bg-emerald-50 text-emerald-700 ring-emerald-200'], existente: ['Existente', 'bg-sky-50 text-sky-800 ring-sky-200'], ambiguo: ['Ambíguo', 'bg-amber-50 text-amber-800 ring-amber-200'] };

function Validation({ id, stats, products, busy, onBack, onCommit, onRemapProducts, onChanged }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState(stats.ambiguous_pending ? 'ambiguos' : 'todos');
  const [page, setPage] = useState(1);
  const { data } = useQuery({ queryKey: ['import-rows', id, filter, page], queryFn: () => api.get(`/imports/${id}/rows?filter=${filter}&page=${page}`), placeholderData: (p) => p });
  const [pvMap, setPvMap] = useState({});
  const unmapped = (stats.productValues || []).filter((v) => !v.product_id);
  const decide = async (row, decision, contactId) => {
    try { await api.patch(`/imports/${id}/rows/${row.id}`, { decision, contact_id: contactId ?? null }); qc.invalidateQueries({ queryKey: ['import-rows', id] }); onChanged(); } catch (e) { toast(e.message, 'error'); }
  };
  const bulk = async (scope, decision) => {
    try { await api.post(`/imports/${id}/bulk-decision`, { scope, decision }); qc.invalidateQueries({ queryKey: ['import-rows', id] }); onChanged(); toast('Decisão aplicada'); } catch (e) { toast(e.message, 'error'); }
  };
  const count = (arr, key) => arr?.find((x) => x.key === key)?.n || 0;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <Kpi label="Registros identificados" value={fmtInt(stats.total)} sub={stats.emptyRows ? `${stats.emptyRows} linhas vazias ignoradas` : null} />
        <Kpi label="Ganhos" value={fmtInt(count(stats.byStatus, 'ganho'))} />
        <Kpi label="Perdidos" value={fmtInt(count(stats.byStatus, 'perdido'))} />
        <Kpi label="Abertos" value={fmtInt(count(stats.byStatus, 'aberto'))} />
        <Kpi label="Revisão necessária" value={fmtInt(count(stats.byStatus, 'revisao'))} tone={count(stats.byStatus, 'revisao') ? 'danger' : undefined} onClick={() => { setFilter('revisao'); setPage(1); }} />
        <Kpi label="Sem telefone" value={fmtInt(stats.without_phone)} onClick={() => { setFilter('sem_telefone'); setPage(1); }} />
        <Kpi label="Possíveis duplicidades" value={fmtInt(stats.in_file_dups + stats.dup_opportunities + stats.ambiguous)} sub={`${stats.ambiguous} ambíguas · ${stats.dup_opportunities} já importadas`} onClick={() => { setFilter('duplicados'); setPage(1); }} />
        <Kpi label="Inconsistências" value={fmtInt(stats.with_issues)} onClick={() => { setFilter('problemas'); setPage(1); }} />
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="p-5"><p className="text-sm font-semibold mb-2">Por ano de referência</p>
          {(stats.byYear || []).map((y) => <div key={String(y.key)} className="flex justify-between text-sm py-0.5"><span>{y.key || <span className="text-amber-700">Sem ano</span>}</span><span className="tabular">{fmtInt(y.n)}</span></div>)}
          {stats.year_inferred > 0 && <p className="text-[12px] text-amber-700 mt-2">{stats.year_inferred} com ano inferido pela data de ganho/perda ou pelo lote.</p>}
        </Card>
        <Card className="p-5"><p className="text-sm font-semibold mb-2">Por produto</p>
          {(stats.byProduct || []).map((p) => <div key={String(p.key)} className="flex justify-between text-sm py-0.5"><span className={!p.key ? 'text-amber-700' : ''}>{p.label}</span><span className="tabular">{fmtInt(p.n)}</span></div>)}
        </Card>
        <Card className="p-5"><p className="text-sm font-semibold mb-2">Contatos</p>
          <div className="flex justify-between text-sm py-0.5"><span>Contatos novos</span><span className="tabular">{fmtInt(stats.new_contacts)}</span></div>
          <div className="flex justify-between text-sm py-0.5"><span>Linhas de contatos já existentes</span><span className="tabular">{fmtInt(stats.existing)}</span></div>
          <div className="flex justify-between text-sm py-0.5"><span>Cadastros a atualizar</span><span className="tabular">{fmtInt(stats.with_updates)}</span></div>
          <div className="flex justify-between text-sm py-0.5"><span>Pessoas repetidas no arquivo</span><span className="tabular">{fmtInt(stats.in_file_dups)}</span></div>
          <div className="flex justify-between text-sm py-0.5"><span>Linhas que serão ignoradas</span><span className="tabular">{fmtInt(stats.skipped)}</span></div>
        </Card>
      </div>

      {unmapped.length > 0 && (
        <Card>
          <CardHeader title="Valores de produto não reconhecidos" subtitle="Associe cada valor da planilha a um produto cadastrado e reanalise." />
          <div className="px-5 pb-5 space-y-2">
            {unmapped.map((v) => (
              <div key={`${v.sheet_id}${v.key}`} className="flex items-center gap-3 text-sm">
                <span className="flex-1">“{v.value}” <span className="text-muted">({v.count} linhas, aba {v.sheet})</span></span>
                <Select className="w-60" value={pvMap[v.sheet_id]?.[v.key] ?? ''} onChange={(e) => setPvMap({ ...pvMap, [v.sheet_id]: { ...(pvMap[v.sheet_id] || {}), [v.key]: e.target.value ? Number(e.target.value) : null } })}>
                  <option value="">Usar produto padrão da aba</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </div>
            ))}
            <Button onClick={() => onRemapProducts(pvMap)} loading={busy}>Aplicar e reanalisar</Button>
          </div>
        </Card>
      )}

      {stats.ambiguous_pending > 0 && (
        <Alert tone="warning" title={`${stats.ambiguous_pending} correspondência(s) ambígua(s) para decidir`}>
          O telefone ou e-mail coincide com um contato existente, mas outros dados divergem. Decida linha a linha abaixo ou em lote:
          <div className="flex flex-wrap gap-2 mt-2">
            <Button size="sm" onClick={() => bulk('ambiguos', 'vincular_sugerido')}>Vincular todas ao contato sugerido</Button>
            <Button size="sm" onClick={() => bulk('ambiguos', 'criar')}>Criar contatos novos para todas</Button>
          </div>
        </Alert>
      )}

      <Card>
        <Tabs className="px-3" tabs={FILTERS.map(([v, l]) => ({ value: v, label: l }))} value={filter} onChange={(v) => { setFilter(v); setPage(1); }} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-[12px] text-muted border-b border-line text-left"><th className="font-medium px-4 py-2">Linha</th><th className="font-medium px-2">Contato</th><th className="font-medium px-2">Produto · ano</th><th className="font-medium px-2">Histórico</th><th className="font-medium px-2">Correspondência</th><th className="font-medium px-2">Observações</th><th className="font-medium px-4">Decisão</th></tr></thead>
            <tbody>
              {(data?.rows || []).map((r) => (
                <tr key={r.id} className="border-b border-line/60 last:border-0 align-top">
                  <td className="px-4 py-2 text-[12px] text-muted whitespace-nowrap">{r.sheet_name}<br />#{r.row_number}</td>
                  <td className="px-2 py-2 min-w-48"><p className="font-medium">{r.mapped.full_name}</p><p className="text-[12px] text-muted">{[r.mapped.company, r.mapped.phone, r.mapped.email].filter(Boolean).join(' · ')}</p></td>
                  <td className="px-2 py-2 whitespace-nowrap">{r.product_name?.split(' /')[0] || <span className="text-amber-700">sem produto</span>} · {r.ref_year || <span className="text-amber-700">s/ ano</span>}{r.year_source && r.year_source !== 'criacao' && <span className="text-[11px] text-amber-700"> ({r.year_source})</span>}</td>
                  <td className="px-2 py-2"><HistBadge status={r.historical_status} /></td>
                  <td className="px-2 py-2 min-w-44">
                    <Badge className={MATCH[r.match_type][1]}>{MATCH[r.match_type][0]}</Badge>
                    {r.dup_opportunity_id && <p className="text-[12px] text-amber-800 mt-1">Oportunidade idêntica já importada</p>}
                    {r.candidates.map((c) => <p key={c.id} className="text-[12px] text-muted mt-1">↔ <Link to={`/contatos/${c.id}`} className="underline">{c.full_name}</Link> ({c.by.join(' e ')})</p>)}
                    {r.changes.map((c, i) => <p key={i} className="text-[12px] text-sky-800 mt-1">{c.label}: {c.from || '(vazio)'} → {c.to}</p>)}
                  </td>
                  <td className="px-2 py-2 text-[12px] min-w-48">{r.issues.filter((i) => i.msg !== 'Sem telefone' || filter === 'sem_telefone').map((i, k) => <p key={k} className={i.level === 'revisao' || i.level === 'erro' ? 'text-rose-700' : i.level === 'aviso' ? 'text-amber-800' : 'text-muted'}>{i.level !== 'info' && <AlertTriangle className="size-3 inline mr-1" />}{i.msg}</p>)}</td>
                  <td className="px-4 py-2 min-w-48">
                    <Select className="!h-8 text-[13px]" value={r.decision === 'vincular' ? `v${r.decision_contact_id}` : r.decision}
                      onChange={(e) => { const v = e.target.value; if (v.startsWith('v')) decide(r, 'vincular', Number(v.slice(1))); else decide(r, v); }}>
                      <option value="auto">{r.match_type === 'ambiguo' ? '— decidir —' : r.match_type === 'existente' ? 'Vincular ao existente' : 'Criar contato'}</option>
                      {r.match_type !== 'novo' && r.match_type !== 'interno' && <option value="criar">Criar contato novo</option>}
                      {r.candidates.map((c) => <option key={c.id} value={`v${c.id}`}>Vincular a {c.full_name}</option>)}
                      <option value="ignorar">Ignorar linha</option>
                    </Select>
                  </td>
                </tr>
              ))}
              {data && !data.rows.length && <tr><td colSpan={7} className="px-5 py-8 text-center text-muted">Nenhuma linha neste filtro.</td></tr>}
            </tbody>
          </table>
        </div>
        {data && <Pagination page={page} total={data.total} pageSize={data.pageSize} onChange={setPage} />}
      </Card>

      <div className="flex flex-wrap justify-between gap-2">
        <Button onClick={onBack}>Voltar ao mapeamento</Button>
        <Button variant="primary" size="lg" onClick={onCommit} loading={busy} disabled={stats.ambiguous_pending > 0}>Confirmar importação</Button>
      </div>
    </div>
  );
}
