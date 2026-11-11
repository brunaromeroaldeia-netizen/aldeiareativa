import { many, one, tx } from '../db.js';
import { today, addDays } from '../lib/dates.js';
import { formatPhone, firstNameOf } from '../lib/normalize.js';
import { applyBlackFridayPackage, applyDemoExClients } from './blackFriday.js';

// Gerador determinístico (os mesmos dados a cada carga)
function rng(seed = 42) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

const FIRST = ['Mariana', 'Carlos', 'Fernanda', 'Rafael', 'Juliana', 'Bruno', 'Camila', 'Lucas', 'Patrícia', 'Diego', 'Aline', 'Thiago', 'Renata',
  'Gustavo', 'Beatriz', 'Felipe', 'Larissa', 'André', 'Vanessa', 'Rodrigo', 'Tatiane', 'Marcelo', 'Gabriela', 'Leonardo', 'Isabela', 'Eduardo',
  'Natália', 'Ricardo', 'Priscila', 'Vinícius', 'Letícia', 'Henrique', 'Sabrina', 'Paulo', 'Débora', 'Fábio', 'Carolina', 'Daniel', 'Helena', 'Otávio'];
const LAST = ['Ferreira', 'Souza', 'Oliveira', 'Lima', 'Costa', 'Pereira', 'Almeida', 'Ribeiro', 'Carvalho', 'Gomes', 'Martins', 'Rocha', 'Barbosa',
  'Teixeira', 'Moura', 'Cardoso', 'Nunes', 'Mendes', 'Vieira', 'Pinto', 'Araújo', 'Castro', 'Freitas', 'Monteiro'];
const COMPANIES = ['Studio Aurora', 'Nexo Consultoria', 'Ponto Digital', 'Verde Arquitetura', 'Lumen Tech', 'Casa Criativa', 'Atlas Contábil',
  'Rede Saúde Integrada', 'Trilha Educação', 'Mosaico Design', 'Brisa Marketing', 'Prisma Engenharia', 'Vértice Advocacia', 'Raiz Alimentos', null, null, null];
const LOST_REASONS = ['Preço', 'Escolheu outro espaço', 'Mudança de planos', 'Sem resposta', 'Localização', 'Adiou a decisão', 'Fechou empresa'];
const OWNERS = ['Equipe comercial', 'Atendimento', 'Recepção'];

