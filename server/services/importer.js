import XLSX from 'xlsx';
import { many, one, query, tx } from '../db.js';
import { bad } from '../lib/http.js';
import { parseDate } from '../lib/dates.js';
import {
  normKey, cleanText, normalizePhone, normalizeEmail, titleCaseName, firstNameOf, nameSimilar, parseMoney, formatPhone,
} from '../lib/normalize.js';

// ---------------------------------------------------------------------------
// Campos reconhecidos e sinônimos de cabeçalho (inclui exportações do Pipedrive)
// ---------------------------------------------------------------------------
export const FIELDS = [
  { key: 'full_name', label: 'Nome do cliente/contato', syn: ['nome', 'nome do cliente', 'cliente', 'contato', 'nome contato', 'nome do contato', 'nome completo', 'lead', 'nome do lead', 'pessoa', 'pessoa de contato', 'pessoa nome', 'name', 'full name', 'contact name', 'responsavel pelo contato'] },
  { key: 'last_name', label: 'Sobrenome', syn: ['sobrenome', 'ultimo nome', 'last name'] },
  { key: 'company', label: 'Empresa', syn: ['empresa', 'organizacao', 'organizacao nome', 'nome da empresa', 'razao social', 'company', 'organization', 'nome fantasia', 'cnpj empresa'] },
  { key: 'phone', label: 'Telefone / WhatsApp', syn: ['telefone', 'celular', 'whatsapp', 'whats', 'fone', 'tel', 'phone', 'pessoa telefone', 'telefone celular', 'numero', 'contato telefone', 'telefone whatsapp', 'mobile'] },
  { key: 'email', label: 'E-mail', syn: ['email', 'e mail', 'pessoa e mail', 'pessoa email', 'endereco de email', 'mail'] },
  { key: 'product', label: 'Produto de interesse', syn: ['produto', 'produto de interesse', 'interesse', 'servico', 'plano', 'negocio produto', 'funil', 'pipeline', 'negocio funil', 'solucao', 'product'] },
  { key: 'created_date', label: 'Data de criação/entrada', syn: ['data de criacao', 'criado em', 'data criacao', 'data de entrada', 'data entrada', 'data do lead', 'negocio criado em', 'negocio data de criacao', 'data de cadastro', 'cadastro', 'data', 'created', 'add time', 'entrada', 'data do contato'] },
  { key: 'won_date', label: 'Data do ganho', syn: ['data do ganho', 'data de ganho', 'ganho em', 'negocio data de ganho', 'won time', 'data fechamento', 'data de fechamento', 'fechado em'] },
  { key: 'lost_date', label: 'Data da perda', syn: ['data da perda', 'data de perda', 'perdido em', 'negocio data de perda', 'lost time', 'perda em'] },
  { key: 'lost_reason', label: 'Motivo da perda', syn: ['motivo da perda', 'motivo de perda', 'motivo', 'negocio motivo da perda', 'lost reason', 'razao da perda'] },
  { key: 'value', label: 'Valor da negociação', syn: ['valor', 'valor da negociacao', 'valor do negocio', 'negocio valor', 'value', 'valor mensal', 'ticket', 'mensalidade'] },
  { key: 'owner', label: 'Responsável comercial original', syn: ['responsavel', 'vendedor', 'vendedora', 'proprietario', 'negocio proprietario', 'owner', 'consultor', 'consultora', 'responsavel comercial', 'atendente'] },
  { key: 'notes', label: 'Observações', syn: ['observacoes', 'observacao', 'obs', 'notas', 'nota', 'anotacoes', 'comentarios', 'notes'] },
  { key: 'status', label: 'Status (conferência)', syn: ['status', 'situacao', 'negocio status', 'etapa', 'resultado'] },
  { key: 'unit', label: 'Unidade', syn: ['unidade', 'filial', 'local', 'espaco'] },
  { key: 'title', label: 'Título do negócio', syn: ['titulo', 'negocio titulo', 'title', 'deal', 'oportunidade'] },
];

function decodeCsv(buf) {
  const utf = buf.toString('utf8');
  if (!utf.includes('�')) return utf.replace(/^﻿/, '');
  return buf.toString('latin1');
}

function cellToValue(v) {
  if (v instanceof Date) return parseDate(v).date;
  if (typeof v === 'string') { const s = v.trim(); return s === '' ? null : s; }
  return v ?? null;
}

