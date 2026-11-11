import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  X, Copy, CheckCheck, Send, Phone, Mail, Building2, ChevronRight, ChevronLeft, PencilLine, RotateCcw, MessageSquareText,
  ThumbsUp, ThumbsDown, Handshake, CalendarPlus, Trophy, Ban, Clock, StickyNote, History, ExternalLink,
} from 'lucide-react';
import { api, copyText } from '../lib/api.js';
import { useAuth } from '../lib/context.jsx';
import { fmtDate, fmtDateTime, fmtMoney, relDays, addDaysIso, STATUS } from '../lib/format.js';
import {
  Button, Badge, StatusBadge, HistBadge, CampaignBadge, Alert, Textarea, Input, Field, Select, Loading, cx, useToast, useConfirm, DemoTag,
} from './ui.jsx';

const EVENT_LABEL = {
  envio: 'Mensagem enviada', status: 'Situação atualizada', nota: 'Observação', atribuicao: 'Atribuição', followup_agendado: 'Follow-up',
  followup_cancelado: 'Follow-up cancelado', sistema: 'Sistema', conversao: 'Conversão registrada', opt_out: 'Opt-out', participacao: 'Campanha',
};

export default function ParticipantPanel({ id, onClose, onPrev, onNext, position }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const [confirm, confirmDialog] = useConfirm();
  const [templateId, setTemplateId] = useState(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['participant', id, templateId],
    queryFn: () => api.get(`/participants/${id}${templateId ? `?template_id=${templateId}` : ''}`),
  });
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [action, setAction] = useState(null);
  const [notes, setNotes] = useState('');
  const [newNote, setNewNote] = useState('');

  useEffect(() => { setTemplateId(null); setCopied(false); setEditing(false); setAction(null); setNewNote(''); }, [id]);
  useEffect(() => { if (data) { setText(data.message.text); setNotes(data.participant.notes || ''); } }, [data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['participant', id] });
    ['participants', 'queues', 'board', 'dashboard', 'overview', 'agenda', 'campaign', 'campaigns', 'contact'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };

  const send = useMutation({
    mutationFn: () => api.post(`/participants/${id}/send`, {
      message_text: text, template_id: data.message.template?.id ?? null, template_version: data.message.template?.version ?? null,
      expected_attempts: data.participant.attempts, note: editing && text !== data.message.text ? 'Mensagem editada antes do envio' : undefined,
    }),
    onSuccess: (r) => {
      toast(r.nextDue ? `Envio registrado. Follow-up agendado para ${fmtDate(r.nextDue)}.` : 'Envio registrado. Limite de tentativas atingido.');
      setCopied(false); setEditing(false); invalidate();
    },
    onError: (e) => toast(e.message, 'error'),
  });

  const outcome = useMutation({
    mutationFn: (body) => api.post(`/participants/${id}/outcome`, body),
    onSuccess: (_r, body) => { toast(`Situação atualizada: ${STATUS[body.status]?.long}`); setAction(null); invalidate(); },
    onError: (e) => toast(e.message, 'error'),
  });

  if (isLoading) return <Shell onClose={onClose}><Loading /></Shell>;
  if (error) return <Shell onClose={onClose}><div className="p-6"><Alert tone="danger">{error.message}</Alert></div></Shell>;

  const { participant: p, contact, opportunity, opportunities, events, followups, history, warnings, message, canAct } = data;
  const closed = p.campaign_status !== 'ativa';
  const canSend = canAct && !closed && !contact.do_not_contact && ['pendente', 'enviada', 'aguardando', 'followup_pendente', 'retorno_futuro'].includes(p.status);
  const pendingFu = followups.find((f) => f.status === 'pendente');
  const sentToday = p.last_sent_at && new Date(p.last_sent_at).toDateString() === new Date().toDateString();

  const doCopy = async () => {
    if (!text.trim()) return toast('Não há mensagem para copiar.', 'error');
    const ok = await copyText(text);
    if (!ok) return toast('Não foi possível copiar. Selecione o texto manualmente.', 'error');
    setCopied(true);
    toast('Mensagem copiada. Envie pelo CowPilot e depois confirme o envio.');
    api.post(`/participants/${id}/copy`, { template_id: message.template?.id ?? null, edited: text !== message.text }).catch(() => {});
  };

  const doSend = async () => {
    if (!copied) {
      const ok = await confirm({ title: 'Confirmar envio', message: 'Você ainda não copiou a mensagem nesta tela.\nConfirme apenas se a mensagem já foi enviada pelo CowPilot.', confirmLabel: 'Já enviei' });
      if (!ok) return;
    }
    send.mutate();
  };

  return (
    <Shell onClose={onClose} onPrev={onPrev} onNext={onNext} position={position}
      title={contact.full_name} subtitle={<>{p.campaign_name} {p.is_demo && <DemoTag />}</>}>
      {confirmDialog}
      <div className="px-5 py-4 space-y-5">
        {/* cabeçalho */}
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={p.status} long />
          {p.next_action?.label && <Badge className={cx(p.next_action.tone === 'danger' ? 'bg-rose-50 text-rose-700 ring-rose-200' : p.next_action.tone === 'warning' ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-white text-muted ring-line')}><Clock className="size-3" />{p.next_action.label}</Badge>}
          <span className="text-[12px] text-muted">{p.attempts} de {p.max_attempts} abordagens</span>
          {closed && <CampaignBadge status={p.campaign_status} />}
        </div>

        {warnings.map((w, i) => <Alert key={i} tone={w.level === 'danger' ? 'danger' : 'warning'}>{w.msg}</Alert>)}
        {!canAct && <Alert tone="info">Este contato está atribuído a {data.seller?.name || 'ninguém'}. Somente a responsável (ou a administradora) pode registrar ações.</Alert>}

        {/* dados */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Info icon={Phone} label="Telefone / WhatsApp">
            {contact.phone ? <button className="hover:underline tabular" onClick={async () => { await copyText(contact.phone); toast('Telefone copiado'); }}>{contact.phone}</button> : <span className="text-rose-600">Sem telefone</span>}
          </Info>
          <Info icon={Mail} label="E-mail">{contact.email || '—'}</Info>
          <Info icon={Building2} label="Empresa">{contact.company || '—'}</Info>
          <Info label="Produto · ano">{opportunity ? `${opportunity.product_name || 'Sem produto'} · ${opportunity.ref_year || 's/ ano'}` : '—'}{opportunity?.year_inferred && <span className="text-[11px] text-amber-700 ml-1">(ano inferido)</span>}</Info>
          <Info label="Status histórico"><HistBadge status={opportunity?.historical_status} /></Info>
          <Info label="Motivo da perda">{opportunity?.lost_reason || '—'}</Info>
          {opportunity?.original_owner && <Info label="Responsável original">{opportunity.original_owner}</Info>}
          {opportunity?.value ? <Info label="Valor original">{fmtMoney(opportunity.value)}</Info> : null}
          {isAdmin && <Info label="Responsável atual">{data.seller?.name || 'Sem responsável'}</Info>}
        </div>

        {/* mensagem */}
        <section className="rounded-xl ring-1 ring-line bg-stone-50/70">
          <div className="flex items-center justify-between gap-2 px-4 pt-3">
            <p className="text-[13px] font-semibold flex items-center gap-1.5"><MessageSquareText className="size-4 text-brand-600" />
              {message.step === 1 ? 'Mensagem de abordagem' : `Mensagem de follow-up (${message.step}ª abordagem)`}</p>
            {message.options.length > 1 && (
              <Select className="!h-8 !w-auto max-w-[55%] text-[13px]" value={message.template?.id || ''} onChange={(e) => setTemplateId(Number(e.target.value) || null)}>
                {message.options.map((o) => <option key={o.id} value={o.id}>{o.kind === 'inicial' ? 'Inicial' : `Follow-up ${o.step - 1}`} — {o.name}</option>)}
              </Select>
            )}
          </div>
          {message.warnings.length > 0 && <div className="px-4 pt-2 space-y-1">{message.warnings.map((w, i) => <p key={i} className="text-[12px] text-amber-800">⚠ {w}</p>)}</div>}
          <div className="p-4 pt-3">
            {editing ? (
              <Textarea rows={9} value={text} onChange={(e) => { setText(e.target.value); setCopied(false); }} className="font-[inherit] text-[14px]" />
            ) : (
              <div className="wa-text rounded-lg bg-white ring-1 ring-line px-3.5 py-3 text-[14px] leading-relaxed min-h-24">{text || <span className="text-muted">Sem mensagem cadastrada para esta etapa.</span>}</div>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <Button variant={copied ? 'secondary' : 'dark'} size="lg" icon={copied ? CheckCheck : Copy} onClick={doCopy} disabled={!text.trim() || contact.do_not_contact} className="flex-1 sm:flex-none">
                {copied ? 'Copiada' : 'Copiar mensagem'}
              </Button>
              {canSend && (
                <Button variant="primary" size="lg" icon={Send} onClick={doSend} loading={send.isPending} className="flex-1 sm:flex-none">Confirmar envio</Button>
              )}
              <div className="flex gap-1 ml-auto">
                {editing ? <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => { setText(message.text); setEditing(false); }}>Restaurar</Button>
                  : <Button size="sm" variant="ghost" icon={PencilLine} onClick={() => setEditing(true)}>Editar</Button>}
              </div>
            </div>
            <p className="text-[12px] text-muted mt-2">Copiar não registra envio. Depois de enviar pelo CowPilot, clique em <b>Confirmar envio</b>.</p>
            {sentToday && canSend && <p className="text-[12px] text-amber-700 mt-1">Já houve envio hoje para este contato ({fmtDateTime(p.last_sent_at)}).</p>}
          </div>
        </section>

        {/* resultado */}
        {canAct && p.status !== 'opt_out' && (!closed || isAdmin) && (
          <section>
            <p className="text-[13px] font-semibold mb-2">Atualizar resultado</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Quick icon={MessageSquareText} label="Respondeu" onClick={() => setAction('respondeu')} disabled={p.status === 'pendente' || p.status === 'respondeu'} />
              <Quick icon={ThumbsUp} label="Tem interesse" onClick={() => setAction('interesse')} disabled={p.status === 'pendente' || p.status === 'interesse'} />
              <Quick icon={Handshake} label="Em negociação" onClick={() => setAction('negociacao')} disabled={p.status === 'pendente' || p.status === 'negociacao'} />
              <Quick icon={CalendarPlus} label="Conversar no futuro" onClick={() => setAction('retorno_futuro')} disabled={p.status === 'pendente'} />
              <Quick icon={Trophy} label="Converteu" tone="brand" onClick={() => setAction('convertido')} disabled={p.status === 'convertido' && !isAdmin} />
              <Quick icon={ThumbsDown} label="Sem interesse" onClick={() => setAction('sem_interesse')} disabled={p.status === 'pendente' || p.status === 'sem_interesse'} />
              <Quick icon={Clock} label="Encerrar sem resposta" onClick={() => setAction('sem_resposta')} disabled={p.status === 'pendente' || p.status === 'sem_resposta'} />
              <Quick icon={Ban} label="Não contatar" tone="danger" onClick={() => setAction('opt_out')} />
            </div>
            {action && <OutcomeForm action={action} p={p} today={data.today} onCancel={() => setAction(null)} onSubmit={(b) => outcome.mutate({ status: action, ...b })} loading={outcome.isPending} />}
          </section>
        )}

        {/* follow-up */}
        {canAct && (
          <FollowupBox p={p} pending={pendingFu} today={data.today} isAdmin={isAdmin} onDone={invalidate} />
        )}

        {/* observações */}
        <section className="space-y-2">
          <p className="text-[13px] font-semibold flex items-center gap-1.5"><StickyNote className="size-4 text-muted" />Observações do contato nesta campanha</p>
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canAct} placeholder="Ex.: prefere contato à tarde; pediu proposta para 2 mesas…" />
          {canAct && notes !== (p.notes || '') && (
            <Button size="sm" variant="primary" onClick={async () => { try { await api.patch(`/participants/${id}`, { notes }); toast('Observações salvas'); invalidate(); } catch (e) { toast(e.message, 'error'); } }}>Salvar observações</Button>
          )}
          {canAct && (
            <div className="flex gap-2">
              <Input value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Registrar interação no histórico (ex.: ligou pedindo valores)" />
              <Button disabled={!newNote.trim()} onClick={async () => { try { await api.post(`/participants/${id}/note`, { note: newNote }); setNewNote(''); toast('Registro adicionado'); invalidate(); } catch (e) { toast(e.message, 'error'); } }}>Registrar</Button>
            </div>
          )}
        </section>

        {/* histórico */}
        <section>
          <p className="text-[13px] font-semibold mb-2 flex items-center gap-1.5"><History className="size-4 text-muted" />Histórico nesta campanha</p>
          <Timeline events={events} />
        </section>

        {history.length > 0 && (
          <section>
            <p className="text-[13px] font-semibold mb-2">Outras campanhas com este contato</p>
            <div className="space-y-2">
              {history.map((h) => (
                <details key={h.id} className="rounded-lg ring-1 ring-line px-3 py-2 text-sm">
                  <summary className="cursor-pointer flex flex-wrap items-center gap-2">
                    <span className="font-medium">{h.campaign_name}</span><StatusBadge status={h.status} />
                    <span className="text-[12px] text-muted">{h.attempts} envio(s){h.assigned_name ? ` · ${h.assigned_name}` : ''}{h.last_sent_at ? ` · último ${fmtDate(h.last_sent_at)}` : ''}</span>
                  </summary>
                  <div className="mt-2"><Timeline events={(h.events || []).map((e, i) => ({ id: i, type: e.type, created_at: e.at, message_text: e.text, note: e.note, to_status: e.to_status, user_name: e.user, attempt: e.attempt }))} compact /></div>
                </details>
              ))}
            </div>
          </section>
        )}

        {opportunities.length > 1 && (
          <section>
            <p className="text-[13px] font-semibold mb-2">Oportunidades históricas do contato</p>
            <div className="divide-y divide-line rounded-lg ring-1 ring-line text-sm">
              {opportunities.map((o) => (
                <div key={o.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="font-medium">{o.product_name || 'Sem produto'}</span><span className="text-muted">{o.ref_year || 's/ ano'}</span><HistBadge status={o.historical_status} />
                  {o.lost_reason && <span className="text-[12px] text-muted">· {o.lost_reason}</span>}
                </div>
              ))}
            </div>
          </section>
        )}
        <Link to={`/contatos/${contact.id}`} className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">Abrir ficha completa do contato <ExternalLink className="size-3.5" /></Link>
      </div>
    </Shell>
  );
}

function Shell({ children, onClose, onPrev, onNext, title, subtitle, position }) {
  useEffect(() => {
    const h = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      if (e.key === 'ArrowDown' || e.key === 'j') onNext?.();
      if (e.key === 'ArrowUp' || e.key === 'k') onPrev?.();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onNext, onPrev]);
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-5 h-16 border-b border-line shrink-0">
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">{title}</p>
          {subtitle && <p className="text-[12px] text-muted truncate flex items-center gap-1.5">{subtitle}</p>}
        </div>
        {position && <span className="text-[12px] text-muted tabular hidden sm:inline">{position}</span>}
        {onPrev && <button onClick={onPrev} className="p-1.5 rounded-md hover:bg-stone-100" title="Anterior (↑)"><ChevronLeft className="size-5" /></button>}
        {onNext && <button onClick={onNext} className="p-1.5 rounded-md hover:bg-stone-100" title="Próximo (↓)"><ChevronRight className="size-5" /></button>}
        <button onClick={onClose} className="p-1.5 rounded-md hover:bg-stone-100" aria-label="Fechar"><X className="size-5" /></button>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin">{children}</div>
    </div>
  );
}

function Info({ icon: Icon, label, children }) {
  return (
    <div className="min-w-0">
      <p className="text-[11.5px] text-muted flex items-center gap-1">{Icon && <Icon className="size-3" />}{label}</p>
      <div className="truncate">{children}</div>
    </div>
  );
}

function Quick({ icon: Icon, label, onClick, disabled, tone }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={cx('h-10 rounded-lg ring-1 ring-inset text-[13px] font-medium flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed px-2',
        tone === 'brand' ? 'ring-brand-200 text-brand-800 hover:bg-brand-50' : tone === 'danger' ? 'ring-rose-200 text-rose-700 hover:bg-rose-50' : 'ring-line hover:bg-stone-50')}>
      <Icon className="size-4 shrink-0" />{label}
    </button>
  );
}

function OutcomeForm({ action, p, today, onCancel, onSubmit, loading }) {
  const { products } = useProductsList();
  const [note, setNote] = useState('');
  const [date, setDate] = useState(addDaysIso(today, 30));
  const [value, setValue] = useState('');
  const [convDate, setConvDate] = useState(today);
  const [productId, setProductId] = useState(p.product_ids?.[0] || '');
  const titles = {
    respondeu: 'Cliente respondeu', interesse: 'Cliente tem interesse', negociacao: 'Iniciar negociação', retorno_futuro: 'Quer conversar futuramente',
    convertido: 'Registrar conversão', sem_interesse: 'Cliente não tem interesse', sem_resposta: 'Encerrar sem resposta', opt_out: 'Não deseja receber comunicações',
  };
  const submit = () => onSubmit({
    note: note || null,
    ...(action === 'retorno_futuro' ? { return_date: date } : {}),
    ...(action === 'convertido' ? { conversion_value: value ? Number(String(value).replace(/\./g, '').replace(',', '.')) : null, conversion_date: convDate, conversion_product_id: productId ? Number(productId) : null } : {}),
  });
  return (
    <div className="mt-3 rounded-xl ring-1 ring-line p-4 space-y-3 bg-white">
      <p className="text-sm font-semibold">{titles[action]}</p>
      {action === 'opt_out' && <Alert tone="danger">O contato será bloqueado para esta e para futuras campanhas. Follow-ups pendentes serão cancelados.</Alert>}
      {['respondeu', 'interesse', 'negociacao', 'retorno_futuro', 'convertido', 'sem_interesse', 'opt_out'].includes(action) && (
        <p className="text-[12px] text-muted">Follow-ups automáticos pendentes desta campanha serão cancelados.</p>
      )}
      {action === 'retorno_futuro' && <Field label="Data de retorno"><Input type="date" min={addDaysIso(today, 1)} value={date} onChange={(e) => setDate(e.target.value)} /></Field>}
      {action === 'convertido' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Valor (R$)" hint="Opcional"><Input inputMode="decimal" placeholder="0,00" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
          <Field label="Data"><Input type="date" max={today} value={convDate} onChange={(e) => setConvDate(e.target.value)} /></Field>
          <Field label="Produto contratado">
            <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">—</option>{products.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
            </Select>
          </Field>
        </div>
      )}
      <Field label="Observação"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="O que o cliente disse?" /></Field>
      <div className="flex gap-2 justify-end">
        <Button onClick={onCancel}>Cancelar</Button>
        <Button variant={action === 'opt_out' ? 'danger' : 'primary'} onClick={submit} loading={loading}>Salvar</Button>
      </div>
    </div>
  );
}

function useProductsList() {
  const { data = [] } = useQuery({ queryKey: ['products'], queryFn: () => api.get('/products'), staleTime: 300000 });
  return { products: data };
}

function FollowupBox({ p, pending, today, isAdmin, onDone }) {
  const toast = useToast();
  const [date, setDate] = useState('');
  const [open, setOpen] = useState(false);
  const allowed = !['convertido', 'opt_out', 'pendente'].includes(p.status) && (p.campaign_status !== 'encerrada' || isAdmin);
  const save = async (due) => {
    try { await api.post(`/participants/${p.id}/followup`, { due_date: due }); toast(due ? `Follow-up reprogramado para ${fmtDate(due)}` : 'Follow-up cancelado'); setOpen(false); onDone(); } catch (e) { toast(e.message, 'error'); }
  };
  return (
    <section className="rounded-xl ring-1 ring-line px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <p className="font-semibold text-[13px]">Próximo follow-up</p>
          {pending ? (
            <p className={cx('mt-0.5', pending.due_date < today ? 'text-rose-600 font-medium' : pending.due_date === today ? 'text-amber-700 font-medium' : 'text-ink')}>
              {fmtDate(pending.due_date)} · {relDays(pending.due_date, today)} {pending.type === 'retorno' && '(retorno combinado)'}
            </p>
          ) : <p className="text-muted mt-0.5">{p.no_response_deadline ? `Sem novos follow-ups. Encerra sem resposta após ${fmtDate(p.no_response_deadline)}.` : 'Nenhum agendado.'}</p>}
        </div>
        {allowed && (
          <div className="flex gap-1.5">
            <Button size="sm" onClick={() => setOpen((x) => !x)}>{pending ? 'Reprogramar' : 'Agendar'}</Button>
            {pending && <Button size="sm" variant="ghost" onClick={() => save(null)}>Cancelar</Button>}
          </div>
        )}
      </div>
      {open && (
        <div className="flex gap-2 mt-3">
          <Input type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} className="max-w-48" />
          <Button variant="primary" disabled={!date} onClick={() => save(date)}>Salvar</Button>
        </div>
      )}
      {p.campaign_status === 'encerrada' && <p className="text-[12px] text-muted mt-2">Campanha encerrada: follow-ups ficam suspensos, salvo reprogramação explícita pela administradora.</p>}
    </section>
  );
}

