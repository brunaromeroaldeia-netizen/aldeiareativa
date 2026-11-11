import { Router } from 'express';
import XLSX from 'xlsx';
import { many } from '../db.js';
import { ah, bad } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { today } from '../lib/dates.js';
import { groupedMetrics, withRates, HIST_LABEL } from '../services/metrics.js';
import { participantWhere, PARTICIPANT_FROM, PARTICIPANT_COLUMNS } from '../services/participants.js';

const r = Router();

const STATUS_LABEL = {
  pendente: 'Pendente de primeiro contato', enviada: 'Mensagem enviada', aguardando: 'Aguardando resposta', followup_pendente: 'Follow-up pendente',
  respondeu: 'Cliente respondeu', interesse: 'Demonstrou interesse', retorno_futuro: 'Quer conversar futuramente', negociacao: 'Em negociação',
  convertido: 'Convertido', sem_interesse: 'Sem interesse', sem_resposta: 'Sem resposta após tentativas', opt_out: 'Não contatar (opt-out)',
};

const metricCols = (m) => ({
  'Participantes': m.participants, 'Atribuídos': m.assigned, 'Trabalhados': m.worked, 'Pendentes': m.pending,
  'Contatos com envio confirmado': m.sent, 'Mensagens enviadas': m.messages, 'Follow-ups realizados': m.followups_done,
  'Responderam': m.responded, 'Taxa de resposta (%)': m.response_rate, 'Interessados': m.interested, 'Negociações': m.negotiation,
  'Convertidos': m.converted, 'Taxa de conversão (%)': m.conversion_rate, 'Conversão s/ respondentes (%)': m.conversion_over_responded,
  'Conversão s/ interessados (%)': m.conversion_over_interested, 'Sem interesse': m.no_interest, 'Sem resposta': m.no_response,
  'Opt-out': m.opt_out, 'Follow-ups atrasados': m.followups_overdue, 'Receita recuperada (R$)': m.revenue,
});