/** Lê o arquivo e devolve as abas com cabeçalho e linhas. */
export function parseWorkbook(buffer, filename) {
  const ext = filename.toLowerCase().split('.').pop();
  let wb;
  try {
    wb = ext === 'csv'
      ? XLSX.read(decodeCsv(buffer), { type: 'string', raw: true })
      : XLSX.read(buffer, { type: 'buffer', cellDates: true, dense: true });
  } catch {
    throw bad('Não foi possível ler o arquivo. Verifique se é uma planilha .xlsx, .xls ou .csv válida.');
  }
  const sheets = [];
  wb.SheetNames.forEach((name, position) => {
    const ws = wb.Sheets[name];
    if (!ws) return;
    const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
    if (!matrix.some((r) => r.some((c) => c !== null && c !== ''))) return;
    // linha de cabeçalho: a que tiver mais textos entre as 10 primeiras
    let hIdx = 0, best = -1;
    matrix.slice(0, 10).forEach((row, i) => {
      const texts = row.filter((c) => typeof c === 'string' && c.trim() && !/^\d+([.,]\d+)?$/.test(c.trim())).length;
      if (texts > best) { best = texts; hIdx = i; }
    });
    const width = matrix.reduce((w, r) => Math.max(w, r.length), 0);
    const seen = {};
    const headers = Array.from({ length: width }, (_, i) => {
      let h = cleanText(matrix[hIdx][i]) || `Coluna ${i + 1}`;
      if (seen[h]) h = `${h} (${++seen[h]})`; else seen[h] = 1;
      return h;
    });
    const rows = [];
    const rowNumbers = [];
    matrix.slice(hIdx + 1).forEach((r, k) => {
      const vals = headers.map((_, i) => cellToValue(r[i]));
      if (vals.some((c) => c !== null && c !== '')) { rows.push(vals); rowNumbers.push(hIdx + 2 + k); }
    });
    sheets.push({ name, position, headers, rows, rowNumbers });
  });
  if (!sheets.length) throw bad('A planilha não contém dados.');
  return sheets;
}

/** Sugere o mapeamento campo -> índice da coluna. */
export function autoMap(headers) {
  const keys = headers.map(normKey);
  const mapping = {};
  const used = new Set();
  // 1) correspondência exata  2) cabeçalho contém sinônimo (sinônimos longos primeiro)
  for (const pass of ['exact', 'contains']) {
    for (const f of FIELDS) {
      if (mapping[f.key] !== undefined) continue;
      const syns = [...f.syn].sort((a, b) => b.length - a.length);
      for (const s of syns) {
        const idx = keys.findIndex((k, i) => !used.has(i) && (pass === 'exact' ? k === s : (s.length > 3 && (` ${k} `).includes(` ${s} `))));
        if (idx >= 0) { mapping[f.key] = idx; used.add(idx); break; }
      }
    }
  }
  return mapping;
}

export function detectYear(text) {
  const m = String(text || '').match(/\b(20[1-4]\d)\b/);
  return m ? Number(m[1]) : null;
}

export function matchProduct(value, products) {
  // remove plurais simples ("mesas" -> "mesa", "eventos" -> "evento")
  const k = normKey(value).split(' ').map((t) => (t.length > 4 && t.endsWith('s') ? t.slice(0, -1) : t)).join(' ');
  if (!k) return null;
  for (const p of products) if (normKey(p.name) === k) return p.id;
  for (const p of products) if ((p.aliases || []).some((a) => normKey(a) === k)) return p.id;
  // alias contido no texto (mais longo primeiro)
  const pairs = products.flatMap((p) => [p.name, ...(p.aliases || [])].map((a) => ({ id: p.id, a: normKey(a) })))
    .filter((x) => x.a.length >= 4).sort((a, b) => b.a.length - a.a.length);
  for (const x of pairs) if ((` ${k} `).includes(` ${x.a} `)) return x.id;
  return null;
}

const STATUS_WORDS = {
  ganho: ['ganho', 'ganha', 'won', 'fechado', 'fechada', 'convertido', 'cliente', 'vendido'],
  perdido: ['perdido', 'perdida', 'lost', 'perda', 'cancelado'],
  aberto: ['aberto', 'aberta', 'open', 'em andamento', 'em aberto', 'negociacao'],
};
function statusFromColumn(v) {
  const k = normKey(v);
  if (!k) return null;
  for (const [st, words] of Object.entries(STATUS_WORDS)) if (words.some((w) => k === w || k.startsWith(`${w} `))) return st;
  return null;
}

