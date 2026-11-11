import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, History, Copy, Eye, BookCopy } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/context.jsx';
import { HIST, fmtDateTime } from '../lib/format.js';
import { Button, Card, Modal, Field, Input, Select, Textarea, Badge, Alert, EmptyState, useToast, useConfirm, cx } from './ui.jsx';

/** Lista e editor de mensagens de uma campanha (campaignId) ou da biblioteca (campaignId = null). */
export default function MessageEditor({ campaignId, readOnly, campaign }) {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();
  const key = ['templates', campaignId ?? 'library'];
  const { data: templates = [] } = useQuery({ queryKey: key, queryFn: () => api.get(campaignId ? `/templates?campaign_id=${campaignId}` : '/templates?library=1') });
  const [editing, setEditing] = useState(null);
  const [versionsOf, setVersionsOf] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const canEdit = isAdmin && !readOnly;
  const refresh = () => qc.invalidateQueries({ queryKey: ['templates'] });

  const groups = [
    { title: 'Primeira mensagem', items: templates.filter((t) => t.kind === 'inicial') },
    ...[...new Set(templates.filter((t) => t.kind === 'followup').map((t) => t.step))].sort().map((s) => ({ title: `${s - 1}º follow-up (${s}ª abordagem)`, items: templates.filter((t) => t.kind === 'followup' && t.step === s) })),
  ];

  return (
    <div className="space-y-4">
      {confirmDialog}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={Plus} onClick={() => setEditing({ kind: 'inicial', step: 1, name: '', body: '', product_id: campaign?.product_ids?.length === 1 ? campaign.product_ids[0] : null, ref_year: null, historical_status: null })}>Nova mensagem inicial</Button>
          <Button icon={Plus} onClick={() => setEditing({ kind: 'followup', step: Math.max(2, ...templates.filter((t) => t.kind === 'followup').map((t) => t.step + 1)), name: '', body: '', product_id: null, ref_year: null, historical_status: null })}>Novo follow-up</Button>
          {campaignId && <Button icon={BookCopy} onClick={() => setImportOpen(true)}>Usar modelo existente</Button>}
        </div>
      )}
      {campaignId && <p className="text-[13px] text-muted">Para cada contato o sistema escolhe a mensagem do segmento mais específico (produto, ano e status histórico). Mensagens sem segmento valem para todos.</p>}
      {!templates.length && <Card><EmptyState title="Nenhuma mensagem cadastrada">{canEdit ? 'Cadastre a primeira mensagem de abordagem.' : ''}</EmptyState></Card>}
      {groups.filter((g) => g.items.length).map((g) => (
        <div key={g.title}>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted mb-2">{g.title}</p>
          <div className="grid md:grid-cols-2 gap-3">
            {g.items.map((t) => (
              <Card key={t.id} className="p-4 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{t.name}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      <Badge className="bg-stone-50 text-ink/70 ring-line">{t.product_name || 'Todos os produtos'}</Badge>
                      <Badge className="bg-stone-50 text-ink/70 ring-line">{t.ref_year || 'Todos os anos'}</Badge>
                      <Badge className="bg-stone-50 text-ink/70 ring-line">{t.historical_status ? HIST[t.historical_status].label : 'Todos os status'}</Badge>
                      <Badge className="bg-white text-muted ring-line">v{t.version}</Badge>
                    </div>
                  </div>
                  <div className="flex shrink-0">
                    <IconBtn icon={History} title="Versões" onClick={() => setVersionsOf(t)} />
                    {canEdit && <IconBtn icon={Pencil} title="Editar" onClick={() => setEditing(t)} />}
                    {canEdit && <IconBtn icon={Trash2} title="Desativar" onClick={async () => {
                      if (await confirm({ title: 'Desativar mensagem', message: 'A mensagem deixa de ser sugerida. O histórico de envios é preservado.', danger: true, confirmLabel: 'Desativar' })) {
                        try { await api.del(`/templates/${t.id}`); refresh(); toast('Mensagem desativada'); } catch (e) { toast(e.message, 'error'); }
                      }
                    }} />}
                    {isAdmin && !campaignId && <IconBtn icon={Copy} title="Duplicar" onClick={async () => { await api.post(`/templates/${t.id}/copy`, { campaign_id: null }); refresh(); toast('Modelo duplicado'); }} />}
                  </div>
                </div>
                <div className="wa-text mt-3 text-[13px] text-ink/85 bg-stone-50 rounded-lg ring-1 ring-line px-3 py-2.5 line-clamp-[8]">{t.body}</div>
              </Card>
            ))}
          </div>
        </div>
      ))}
      {editing && <TemplateModal template={editing} campaignId={campaignId} campaign={campaign} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
      {versionsOf && <VersionsModal template={versionsOf} onClose={() => setVersionsOf(null)} />}
      {importOpen && <ImportTemplateModal campaignId={campaignId} onClose={() => setImportOpen(false)} onDone={() => { setImportOpen(false); refresh(); }} />}
    </div>
  );
}