const fmtDate = (d) => (d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');
const fmtDay = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');

function participantRow(p) {
  return {
    'Cliente': p.full_name, 'Empresa': p.company || '', 'Telefone': p.phone || '', 'E-mail': p.email || '',
    'Campanha': p.campaign_name, 'Produto': p.product_name || '', 'Ano da base': p.ref_year || '', 'Status histórico': HIST_LABEL[p.historical_status] || '',
    'Motivo da perda': p.lost_reason || '', 'Responsável': p.assigned_name || '', 'Situação da reativação': STATUS_LABEL[p.status] || p.status,
    'Tentativas': p.attempts, 'Primeiro envio': fmtDate(p.first_sent_at), 'Último envio': fmtDate(p.last_sent_at),
    'Respondeu em': fmtDate(p.responded_at), 'Convertido em': fmtDate(p.converted_at), 'Valor da conversão (R$)': p.conversion_value ?? '',
    'Próximo follow-up': fmtDay(p.next_due), 'Observações': p.notes || '',
  };
}

export const REPORTS = {
  campanhas: { title: 'Resultado por campanha', kind: 'grouped', group: 'cc.campaign_id', labelSql: 'SELECT id, name AS label, status, start_date, end_date FROM campaigns' },
  produtos: { title: 'Resultado por produto', kind: 'grouped', group: 'COALESCE(o.product_id, c.product_ids[1])', labelSql: 'SELECT id, name AS label FROM products' },
  anos: { title: 'Resultado por ano da base', kind: 'grouped', group: 'o.ref_year' },
  status_historico: { title: 'Resultado por status histórico', kind: 'grouped', group: 'o.historical_status' },
  vendedoras: { title: 'Resultado por vendedora', kind: 'grouped', group: 'cc.assigned_to', labelSql: 'SELECT id, name AS label FROM users' },
  sem_resposta: { title: 'Contatos sem resposta', kind: 'list', query: { metric: 'sem_resposta' } },
  aguardando: { title: 'Aguardando resposta', kind: 'list', query: { metric: 'aguardando_resposta' } },
  interessados: { title: 'Leads interessados', kind: 'list', query: { status: 'interesse,negociacao,respondeu,retorno_futuro' } },
  convertidos: { title: 'Leads convertidos', kind: 'list', query: { metric: 'convertidos' } },
  opt_out: { title: 'Não desejam receber contato', kind: 'optout' },
  followups: { title: 'Follow-ups pendentes e atrasados', kind: 'list', query: { metric: 'followups_pendentes' } },
  participantes: { title: 'Todos os participantes', kind: 'list', query: {} },
};

async function build(req, type) {
  const def = REPORTS[type];
  if (!def) throw bad('Relatório desconhecido.');
  const q = { ...req.query };
  if (req.user.role !== 'admin') q.seller = String(req.user.id);
  if (def.kind === 'grouped') {
    const rows = (await groupedMetrics(q, def.group)).map(withRates);
    const labels = def.labelSql ? await many(def.labelSql) : [];
    return rows.map((m) => {
      const l = labels.find((x) => x.id === m.key);
      let label = l?.label;
      if (type === 'anos') label = m.key ? String(m.key) : 'Sem ano';
      if (type === 'status_historico') label = HIST_LABEL[m.key] || 'Sem histórico';
      if (type === 'vendedoras' && m.key === null) label = 'Sem responsável';
      const head = { [def.title.replace('Resultado por ', '').replace(/^./, (s) => s.toUpperCase())]: label || 'Não informado' };
      if (type === 'campanhas' && l) Object.assign(head, { 'Status': l.status, 'Início': fmtDay(l.start_date), 'Fim': fmtDay(l.end_date) });
      return { ...head, ...metricCols(m) };
    });
  }
  if (def.kind === 'optout') {
    if (req.user.role !== 'admin') throw bad('Relatório restrito à administradora.');
    const rows = await many(`SELECT ct.full_name, ct.company, ct.phone, ct.email, ct.dnc_at, ct.dnc_reason, u.name AS by_name
      FROM contacts ct LEFT JOIN users u ON u.id=ct.dnc_by WHERE ct.do_not_contact AND ct.anonymized_at IS NULL ORDER BY ct.dnc_at DESC NULLS LAST`);
    return rows.map((x) => ({ 'Cliente': x.full_name, 'Empresa': x.company || '', 'Telefone': x.phone || '', 'E-mail': x.email || '',
      'Registrado em': fmtDate(x.dnc_at), 'Registrado por': x.by_name || '', 'Motivo': x.dnc_reason || '' }));
  }
  const merged = { ...q, ...def.query };
  const { where, params } = participantWhere(req, merged);
  const rows = await many(`SELECT ${PARTICIPANT_COLUMNS} ${PARTICIPANT_FROM} WHERE ${where} ORDER BY c.name, ct.full_name LIMIT 50000`, params);
  return rows.map(participantRow);
}

r.get('/', (_req, res) => res.json(Object.entries(REPORTS).map(([key, v]) => ({ key, title: v.title, kind: v.kind }))));

r.get('/:type', ah(async (req, res) => {
  const type = req.params.type;
  const rows = await build(req, type);
  const format = req.query.format === 'csv' ? 'csv' : req.query.format === 'json' ? 'json' : 'xlsx';
  if (format === 'json') return res.json({ title: REPORTS[type].title, rows: rows.slice(0, 500), total: rows.length });
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'Sem dados': 'Nenhum registro para os filtros selecionados.' }]);
  const filename = `aldeia-reativa-${type}-${today()}`;
  await audit(req, 'relatorio_exportado', 'report', null, { type, format, rows: rows.length, filters: req.query });
  if (format === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(ws, { FS: ';' });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    return res.send(`﻿${csv}`);
  }
  ws['!cols'] = Object.keys(rows[0] || { a: 1 }).map((k) => ({ wch: Math.min(40, Math.max(12, k.length + 2)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, REPORTS[type].title.slice(0, 31));
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  res.send(buf);
}));

export default r;
