import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, normalizeEmail, titleCaseName, firstNameOf, parseMoney } from '../server/lib/normalize.js';
import { parseDate, addDays } from '../server/lib/dates.js';
import { renderTemplate, pickTemplate } from '../server/lib/template.js';
import { mapRow, autoMap, matchProduct } from '../server/services/importer.js';
import { distribute } from '../server/services/campaigns.js';

test('telefone BR é normalizado para DDD + número', () => {
  assert.equal(normalizePhone('(41) 99999-0000'), '41999990000');
  assert.equal(normalizePhone('+55 41 9 9999-0000'), '41999990000');
  assert.equal(normalizePhone('041 99999-0000'), '41999990000');
  assert.equal(normalizePhone('41 9999-0000'), '41999990000'); // celular antigo sem o 9
  assert.equal(normalizePhone('41 3333-0000'), '4133330000'); // fixo
  assert.equal(normalizePhone('123'), null);
  assert.equal(normalizePhone('41 99999-0000 / 41 98888-0000'), '41999990000');
});

test('e-mail, nomes e valores', () => {
  assert.equal(normalizeEmail(' Maria@Teste.COM '), 'maria@teste.com');
  assert.equal(normalizeEmail('sem email'), null);
  assert.equal(titleCaseName('MARIANA DA SILVA'), 'Mariana da Silva');
  assert.equal(titleCaseName('João McDonald'), 'João McDonald');
  assert.equal(firstNameOf('mariana ferreira'), 'Mariana');
  assert.equal(parseMoney('R$ 1.234,56'), 1234.56);
  assert.equal(parseMoney(750), 750);
});

test('datas de planilha', () => {
  assert.equal(parseDate('10/03/2024').date, '2024-03-10');
  assert.equal(parseDate('2024-03-10 14:00').date, '2024-03-10');
  assert.equal(parseDate(45361).date, '2024-03-10'); // serial do Excel
  assert.equal(parseDate('31/02/2024').date, null);
  assert.ok(parseDate('ontem').error);
  assert.equal(addDays('2026-11-30', 3), '2026-12-03');
});

test('mensagem personalizada substitui variáveis e nunca deixa {{ }}', () => {
  const body = 'Oi, {{primeiro_nome}}! Tudo bem? 😊\n\nVi que a {{empresa}} tinha interesse.\n{{desconhecida}}Abraço, {{vendedora}}';
  const r = renderTemplate(body, { primeiro_nome: 'Mariana', empresa: 'Ferreira Design', vendedora: 'Letícia' });
  assert.equal(r.text, 'Oi, Mariana! Tudo bem? 😊\n\nVi que a Ferreira Design tinha interesse.\nAbraço, Letícia');
  const r2 = renderTemplate('Oi, {{primeiro_nome}}! Para {{empresa|sua equipe}}.', {});
  assert.equal(r2.text, 'Oi! Para sua equipe.');
  assert.ok(r2.warnings.length >= 2);
  assert.ok(!/\{\{/.test(r.text + r2.text));
});

test('modelo mais específico do segmento é escolhido', () => {
  const t = [
    { id: 1, active: true, kind: 'inicial', step: 1, product_id: null, ref_year: null, historical_status: null },
    { id: 2, active: true, kind: 'inicial', step: 1, product_id: 1, ref_year: 2024, historical_status: 'perdido' },
    { id: 3, active: true, kind: 'followup', step: 2, product_id: null, ref_year: null, historical_status: null },
  ];
  assert.equal(pickTemplate(t, { step: 1, product_id: 1, ref_year: 2024, historical_status: 'perdido' }).id, 2);
  assert.equal(pickTemplate(t, { step: 1, product_id: 1, ref_year: 2025, historical_status: 'perdido' }).id, 1);
  assert.equal(pickTemplate(t, { step: 3, product_id: 1, ref_year: 2024, historical_status: 'perdido' }).id, 3);
});

const products = [{ id: 1, name: 'Mesa / Plano Full', aliases: ['mesa', 'plano full'] }, { id: 3, name: 'Endereço Fiscal', aliases: ['fiscal'] }];
const sheet = (headers, extra = {}) => ({ headers, mapping: autoMap(headers), product_value_map: {}, ...extra });

test('classificação histórica pelas datas', () => {
  const s = sheet(['Nome', 'Telefone', 'Produto', 'Data de criação', 'Data do ganho', 'Data da perda']);
  const row = (won, lost, created = '01/02/2024') => mapRow(['Ana Lima', '41999990000', 'Mesa', created, won, lost], s, products);
  assert.equal(row('05/02/2024', null).historical_status, 'ganho');
  assert.equal(row(null, '05/02/2024').historical_status, 'perdido');
  assert.equal(row(null, null).historical_status, 'aberto');
  assert.equal(row('05/02/2024', '06/02/2024').historical_status, 'revisao');
  const inferred = row(null, '05/03/2025', null);
  assert.equal(inferred.ref_year, 2025);
  assert.equal(inferred.year_source, 'perda');
});

test('coluna de status contraditória vai para revisão; ano do lote é usado sem datas', () => {
  const s = sheet(['Nome', 'Celular', 'Data do ganho', 'Status'], { default_year: 2024, default_product_id: 1 });
  const m = mapRow(['Ana', '41999990000', '01/03/2024', 'Perdido'], s, products);
  assert.equal(m.historical_status, 'revisao');
  const m2 = mapRow(['Ana', '41999990000', null, null], s, products);
  assert.equal(m2.ref_year, 2024);
  assert.equal(m2.year_source, 'lote');
  assert.equal(m2.product_id, 1);
});

test('reconhecimento de colunas do Pipedrive e produtos', () => {
  const m = autoMap(['Pessoa de contato', 'Organização', 'Pessoa - Telefone', 'Negócio - Data de perda', 'Negócio - Motivo da perda']);
  assert.deepEqual(m, { full_name: 0, company: 1, phone: 2, lost_date: 3, lost_reason: 4 });
  assert.equal(matchProduct('Mesas 2025', products), 1);
  assert.equal(matchProduct('endereco fiscal', products), 3);
  assert.equal(matchProduct('xyz', products), null);
});

test('distribuição 50/50 e proporcional', () => {
  const parts = Array.from({ length: 601 }, (_, i) => ({ id: i + 1, segment: i % 3 }));
  const r = distribute(parts, { 10: 1, 20: 1 });
  const c = (u) => r.filter((x) => x.user_id === u).length;
  assert.equal(c(10) + c(20), 601);
  assert.ok(Math.abs(c(10) - c(20)) <= 1);
  const p = distribute(parts.slice(0, 100), { 10: 70, 20: 30 });
  assert.equal(p.filter((x) => x.user_id === 10).length, 70);
});

test('primeiro nome nunca vem do nome da empresa', () => {
  const s = { headers: ['Nome', 'Empresa', 'Telefone'], mapping: autoMap(['Nome', 'Empresa', 'Telefone']) };
  assert.equal(mapRow([null, 'Ferreira Design', '41999990000'], s, []).first_name, null);
  assert.equal(mapRow(['MARIANA FERREIRA', 'Ferreira Design', '41999990000'], s, []).first_name, 'Mariana');
});