const IconBtn = ({ icon: Icon, onClick, title }) => <button onClick={onClick} title={title} className="p-1.5 rounded-md text-muted hover:text-ink hover:bg-stone-100"><Icon className="size-4" /></button>;

function TemplateModal({ template, campaignId, campaign, onClose, onSaved }) {
  const toast = useToast();
  const { data: products = [] } = useQuery({ queryKey: ['products'], queryFn: () => api.get('/products') });
  const { data: years = [] } = useQuery({ queryKey: ['years'], queryFn: () => api.get('/contacts/years') });
  const { data: variables = [] } = useQuery({ queryKey: ['variables'], queryFn: () => api.get('/templates/variables'), staleTime: Infinity });
  const [f, setF] = useState({ ...template });
  const [contactQ, setContactQ] = useState('');
  const [contactId, setContactId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const ta = useRef(null);
  const { data: contacts = [] } = useQuery({
    queryKey: ['sample-contacts', campaignId, contactQ],
    queryFn: () => api.get(`/templates/sample-contacts?${campaignId ? `campaign_id=${campaignId}&` : ''}q=${encodeURIComponent(contactQ)}`),
  });
  useEffect(() => {
    const h = setTimeout(() => {
      if (!f.body?.trim()) return setPreview(null);
      api.post('/templates/preview', { body: f.body, contact_id: contactId, campaign_id: campaignId }).then(setPreview).catch(() => {});
    }, 300);
    return () => clearTimeout(h);
  }, [f.body, contactId, campaignId]);

  const insertVar = (k) => {
    const el = ta.current;
    const token = `{{${k}}}`;
    if (!el) return setF((x) => ({ ...x, body: `${x.body}${token}` }));
    const s = el.selectionStart; const e = el.selectionEnd;
    const body = f.body.slice(0, s) + token + f.body.slice(e);
    setF((x) => ({ ...x, body }));
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = s + token.length; });
  };
  const save = async () => {
    setSaving(true);
    const payload = { campaign_id: campaignId ?? null, name: f.name, kind: f.kind, step: Number(f.step), product_id: f.product_id ? Number(f.product_id) : null, ref_year: f.ref_year ? Number(f.ref_year) : null, historical_status: f.historical_status || null, body: f.body };
    try {
      if (f.id) await api.patch(`/templates/${f.id}`, payload); else await api.post('/templates', payload);
      toast(f.id ? 'Mensagem atualizada (nova versão registrada)' : 'Mensagem criada');
      onSaved();
    } catch (e) { toast(e.message, 'error'); } finally { setSaving(false); }
  };
  const productOptions = campaign?.product_ids?.length ? products.filter((p) => campaign.product_ids.includes(p.id)) : products;
  return (
    <Modal open onClose={onClose} title={f.id ? 'Editar mensagem' : 'Nova mensagem'} size="xl"
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" loading={saving} onClick={save} disabled={!f.name || !f.body}>Salvar</Button></>}>
      <div className="grid lg:grid-cols-2 gap-5">
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Nome" className="col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ex.: Abertura — Perdidos 2024" /></Field>
            <Field label="Tipo">
              <Select value={f.kind === 'inicial' ? 1 : f.step} onChange={(e) => { const s = Number(e.target.value); setF({ ...f, kind: s === 1 ? 'inicial' : 'followup', step: s }); }}>
                <option value={1}>Primeira mensagem</option>
                {[2, 3, 4, 5, 6].map((s) => <option key={s} value={s}>{s - 1}º follow-up</option>)}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Produto"><Select value={f.product_id || ''} onChange={(e) => setF({ ...f, product_id: e.target.value })}><option value="">Todos</option>{productOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
            <Field label="Ano da base"><Select value={f.ref_year || ''} onChange={(e) => setF({ ...f, ref_year: e.target.value })}><option value="">Todos</option>{(campaign?.years?.length ? campaign.years : years).map((y) => <option key={y} value={y}>{y}</option>)}</Select></Field>
            <Field label="Status histórico"><Select value={f.historical_status || ''} onChange={(e) => setF({ ...f, historical_status: e.target.value })}><option value="">Todos</option>{Object.entries(HIST).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
          </div>
          <Field label="Texto da mensagem" hint="Quebras de linha, emojis e *negrito*/_itálico_ do WhatsApp são preservados.">
            <Textarea ref={ta} rows={11} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="Oi, {{primeiro_nome}}! Tudo bem? 😊" />
          </Field>
          <div>
            <p className="text-[12px] text-muted mb-1.5">Inserir variável:</p>
            <div className="flex flex-wrap gap-1.5">
              {variables.map((v) => <button key={v.key} type="button" onClick={() => insertVar(v.key)} className="h-7 px-2 rounded-md bg-stone-100 hover:bg-stone-200 text-[12px] font-mono">{`{{${v.key}}}`}</button>)}
            </div>
            <p className="text-[12px] text-muted mt-2"><code className="font-mono">{'{{vendedora}}'}</code> usa o nome de quem abrir o contato para enviar. Texto alternativo quando faltar o dado: <code className="font-mono">{'{{empresa|sua empresa}}'}</code>. Sem nome, “Oi, {'{{primeiro_nome}}'}!” vira “Oi!”.</p>
          </div>
        </div>
        <div className="space-y-3">
          <Field label="Pré-visualizar com dados reais de um contato">
            <div className="flex gap-2">
              <Input placeholder="Buscar contato…" value={contactQ} onChange={(e) => setContactQ(e.target.value)} />
              <Select className="max-w-[55%]" value={contactId || ''} onChange={(e) => setContactId(Number(e.target.value) || null)}>
                <option value="">Exemplo (Mariana Ferreira)</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.full_name}{c.company ? ` — ${c.company}` : ''}</option>)}
              </Select>
            </div>
          </Field>
          <div className="rounded-2xl bg-[#e7ded3] p-4 min-h-64">
            <div className="ml-auto max-w-[90%] rounded-xl rounded-tr-sm bg-[#d9fdd3] px-3 py-2 shadow-sm text-[14px] wa-text">
              {preview?.text || <span className="text-muted"><Eye className="size-4 inline mr-1" />A pré-visualização aparece aqui.</span>}
            </div>
          </div>
          {preview?.warnings?.length > 0 && <Alert tone="warning">{preview.warnings.map((w, i) => <p key={i}>{w}</p>)}</Alert>}
        </div>
      </div>
    </Modal>
  );
}