export function Timeline({ events, compact }) {
  const list = useMemo(() => events || [], [events]);
  if (!list.length) return <p className="text-sm text-muted">Nenhuma interação registrada.</p>;
  return (
    <ol className="relative border-l border-line ml-1.5 space-y-3">
      {list.map((e) => (
        <li key={e.id} className="ml-4">
          <span className={cx('absolute -left-[5px] mt-1.5 size-2.5 rounded-full ring-2 ring-white',
            e.type === 'envio' ? 'bg-sky-500' : e.type === 'conversao' ? 'bg-brand-600' : e.type === 'opt_out' ? 'bg-rose-500' : e.type === 'status' ? 'bg-violet-500' : 'bg-stone-300')} />
          <div className="text-[13px]">
            <p className="flex flex-wrap items-center gap-x-2">
              <span className="font-medium">{EVENT_LABEL[e.type] || e.type}{e.type === 'envio' && e.attempt ? ` (${e.attempt}ª)` : ''}</span>
              {e.to_status && e.type !== 'envio' && <StatusBadge status={e.to_status} />}
              <span className="text-muted text-[12px]">{fmtDateTime(e.created_at)}{e.user_name ? ` · ${e.user_name}` : ''}</span>
            </p>
            {e.note && <p className="text-ink/80 mt-0.5">{e.note}</p>}
            {e.value ? <p className="text-brand-700 font-medium">{fmtMoney(e.value)}</p> : null}
            {e.message_text && !compact && (
              <details className="mt-1"><summary className="text-[12px] text-muted cursor-pointer">Ver mensagem{e.template_name ? ` · ${e.template_name}` : ''}</summary>
                <div className="wa-text mt-1 rounded-md bg-stone-50 ring-1 ring-line px-3 py-2 text-[13px]">{e.message_text}</div></details>
            )}
            {e.message_text && compact && <div className="wa-text mt-1 rounded-md bg-stone-50 ring-1 ring-line px-3 py-2 text-[12.5px] text-ink/80">{e.message_text}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