/** Converte uma linha bruta nos campos do sistema + classificação + problemas. */
export function mapRow(row, sheet, products) {
  const m = sheet.mapping || {};
  const get = (key) => (m[key] === undefined || m[key] === null || m[key] === '' ? null : row[Number(m[key])]);
  const issues = [];
  let fullName = titleCaseName(get('full_name'));
  const last = titleCaseName(get('last_name'));
  if (fullName && last && !fullName.toLowerCase().includes(last.toLowerCase())) fullName = `${fullName} ${last}`;
  const company = cleanText(get('company'));
  const phoneRaw = cleanText(get('phone'));
  const phoneNorm = normalizePhone(phoneRaw);
  const emailRaw = cleanText(get('email'));
  const emailNorm = normalizeEmail(emailRaw);
  let nameFromCompany = false;
  if (!fullName && company) { fullName = company; nameFromCompany = true; issues.push({ level: 'aviso', msg: 'Sem nome do contato: usado o nome da empresa (a saudação ficará sem primeiro nome)' }); }
  if (!fullName && !phoneNorm && !emailNorm) issues.push({ level: 'erro', msg: 'Linha sem nome, telefone ou e-mail' });
  if (!phoneNorm) issues.push({ level: 'aviso', msg: phoneRaw ? `Telefone inválido (${phoneRaw})` : 'Sem telefone' });
  if (emailRaw && !emailNorm) issues.push({ level: 'aviso', msg: `E-mail inválido (${emailRaw})` });

  const dates = {};
  for (const k of ['created_date', 'won_date', 'lost_date']) {
    const raw = get(k);
    const { date, error } = parseDate(raw);
    dates[k] = date;
    if (error) issues.push({ level: k === 'created_date' ? 'aviso' : 'revisao', msg: `${k === 'created_date' ? 'Data de criação' : k === 'won_date' ? 'Data do ganho' : 'Data da perda'}: ${error}` });
  }

  // produto
  const productRaw = cleanText(get('product'));
  let productId = null;
  if (productRaw) {
    const mapped = sheet.product_value_map?.[normKey(productRaw)];
    productId = mapped !== undefined && mapped !== null && mapped !== '' ? Number(mapped) : matchProduct(productRaw, products);
    if (!productId && sheet.default_product_id) productId = Number(sheet.default_product_id);
  } else if (sheet.default_product_id) productId = Number(sheet.default_product_id);
  if (!productId) issues.push({ level: 'aviso', msg: productRaw ? `Produto não identificado ("${productRaw}")` : 'Produto não informado' });

  // classificação histórica
  const reviewReasons = [];
  let hist;
  const wonErr = issues.some((i) => i.msg.startsWith('Data do ganho'));
  const lostErr = issues.some((i) => i.msg.startsWith('Data da perda'));
  if (dates.won_date && dates.lost_date) { hist = 'revisao'; reviewReasons.push('Data do ganho e data da perda preenchidas'); }
  else if (dates.won_date) hist = 'ganho';
  else if (dates.lost_date) hist = 'perdido';
  else hist = 'aberto';
  if (wonErr || lostErr) { hist = 'revisao'; reviewReasons.push('Data de ganho/perda ilegível'); }
  const statusRaw = cleanText(get('status'));
  const colStatus = statusFromColumn(statusRaw);
  if (colStatus && hist !== 'revisao' && colStatus !== hist) {
    reviewReasons.push(`Coluna de status indica "${statusRaw}", mas as datas indicam "${hist}"`);
    hist = 'revisao';
  }
  if (dates.created_date && dates.won_date && dates.won_date < dates.created_date) { reviewReasons.push('Data do ganho anterior à criação'); hist = 'revisao'; }
  if (dates.created_date && dates.lost_date && dates.lost_date < dates.created_date) { reviewReasons.push('Data da perda anterior à criação'); hist = 'revisao'; }
  for (const rr of reviewReasons) issues.push({ level: 'revisao', msg: rr });

  // ano de referência
  let refYear = null, yearSource = null;
  if (dates.created_date) { refYear = Number(dates.created_date.slice(0, 4)); yearSource = 'criacao'; }
  else if (dates.won_date) { refYear = Number(dates.won_date.slice(0, 4)); yearSource = 'ganho'; }
  else if (dates.lost_date) { refYear = Number(dates.lost_date.slice(0, 4)); yearSource = 'perda'; }
  else if (sheet.default_year) { refYear = Number(sheet.default_year); yearSource = 'lote'; }
  if (yearSource && yearSource !== 'criacao') issues.push({ level: 'info', msg: `Ano inferido pela ${yearSource === 'lote' ? 'informação do lote' : `data de ${yearSource}`}` });
  if (!refYear) issues.push({ level: 'aviso', msg: 'Ano não identificado — classificar manualmente' });

  const extra = {};
  const mappedIdx = new Set(Object.values(m).filter((v) => v !== null && v !== '' && v !== undefined).map(Number));
  sheet.headers.forEach((h, i) => { if (!mappedIdx.has(i) && row[i] !== null && row[i] !== '') extra[h] = row[i]; });

  return {
    full_name: fullName, first_name: nameFromCompany ? null : firstNameOf(fullName), company,
    phone: phoneNorm ? formatPhone(phoneNorm) : phoneRaw, phone_norm: phoneNorm,
    email: emailNorm || emailRaw, email_norm: emailNorm,
    product_raw: productRaw, product_id: productId,
    created_date: dates.created_date, won_date: dates.won_date, lost_date: dates.lost_date,
    lost_reason: cleanText(get('lost_reason')), value: parseMoney(get('value')),
    owner: cleanText(get('owner')), notes: cleanText(get('notes')), unit: cleanText(get('unit')),
    title: cleanText(get('title')), status_column: statusRaw,
    historical_status: hist, review_reasons: reviewReasons, ref_year: refYear, year_source: yearSource,
    extra, issues,
  };
}