export async function loadDemo(userId) {
  const existing = await one('SELECT count(*)::int AS n FROM contacts WHERE is_demo');
  if (existing.n) throw new Error('Os dados de demonstração já estão carregados.');
  const products = await many('SELECT id, name FROM products ORDER BY sort_order');
  const P = (name) => products.find((p) => p.name.startsWith(name))?.id;
  const sellers = await many(`SELECT id, name FROM users WHERE role='vendedora' AND active ORDER BY name`);
  const rand = rng(2026);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const t = today();

  return tx(async (c) => {
    const imp = (await c.query(`INSERT INTO imports(filename, status, update_rule, is_demo, created_by, committed_at, committed_by, stats)
      VALUES ('[DEMO] base-exemplo.xlsx','concluida','preencher_vazios',TRUE,$1,now(),$1,'{}') RETURNING id`, [userId])).rows[0];

    // ---------------- contatos e oportunidades ----------------
    const plan = [
      ['Mesa', 2024, 70], ['Mesa', 2025, 55], ['Mesa', 2026, 30], ['Escritório', 2024, 18], ['Escritório', 2025, 16],
      ['Endereço', 2024, 20], ['Endereço', 2025, 22], ['Endereço', 2026, 12], ['Salas', 2025, 14], ['Salas', 2026, 10], ['Eventos', 2025, 12],
    ];
    const contacts = [];
    let seq = 0;
    for (const [prod, year, n] of plan) {
      for (let i = 0; i < n; i++) {
        // ~8% reutilizam um contato já criado (mesma pessoa em outro produto/ano)
        let contact = contacts.length > 20 && rand() < 0.08 ? pick(contacts) : null;
        if (!contact) {
          seq++;
          const name = `${pick(FIRST)} ${pick(LAST)}${rand() < 0.3 ? ` ${pick(LAST)}` : ''}`;
          const phoneNorm = `00900${String(seq).padStart(6, '0')}`;
          const company = pick(COMPANIES);
          const email = rand() < 0.75 ? `${name.split(' ')[0].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()}.${seq}@exemplo.com.br` : null;
          const noPhone = rand() < 0.04;
          const row = (await c.query(`INSERT INTO contacts(full_name, first_name, company, phone, phone_norm, email, email_norm, source, is_demo, created_by, notes)
            VALUES ($1,$2,$3,$4,$5,$6,$6,'demo',TRUE,$7,'[DEMO] Contato fictício para testes') RETURNING id`,
          [name, firstNameOf(name), company, noPhone ? null : formatPhone(phoneNorm), noPhone ? null : phoneNorm, email, userId])).rows[0];
          contact = { id: row.id };
          contacts.push(contact);
        }
        const month = 1 + Math.floor(rand() * (year === 2026 ? 9 : 12));
        const created = `${year}-${String(month).padStart(2, '0')}-${String(1 + Math.floor(rand() * 27)).padStart(2, '0')}`;
        const roll = rand();
        let hist = roll < 0.3 ? 'ganho' : roll < 0.75 ? 'perdido' : roll < 0.97 ? 'aberto' : 'revisao';
        const close = addDays(created, 5 + Math.floor(rand() * 40));
        const won = hist === 'ganho' || hist === 'revisao' ? close : null;
        const lost = hist === 'perdido' || hist === 'revisao' ? addDays(close, hist === 'revisao' ? 10 : 0) : null;
        const noCreated = rand() < 0.05; // alguns sem data de criação: ano inferido
        const ys = noCreated ? (won ? 'ganho' : lost ? 'perda' : 'lote') : 'criacao';
        await c.query(`INSERT INTO opportunities(contact_id, product_id, import_id, source_sheet, source_row, created_date, won_date, lost_date, lost_reason, value,
            original_owner, historical_status, review_reasons, ref_year, year_source, year_inferred, is_demo, created_by, raw)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,TRUE,$17,'{}')`,
        [contact.id, P(prod), imp.id, `Base ${year}`, i + 2, noCreated ? null : created, won, lost, hist === 'perdido' ? pick(LOST_REASONS) : null,
          Math.round((300 + rand() * 2200) / 10) * 10, pick(OWNERS), hist,
          JSON.stringify(hist === 'revisao' ? ['Data do ganho e data da perda preenchidas'] : []),
          noCreated && ys !== 'lote' ? Number((won || lost).slice(0, 4)) : year, ys, noCreated, userId]);
      }
    }

    // ---------------- campanhas ----------------
    const mkCampaign = async (d) => (await c.query(`INSERT INTO campaigns(name, description, promo_description, status, start_date, end_date, product_ids, years,
        historical_statuses, filters, goal_contacts, goal_conversions, followup_days, max_attempts, is_demo, created_by, activated_at, closed_at, closed_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,TRUE,$15,$16,$17,$18) RETURNING *`,
    [d.name, d.description, d.promo, d.status, d.start, d.end, d.products, d.years, d.hist, d.filters || {}, d.goalContacts, d.goalConv, 3, 3, userId,
      d.status !== 'rascunho' ? d.start : null, d.status === 'encerrada' ? d.end : null, d.status === 'encerrada' ? userId : null])).rows[0];
    const mkTpl = async (campaignId, name, kind, step, body, seg = {}) => {
      const tp = (await c.query(`INSERT INTO message_templates(campaign_id, name, kind, step, product_id, ref_year, historical_status, body, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [campaignId, name, kind, step, seg.product_id ?? null, seg.ref_year ?? null, seg.hist ?? null, body, userId])).rows[0];
      await c.query('INSERT INTO message_template_versions(template_id, version, body, created_by) VALUES ($1,1,$2,$3)', [tp.id, body, userId]);
      return tp.id;
    };

    const bf = await mkCampaign({ name: '[DEMO] Black Friday Mesas 2026', status: 'ativa', start: '2026-11-01', end: '2026-11-30',
      description: 'Reativação de leads perdidos e em aberto de Mesa / Plano Full (bases 2024 e 2025).',
      promo: 'Quem fechar contrato de mesa em novembro começa a usar imediatamente; a primeira mensalidade fica para janeiro de 2027.',
      products: [P('Mesa')], years: [2024, 2025], hist: ['perdido', 'aberto'], goalContacts: 120, goalConv: 12 });
    await mkTpl(bf.id, 'Abertura — Mesa (geral)', 'inicial', 1,
      'Oi, {{primeiro_nome}}! Tudo bem? 😊\n\nAqui é a {{vendedora}}, da {{unidade}}. Estamos com uma condição especial de Black Friday para {{produto}}: quem fechar em novembro já começa a usar o espaço e a primeira mensalidade fica só para janeiro de 2027!\n\nPosso te contar os detalhes?',
      { product_id: P('Mesa') });
    await mkTpl(bf.id, 'Abertura — Perdidos 2024', 'inicial', 1,
      'Oi, {{primeiro_nome}}! Tudo bem? 😊\n\nPassando porque estamos com uma condição especial de Black Friday na {{unidade}} e lembrei do seu interesse em ter um espaço de trabalho com a gente!\n\nQuem fechar contrato de mesa em novembro já pode começar a usar o espaço imediatamente, mas a primeira mensalidade fica só para janeiro de 2027!\n\nFaz sentido retomarmos nossa conversa?',
      { product_id: P('Mesa'), ref_year: 2024, hist: 'perdido' });
    await mkTpl(bf.id, '1º follow-up', 'followup', 2,
      'Oi, {{primeiro_nome}}! Tudo bem? 😊\n\nConseguiu ver a condição especial que te enviei para começar 2027 na Aldeia? Queria saber se faz sentido pra você.');
    await mkTpl(bf.id, '2º follow-up (último)', 'followup', 3,
      'Oi, {{primeiro_nome}}! Última mensagem por aqui, prometo 🙂\n\nA condição de Black Friday vale até 30/11. Se quiser, te mostro o espaço numa visita rápida. É só me responder!');

    const fiscal = await mkCampaign({ name: '[DEMO] Endereço Fiscal — Retomada Agosto 2026', status: 'encerrada', start: '2026-08-01', end: '2026-08-31',
      description: 'Campanha encerrada de exemplo, preservada para consulta histórica.', promo: '3 meses com 20% de desconto no endereço fiscal.',
      products: [P('Endereço')], years: [2024, 2025], hist: ['perdido', 'aberto', 'ganho'], goalContacts: 40, goalConv: 5 });
    await mkTpl(fiscal.id, 'Abertura — Endereço Fiscal', 'inicial', 1,
      'Oi, {{primeiro_nome}}! Aqui é a {{vendedora}}, da {{unidade}} 😊\n\nEste mês estamos com 20% de desconto nos 3 primeiros meses do Endereço Fiscal. Ainda faz sentido para {{empresa|sua empresa}}?');
    await mkTpl(fiscal.id, 'Follow-up', 'followup', 2, 'Oi, {{primeiro_nome}}! Conseguiu ver a condição do Endereço Fiscal? Fico à disposição 🙂');

    const salas = await mkCampaign({ name: '[DEMO] Salas de Reunião — Planejamento 2027', status: 'rascunho', start: '2027-01-10', end: '2027-02-28',
      description: 'Rascunho de campanha planejada.', promo: 'Pacote de horas com preço especial para empresas.',
      products: [P('Salas')], years: [2025, 2026], hist: ['ganho', 'perdido'], goalContacts: 20, goalConv: 4 });
    await mkTpl(salas.id, 'Abertura — Salas', 'inicial', 1, 'Oi, {{primeiro_nome}}! Que tal garantir horas de sala de reunião com condição especial em 2027?');

    if (sellers.length) {
      for (const s of sellers) {
        await c.query('INSERT INTO campaign_sellers VALUES ($1,$2),($3,$2)', [bf.id, s.id, fiscal.id]);
      }
    }

    // participantes (elegíveis: não opt-out)
    const addParticipants = async (camp, limit) => (await c.query(`INSERT INTO campaign_contacts(campaign_id, contact_id, opportunity_id, added_by, is_demo, added_at)
      SELECT $1, x.contact_id, x.id, $2, TRUE, $3::date FROM (
        SELECT DISTINCT ON (o.contact_id) o.* FROM opportunities o WHERE o.is_demo AND o.product_id = ANY($4) AND o.ref_year = ANY($5) AND o.historical_status = ANY($6)
        ORDER BY o.contact_id, o.ref_year DESC) x ORDER BY x.contact_id LIMIT $7 RETURNING *`,
    [camp.id, userId, camp.start_date, camp.product_ids, camp.years, camp.historical_statuses, limit])).rows;
    const bfParts = await addParticipants(bf, 120);
    const fiscalParts = await addParticipants(fiscal, 40);
    await addParticipants(salas, 30);

    // distribuição 50/50 e simulação de atividade
    const simulate = async (camp, parts, { startDate, endDate, closed }) => {
      const tmpl = (await c.query('SELECT id, version, kind, step, body FROM message_templates WHERE campaign_id=$1', [camp.id])).rows;
      const firstTpl = tmpl.find((x) => x.kind === 'inicial');
      const ev = (p, type, at, extra = {}) => c.query(`INSERT INTO interactions(campaign_contact_id, campaign_id, contact_id, user_id, type, attempt, from_status, to_status,
          message_text, template_id, template_version, note, value, is_demo, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,TRUE,$14)`,
      [p.id, camp.id, p.contact_id, extra.user ?? p.assigned_to ?? userId, type, extra.attempt ?? null, extra.from ?? null, extra.to ?? null,
        extra.text ?? null, extra.template ?? null, extra.template ? 1 : null, extra.note ?? null, extra.value ?? null, at]);
      const ts = (d, h) => `${d} ${String(h).padStart(2, '0')}:${String(Math.floor(rand() * 59)).padStart(2, '0')}:00-03`;
      const lastDay = closed ? endDate : t;
      for (const [i, p] of parts.entries()) {
        p.assigned_to = sellers.length ? sellers[i % sellers.length].id : null;
        await c.query('UPDATE campaign_contacts SET assigned_to=$2, assigned_at=$3 WHERE id=$1', [p.id, p.assigned_to, ts(startDate, 8)]);
        const span = Math.max(0, (Date.parse(lastDay) - Date.parse(startDate)) / 86400000);
        if (rand() < (closed ? 0.12 : 0.45)) continue; // ainda pendente
        let day = addDays(startDate, Math.floor(rand() * Math.min(span, closed ? 20 : 10)));
        if (!closed && day > t) day = t;
        const st = { attempts: 0, status: 'pendente', first: null, last: null, responded: null, interested: null, negotiation: null, converted: null, value: null };
        let finished = false;
        while (!finished) {
          st.attempts++;
          const sendAt = ts(day, 9 + Math.floor(rand() * 8));
          const tp = st.attempts === 1 ? firstTpl : tmpl.find((x) => x.kind === 'followup' && x.step === st.attempts) || tmpl.find((x) => x.kind === 'followup');
          await ev(p, 'envio', sendAt, { attempt: st.attempts, from: st.status, to: st.attempts === 1 ? 'enviada' : 'aguardando', template: tp?.id,
            text: (tp?.body || '').replace(/\{\{\s*primeiro_nome\s*\}\}/g, '(nome)'), note: st.attempts > 1 ? `Follow-up realizado (${st.attempts}ª abordagem)` : null });
          st.first ||= sendAt; st.last = sendAt; st.status = st.attempts === 1 ? 'enviada' : 'aguardando';
          const r = rand();
          const respondDay = addDays(day, Math.floor(rand() * 3));
          if (r < 0.32 && respondDay <= lastDay) {
            const rAt = ts(respondDay, 11 + Math.floor(rand() * 6));
            st.responded = rAt;
            const o = rand();
            let to;
            if (o < 0.28) { to = 'convertido'; st.interested = rAt; st.negotiation = rAt; st.converted = ts(addDays(respondDay, 0), 17); st.value = Math.round(600 + rand() * 1400); }
            else if (o < 0.45) { to = 'negociacao'; st.interested = rAt; st.negotiation = rAt; }
            else if (o < 0.62) { to = 'interesse'; st.interested = rAt; }
            else if (o < 0.72) to = 'retorno_futuro';
            else if (o < 0.95) to = 'sem_interesse';
            else to = 'opt_out';
            await ev(p, to === 'convertido' ? 'conversao' : to === 'opt_out' ? 'opt_out' : 'status', to === 'convertido' ? st.converted : rAt,
              { from: st.status, to, value: st.value, note: to === 'convertido' ? 'Fechou contrato (exemplo)' : to === 'sem_interesse' ? 'Disse que no momento não tem interesse' : to === 'interesse' ? 'Pediu mais detalhes sobre valores' : null });
            st.status = to;
            if (to === 'opt_out') await c.query(`UPDATE contacts SET do_not_contact=TRUE, dnc_at=$2, dnc_by=$3, dnc_reason='[DEMO] Pediu para não receber mensagens' WHERE id=$1`, [p.contact_id, rAt, p.assigned_to]);
            if (to === 'retorno_futuro') {
              const ret = addDays(t, 5 + Math.floor(rand() * 20));
              await c.query(`INSERT INTO followups(campaign_contact_id, campaign_id, type, step, due_date, status, created_at) VALUES ($1,$2,'retorno',$3,$4,$5,$6)`,
                [p.id, camp.id, st.attempts + 1, ret, closed ? 'suspenso' : 'pendente', rAt]);
              await c.query('UPDATE campaign_contacts SET return_date=$2 WHERE id=$1', [p.id, ret]);
            }
            finished = true;
          } else {
            const next = addDays(day, camp.followup_days);
            if (st.attempts >= camp.max_attempts) {
              if (next < lastDay) { st.status = 'sem_resposta'; await ev(p, 'sistema', ts(addDays(next, 1), 7), { to: 'sem_resposta', note: `Encerrado como "sem resposta" após ${st.attempts} tentativa(s)` }); }
              else await c.query('UPDATE campaign_contacts SET no_response_deadline=$2 WHERE id=$1', [p.id, next]);
              finished = true;
            } else if (next <= lastDay && rand() < (closed ? 0.9 : 0.6)) {
              await c.query(`INSERT INTO followups(campaign_contact_id, campaign_id, type, step, due_date, status, created_at, completed_at, completed_by) VALUES ($1,$2,'followup',$3,$4,'realizado',$5,$6,$7)`,
                [p.id, camp.id, st.attempts + 1, next, sendAt, ts(next, 10), p.assigned_to]);
              day = next;
            } else {
              await c.query(`INSERT INTO followups(campaign_contact_id, campaign_id, type, step, due_date, status, status_reason, created_at) VALUES ($1,$2,'followup',$3,$4,$5,$6,$7)`,
                [p.id, camp.id, st.attempts + 1, next, closed ? 'suspenso' : 'pendente', closed ? 'Campanha encerrada' : null, sendAt]);
              if (!closed && next <= t) st.status = 'followup_pendente';
              finished = true;
            }
          }
        }
        await c.query(`UPDATE campaign_contacts SET status=$2, attempts=$3, first_sent_at=$4, last_sent_at=$5, responded_at=$6, interested_at=$7, negotiation_at=$8,
            converted_at=$9, conversion_value=$10, conversion_product_id=$11, closed_at=CASE WHEN $2 IN ('convertido','sem_interesse','sem_resposta','opt_out') THEN COALESCE($6::timestamptz, $5::timestamptz) END,
            updated_at=COALESCE($6::timestamptz, $5::timestamptz) WHERE id=$1`,
        [p.id, st.status, st.attempts, st.first, st.last, st.responded, st.interested, st.negotiation, st.converted, st.value, st.converted ? camp.product_ids[0] : null]);
      }
    };
    await simulate(bf, bfParts, { startDate: addDays(t, -12) < '2026-11-01' ? addDays(t, -12) : '2026-11-01', endDate: '2026-11-30', closed: false });
    await simulate(fiscal, fiscalParts, { startDate: '2026-08-01', endDate: '2026-08-31', closed: true });
    // modelos, condições e regras da Black Friday de Mesa + ex-clientes fictícios para testar o modelo de ex-clientes
    await applyBlackFridayPackage(c, bf.id, userId);
    await applyDemoExClients(c, bf.id, userId);
    await c.query(`UPDATE imports SET stats=jsonb_build_object('total', (SELECT count(*) FROM opportunities WHERE import_id=$1),
      'commit', jsonb_build_object('opportunitiesCreated', (SELECT count(*) FROM opportunities WHERE import_id=$1), 'contactsCreated', (SELECT count(DISTINCT contact_id) FROM opportunities WHERE import_id=$1))) WHERE id=$1`, [imp.id]);
    await c.query(`INSERT INTO audit_log(user_id, action, entity, details) VALUES ($1,'demo_carregada','demo',$2)`, [userId, { contacts: contacts.length }]);
    return { contacts: contacts.length, campaigns: 3 };
  });
}

/** Remove tudo que foi marcado como demonstração, preservando dados reais. */
export async function removeDemo(userId) {
  return tx(async (c) => {
    const camps = await c.query('DELETE FROM campaigns WHERE is_demo RETURNING id');
    // participações de contatos fictícios (inclusive se foram incluídos em campanhas reais)
    await c.query(`DELETE FROM campaign_contacts cc WHERE cc.is_demo OR cc.contact_id IN (
      SELECT ct.id FROM contacts ct WHERE ct.is_demo AND NOT EXISTS (SELECT 1 FROM opportunities o WHERE o.contact_id=ct.id AND NOT o.is_demo))`);
    await c.query('DELETE FROM interactions WHERE is_demo');
    await c.query('DELETE FROM opportunities WHERE is_demo');
    const ct = await c.query(`DELETE FROM contacts ct WHERE ct.is_demo
      AND NOT EXISTS (SELECT 1 FROM opportunities o WHERE o.contact_id=ct.id)
      AND NOT EXISTS (SELECT 1 FROM campaign_contacts cc WHERE cc.contact_id=ct.id) RETURNING id`);
    await c.query(`UPDATE contacts SET is_demo=FALSE WHERE is_demo`); // contatos que ganharam dados reais permanecem
    await c.query('DELETE FROM imports WHERE is_demo');
    await c.query(`INSERT INTO audit_log(user_id, action, entity, details) VALUES ($1,'demo_removida','demo',$2)`, [userId, { contacts: ct.rowCount, campaigns: camps.rowCount }]);
    return { contacts: ct.rowCount, campaigns: camps.rowCount };
  });
}