function VersionsModal({ template, onClose }) {
  const { data = [] } = useQuery({ queryKey: ['versions', template.id], queryFn: () => api.get(`/templates/${template.id}/versions`) });
  return (
    <Modal open onClose={onClose} title={`Versões — ${template.name}`} size="lg">
      <div className="space-y-3">
        {data.map((v) => (
          <div key={v.id} className={cx('rounded-lg ring-1 ring-line p-3', v.version === template.version && 'ring-brand-200 bg-brand-50/40')}>
            <p className="text-[12px] text-muted mb-1.5">Versão {v.version} · {fmtDateTime(v.created_at)} · {v.created_by_name}</p>
            <div className="wa-text text-sm">{v.body}</div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function ImportTemplateModal({ campaignId, onClose, onDone }) {
  const toast = useToast();
  const { data = [] } = useQuery({ queryKey: ['templates', 'all'], queryFn: () => api.get('/templates') });
  const list = data.filter((t) => t.campaign_id !== campaignId);
  return (
    <Modal open onClose={onClose} title="Usar modelo existente" size="lg">
      {!list.length ? <p className="text-sm text-muted">Nenhum modelo disponível na biblioteca ou em outras campanhas.</p> : (
        <div className="space-y-2">
          {list.map((t) => (
            <div key={t.id} className="rounded-lg ring-1 ring-line p-3 flex gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{t.name} <span className="text-muted font-normal">· {t.campaign_name || 'Biblioteca'} · {t.kind === 'inicial' ? 'Inicial' : `${t.step - 1}º follow-up`}</span></p>
                <p className="wa-text text-[13px] text-muted line-clamp-3 mt-1">{t.body}</p>
              </div>
              <Button size="sm" onClick={async () => { try { await api.post(`/templates/${t.id}/copy`, { campaign_id: campaignId }); toast('Modelo copiado para a campanha'); onDone(); } catch (e) { toast(e.message, 'error'); } }}>Usar</Button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