const HIST_NAMES = { ganho: 'Ganho', perdido: 'Perdido', aberto: 'Aberto', revisao: 'Revisão necessária' };

/**
 * Compara a mesma oportunidade (mesmo contato, produto e data de entrada) já existente com a linha nova.
 * Datas e dados só são acrescentados ou substituídos por valores preenchidos; a situação é recalculada
 * com as datas combinadas, evitando "regredir" um registro por causa de uma planilha incompleta.
 */
export function oppChanges(o, m) {
  const won = m.won_date || o.won_date;
  const lost = m.lost_date || o.lost_date;
  let status;
  let reasons = [];
  if (m.historical_status === 'revisao') { status = 'revisao'; reasons = m.review_reasons || []; }
  else if (won && lost) { status = 'revisao'; reasons = ['Data do ganho e data da perda preenchidas']; }
  else status = won ? 'ganho' : lost ? 'perdido' : 'aberto';
  const ch = [];
  if (status !== o.historical_status) ch.push({ field: 'historical_status', label: 'Situação', from: HIST_NAMES[o.historical_status] || o.historical_status, to: HIST_NAMES[status], value: status, reasons });
  if (m.won_date && m.won_date !== o.won_date) ch.push({ field: 'won_date', label: 'Data do ganho', from: o.won_date, to: m.won_date });
  if (m.lost_date && m.lost_date !== o.lost_date) ch.push({ field: 'lost_date', label: 'Data da perda', from: o.lost_date, to: m.lost_date });
  if (m.lost_reason && m.lost_reason !== o.lost_reason) ch.push({ field: 'lost_reason', label: 'Motivo da perda', from: o.lost_reason, to: m.lost_reason });
  if (m.value !== null && m.value !== undefined && Number(m.value) !== Number(o.value)) ch.push({ field: 'value', label: 'Valor', from: o.value, to: m.value });
  return ch;
}

const CONTACT_FIELDS = [
  { key: 'full_name', label: 'Nome' }, { key: 'company', label: 'Empresa' },
  { key: 'phone', label: 'Telefone', norm: 'phone_norm' }, { key: 'email', label: 'E-mail', norm: 'email_norm' },
];

export function computeChanges(contact, mapped, rule) {
  if (rule === 'nao_atualizar' || !contact) return [];
  const changes = [];
  for (const f of CONTACT_FIELDS) {
    const nv = mapped[f.key];
    if (!nv) continue;
    const ov = contact[f.key];
    if (!ov) changes.push({ field: f.key, label: f.label, from: null, to: nv });
    else if (rule === 'sobrescrever' && f.key !== 'full_name') {
      const same = f.norm ? contact[f.norm] === mapped[f.norm] : normKey(ov) === normKey(nv);
      if (!same) changes.push({ field: f.key, label: f.label, from: ov, to: nv });
    }
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Análise (prévia) — grava as linhas preparadas em import_rows
// ---------------------------------------------------------------------------
export async function analyzeImport(importId) {
  const imp = await one('SELECT * FROM imports WHERE id=$1', [importId]);
  if (!imp) throw bad('Importação não encontrada.');
  if (imp.status === 'concluida') throw bad('Importação já concluída.');
  const sheets = await many('SELECT * FROM import_sheets WHERE import_id=$1 AND include ORDER BY position', [importId]);
  if (!sheets.length) throw bad('Selecione ao menos uma aba para importar.');
  const products = await many('SELECT id, name, aliases FROM products');

  const prepared = [];
  const productValues = new Map();
  let emptyRows = 0;
  for (const sheet of sheets) {
    const mapping = sheet.mapping || {};
    if (mapping.full_name === undefined && mapping.phone === undefined && mapping.email === undefined) {
      throw bad(`Aba "${sheet.name}": mapeie ao menos nome, telefone ou e-mail.`);
    }
    sheet.rows.forEach((row, i) => {
      const mapped = mapRow(row, sheet, products);
      if (!mapped.full_name && !mapped.phone_norm && !mapped.email_norm && !mapped.company) { emptyRows++; return; }
      if (!mapped.full_name) mapped.full_name = mapped.phone || mapped.email || '(sem nome)';
      if (mapped.product_raw) {
        const k = `${sheet.id}|${normKey(mapped.product_raw)}`;
        const pv = productValues.get(k) || { sheet_id: sheet.id, sheet: sheet.name, value: mapped.product_raw, key: normKey(mapped.product_raw), count: 0, product_id: mapped.product_id };
        pv.count++;
        productValues.set(k, pv);
      }
      prepared.push({ sheet: sheet.name, row_number: sheet.row_numbers?.[i] ?? i + 2, raw: Object.fromEntries(sheet.headers.map((h, j) => [h, row[j]])), mapped });
    });
  }

  // contatos existentes que compartilham telefone/e-mail
  const phones = [...new Set(prepared.map((p) => p.mapped.phone_norm).filter(Boolean))];
  const emails = [...new Set(prepared.map((p) => p.mapped.email_norm).filter(Boolean))];
  const existing = await many(`SELECT id, full_name, company, phone, phone_norm, email, email_norm, do_not_contact FROM contacts
     WHERE anonymized_at IS NULL AND (phone_norm = ANY($1) OR email_norm = ANY($2))`, [phones, emails]);
  const byPhone = new Map(), byEmail = new Map();
  for (const c of existing) {
    if (c.phone_norm) byPhone.set(c.phone_norm, [...(byPhone.get(c.phone_norm) || []), c]);
    if (c.email_norm) byEmail.set(c.email_norm, [...(byEmail.get(c.email_norm) || []), c]);
  }
  const contactIds = existing.map((c) => c.id);
  const existingOpps = contactIds.length ? await many(`SELECT id, contact_id, product_id, created_date, won_date, lost_date, ref_year, historical_status, lost_reason, value, status_manual
     FROM opportunities WHERE contact_id = ANY($1)`, [contactIds]) : [];

  // agrupamento interno (mesma pessoa repetida no arquivo) via union-find
  const parent = prepared.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const firstBy = new Map();
  prepared.forEach((p, i) => {
    for (const k of [p.mapped.phone_norm && `p:${p.mapped.phone_norm}`, p.mapped.email_norm && `e:${p.mapped.email_norm}`].filter(Boolean)) {
      if (firstBy.has(k)) parent[find(i)] = find(firstBy.get(k)); else firstBy.set(k, i);
    }
  });
  const groupSize = new Map();
  prepared.forEach((_, i) => groupSize.set(find(i), (groupSize.get(find(i)) || 0) + 1));
  const oppSeenInFile = new Set();

  for (const [i, p] of prepared.entries()) {
    const mp = p.mapped;
    const cands = new Map();
    const reasons = {};
    for (const c of byPhone.get(mp.phone_norm) || []) { cands.set(c.id, c); (reasons[c.id] ||= []).push('telefone'); }
    for (const c of byEmail.get(mp.email_norm) || []) { cands.set(c.id, c); (reasons[c.id] ||= []).push('e-mail'); }
    p.candidates = [...cands.values()].map((c) => ({ id: c.id, full_name: c.full_name, company: c.company, phone: c.phone, email: c.email, by: reasons[c.id] }));
    p.group_key = `g${find(i)}`;
    p.dup_opportunity_id = null;
    p.opp_changes = [];
    p.changes = [];
    if (cands.size === 0) {
      p.match_type = groupSize.get(find(i)) > 1 ? 'interno' : 'novo';
      p.match_contact_id = null;
    } else if (cands.size === 1) {
      const c = [...cands.values()][0];
      const onlyPhone = reasons[c.id].length === 1 && reasons[c.id][0] === 'telefone';
      if (onlyPhone && !nameSimilar(c.full_name, mp.full_name) && mp.email_norm && c.email_norm && mp.email_norm !== c.email_norm) p.match_type = 'ambiguo';
      else if (!nameSimilar(c.full_name, mp.full_name)) p.match_type = 'ambiguo';
      else p.match_type = 'existente';
      p.match_contact_id = c.id;
      if (p.match_type === 'existente') {
        const dup = existingOpps.find((o) => o.contact_id === c.id && o.product_id === mp.product_id &&
          ((mp.created_date && o.created_date === mp.created_date) ||
           (!mp.created_date && o.ref_year === mp.ref_year && o.historical_status === mp.historical_status && o.won_date === mp.won_date && o.lost_date === mp.lost_date)));
        if (dup) {
          p.dup_opportunity_id = dup.id;
          // mesma oportunidade com informação nova (ex.: aberto -> perdido): vira atualização, não duplicidade
          if (mp.created_date && dup.created_date === mp.created_date) p.opp_changes = oppChanges(dup, mp);
          if (p.opp_changes.length) {
            mp.issues.push({ level: 'info', msg: 'Oportunidade já importada com informação nova: será atualizada' });
            if (dup.status_manual && p.opp_changes.some((x) => x.field === 'historical_status')) mp.issues.push({ level: 'aviso', msg: 'A situação desta oportunidade tinha sido ajustada manualmente' });
          }
        }
        p.changes = computeChanges(c, mp, imp.update_rule);
        if (c.do_not_contact) mp.issues.push({ level: 'info', msg: 'Contato existente com bloqueio de comunicação (opt-out)' });
      }
    } else {
      p.match_type = 'ambiguo';
      p.match_contact_id = null;
    }
    // oportunidade repetida dentro do próprio arquivo
    const oppKey = `${p.group_key}|${p.match_contact_id || ''}|${mp.product_id}|${mp.created_date}|${mp.won_date}|${mp.lost_date}|${mp.ref_year}`;
    if (oppSeenInFile.has(oppKey)) { p.dup_in_file = true; mp.issues.push({ level: 'aviso', msg: 'Linha repetida no arquivo (mesma pessoa, produto e datas)' }); }
    oppSeenInFile.add(oppKey);
  }

  await tx(async (c) => {
    await c.query('DELETE FROM import_rows WHERE import_id=$1', [importId]);
    const chunk = 300;
    for (let s = 0; s < prepared.length; s += chunk) {
      const part = prepared.slice(s, s + chunk);
      const vals = [];
      const params = [];
      part.forEach((p, j) => {
        const b = j * 17;
        vals.push(`(${Array.from({ length: 17 }, (_, k) => `$${b + k + 1}`).join(',')})`);
        const plainDup = p.dup_opportunity_id && !p.opp_changes.length;
        const decision = plainDup || p.dup_in_file ? 'ignorar' : 'auto';
        params.push(importId, p.sheet, p.row_number, p.raw, p.mapped, JSON.stringify(p.mapped.issues), p.mapped.historical_status,
          p.mapped.ref_year, p.mapped.year_source, p.mapped.product_id, p.match_type, p.match_contact_id,
          JSON.stringify(p.candidates), p.group_key, p.dup_opportunity_id, JSON.stringify({ changes: p.changes, decision }), JSON.stringify(p.opp_changes));
      });
      await c.query(`INSERT INTO import_rows(import_id, sheet_name, row_number, raw, mapped, issues, historical_status, ref_year, year_source,
          product_id, match_type, match_contact_id, candidates, group_key, dup_opportunity_id, changes, opp_changes) VALUES ${vals.join(',')}`, params);
    }
    // o campo changes recebeu {changes, decision} temporariamente: separa
    await c.query(`UPDATE import_rows SET decision = changes->>'decision', changes = changes->'changes' WHERE import_id=$1`, [importId]);
    await c.query(`UPDATE imports SET status='analisada' WHERE id=$1`, [importId]);
  });

  const stats = await importStats(importId);
  stats.emptyRows = emptyRows;
  stats.productValues = [...productValues.values()].sort((a, b) => b.count - a.count);
  await query('UPDATE imports SET stats=$2 WHERE id=$1', [importId, stats]);
  return stats;
}

export async function importStats(importId) {
  const q = (sql) => many(sql, [importId]);
  const [tot] = await q(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE mapped->>'phone_norm' IS NULL)::int AS without_phone,
      count(*) FILTER (WHERE match_type='novo')::int AS new_rows,
      count(DISTINCT group_key) FILTER (WHERE match_type IN ('novo','interno'))::int AS new_contacts,
      count(*) FILTER (WHERE match_type='interno')::int AS in_file_dups,
      count(*) FILTER (WHERE match_type='existente')::int AS existing,
      count(*) FILTER (WHERE match_type='ambiguo')::int AS ambiguous,
      count(*) FILTER (WHERE match_type='ambiguo' AND decision='auto')::int AS ambiguous_pending,
      count(*) FILTER (WHERE dup_opportunity_id IS NOT NULL AND jsonb_array_length(opp_changes) = 0)::int AS dup_opportunities,
      count(*) FILTER (WHERE jsonb_array_length(opp_changes) > 0)::int AS opp_updates,
      count(*) FILTER (WHERE jsonb_array_length(opp_changes) > 0 AND decision = 'auto')::int AS opp_updates_selected,
      count(*) FILTER (WHERE decision='ignorar')::int AS skipped,
      count(*) FILTER (WHERE jsonb_array_length(changes) > 0)::int AS with_updates,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(issues) x WHERE x->>'level' IN ('erro','revisao','aviso') AND x->>'msg' NOT IN ('Sem telefone')))::int AS with_issues,
      count(*) FILTER (WHERE product_id IS NULL)::int AS without_product,
      count(*) FILTER (WHERE ref_year IS NULL)::int AS without_year,
      count(*) FILTER (WHERE year_source IN ('ganho','perda','lote'))::int AS year_inferred
    FROM import_rows WHERE import_id=$1`);
  const byYear = await q(`SELECT ref_year AS key, count(*)::int AS n FROM import_rows WHERE import_id=$1 GROUP BY 1 ORDER BY 1 NULLS LAST`);
  const byStatus = await q(`SELECT historical_status AS key, count(*)::int AS n FROM import_rows WHERE import_id=$1 GROUP BY 1`);
  const byProduct = await q(`SELECT r.product_id AS key, COALESCE(p.name,'Sem produto') AS label, count(*)::int AS n FROM import_rows r
    LEFT JOIN products p ON p.id=r.product_id WHERE r.import_id=$1 GROUP BY 1,2 ORDER BY 3 DESC`);
  const bySheet = await q(`SELECT sheet_name AS key, count(*)::int AS n FROM import_rows WHERE import_id=$1 GROUP BY 1`);
  return { ...tot, byYear, byStatus, byProduct, bySheet };
}

// ---------------------------------------------------------------------------
// Confirmação — cria contatos e oportunidades sem apagar nada do que existe
// ---------------------------------------------------------------------------
export async function commitImport(importId, user, { isDemo = false } = {}) {
  return tx(async (c) => {
    const imp = (await c.query('SELECT * FROM imports WHERE id=$1 FOR UPDATE', [importId])).rows[0];
    if (!imp) throw bad('Importação não encontrada.');
    if (imp.status === 'concluida') throw bad('Esta importação já foi concluída.');
    if (imp.status !== 'analisada') throw bad('Analise a importação antes de confirmar.');
    const rows = (await c.query('SELECT * FROM import_rows WHERE import_id=$1 ORDER BY id', [importId])).rows;
    const pending = rows.filter((r) => r.match_type === 'ambiguo' && r.decision === 'auto').length;
    if (pending) throw bad(`Existem ${pending} correspondência(s) ambígua(s) para decidir antes de confirmar.`);

    const groupContact = new Map();
    const updatedContacts = new Set();
    const res = { contactsCreated: 0, contactsUpdated: 0, contactsLinked: 0, opportunitiesCreated: 0, opportunitiesUpdated: 0, rowsSkipped: 0 };

    const createContact = async (m) => {
      const ins = await c.query(`INSERT INTO contacts(full_name, first_name, company, phone, phone_norm, email, email_norm, notes, source, is_demo, created_by, extra)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [m.full_name, m.first_name, m.company, m.phone, m.phone_norm, m.email, m.email_norm, null, isDemo ? 'demo' : 'importacao', isDemo, user.id, {}]);
      res.contactsCreated++;
      return ins.rows[0].id;
    };

    for (const r of rows) {
      const m = r.mapped;
      if (r.decision === 'ignorar') { res.rowsSkipped++; continue; }
      let contactId;
      if (r.decision === 'vincular') contactId = r.decision_contact_id;
      else if (r.decision === 'criar') contactId = await createContact(m);
      else if (r.match_type === 'existente') contactId = r.match_contact_id;
      else {
        contactId = groupContact.get(r.group_key);
        if (!contactId) { contactId = await createContact(m); groupContact.set(r.group_key, contactId); }
      }
      if (!contactId) throw bad(`Linha ${r.row_number} (${r.sheet_name}) sem contato definido.`);
      if (r.match_type === 'existente' || r.decision === 'vincular') res.contactsLinked++;

      // atualização do cadastro existente, conforme a regra escolhida (uma vez por contato)
      if ((r.match_type === 'existente' || r.decision === 'vincular') && !updatedContacts.has(contactId) && imp.update_rule !== 'nao_atualizar') {
        const cur = (await c.query('SELECT * FROM contacts WHERE id=$1', [contactId])).rows[0];
        const changes = computeChanges(cur, m, imp.update_rule);
        if (changes.length) {
          const set = {};
          for (const ch of changes) {
            set[ch.field] = ch.to;
            if (ch.field === 'phone') set.phone_norm = m.phone_norm;
            if (ch.field === 'email') set.email_norm = m.email_norm;
            if (ch.field === 'full_name') set.first_name = m.first_name;
          }
          const keys = Object.keys(set);
          await c.query(`UPDATE contacts SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [contactId, ...keys.map((k) => set[k])]);
          await c.query(`INSERT INTO audit_log(user_id, action, entity, entity_id, details) VALUES ($1,'contato_atualizado_importacao','contact',$2,$3)`,
            [user.id, contactId, { import_id: importId, changes }]);
          res.contactsUpdated++;
        }
        updatedContacts.add(contactId);
      }

      // atualização de oportunidade já existente (nunca apaga: preenche/substitui com dados novos e guarda o histórico)
      if (r.dup_opportunity_id && (r.opp_changes || []).length && r.decision === 'auto') {
        const cur = (await c.query('SELECT * FROM opportunities WHERE id=$1 FOR UPDATE', [r.dup_opportunity_id])).rows[0];
        const ch = cur ? oppChanges(cur, m) : [];
        if (ch.length) {
          const st = ch.find((x) => x.field === 'historical_status');
          await c.query(`UPDATE opportunities SET
              won_date = COALESCE($2, won_date), lost_date = COALESCE($3, lost_date), lost_reason = COALESCE($4, lost_reason),
              value = COALESCE($5, value), status_column = COALESCE($6, status_column),
              historical_status = COALESCE($7, historical_status),
              review_reasons = CASE WHEN $7::text IS NULL THEN review_reasons ELSE $8::jsonb END,
              status_manual = CASE WHEN $7::text IS NULL THEN status_manual ELSE FALSE END,
              updated_at = now()
            WHERE id = $1`,
          [cur.id, m.won_date, m.lost_date, m.lost_reason, m.value, m.status_column, st ? st.value : null, JSON.stringify(st ? st.reasons : [])]);
          await c.query('INSERT INTO opportunity_history(opportunity_id, import_id, user_id, changes) VALUES ($1,$2,$3,$4)', [cur.id, importId, user.id, JSON.stringify(ch)]);
          await c.query(`INSERT INTO audit_log(user_id, action, entity, entity_id, details) VALUES ($1,'oportunidade_atualizada_importacao','opportunity',$2,$3)`,
            [user.id, cur.id, { import_id: importId, changes: ch }]);
          res.opportunitiesUpdated++;
        } else res.rowsSkipped++;
        await c.query('UPDATE import_rows SET result_contact_id=$2, result_opportunity_id=$3 WHERE id=$1', [r.id, contactId, r.dup_opportunity_id]);
        continue;
      }

      const opp = await c.query(`INSERT INTO opportunities(contact_id, product_id, import_id, source_sheet, source_row, title, created_date, won_date, lost_date,
          lost_reason, value, original_owner, unit, notes, status_column, historical_status, review_reasons, ref_year, year_source, year_inferred, raw, is_demo, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING id`,
        [contactId, m.product_id, importId, r.sheet_name, r.row_number, m.title, m.created_date, m.won_date, m.lost_date,
          m.lost_reason, m.value, m.owner, m.unit, m.notes, m.status_column, m.historical_status, JSON.stringify(m.review_reasons || []),
          m.ref_year, m.year_source, !!m.year_source && m.year_source !== 'criacao', { ...r.raw, __extra: m.extra }, isDemo, user.id]);
      res.opportunitiesCreated++;
      await c.query('UPDATE import_rows SET result_contact_id=$2, result_opportunity_id=$3 WHERE id=$1', [r.id, contactId, opp.rows[0].id]);
    }
    const stats = { ...imp.stats, commit: res };
    await c.query(`UPDATE imports SET status='concluida', committed_at=now(), committed_by=$2, stats=$3 WHERE id=$1`, [importId, user.id, stats]);
    await c.query(`INSERT INTO audit_log(user_id, action, entity, entity_id, details) VALUES ($1,'importacao_concluida','import',$2,$3)`, [user.id, importId, res]);
    return res;
  });
}
