import { tx } from '../db.js';
import { today } from '../lib/dates.js';

/**
 * Rotina de agendamento persistente. Todas as datas ficam no banco, então
 * a rotina apenas materializa o que já venceu — pode rodar a qualquer momento,
 * quantas vezes for preciso, com o mesmo resultado (idempotente).
 */
export async function runScheduler() {
  const t = today();
  return tx(async (c) => {
    // 1) follow-ups vencidos: contato passa para "Follow-up pendente"
    const due = await c.query(`UPDATE campaign_contacts cc SET status='followup_pendente', updated_at=now()
      FROM campaigns cp
      WHERE cp.id = cc.campaign_id AND cp.status='ativa' AND cc.status IN ('enviada','aguardando')
        AND EXISTS (SELECT 1 FROM followups f WHERE f.campaign_contact_id=cc.id AND f.status='pendente' AND f.type='followup' AND f.due_date <= $1)
      RETURNING cc.id, cc.campaign_id, cc.contact_id, cc.is_demo, cc.attempts`, [t]);
    for (const p of due.rows) {
      await c.query(`INSERT INTO interactions(campaign_contact_id, campaign_id, contact_id, type, from_status, to_status, note, is_demo)
        VALUES ($1,$2,$3,'sistema','aguardando','followup_pendente',$4,$5)`, [p.id, p.campaign_id, p.contact_id, `Follow-up (${p.attempts + 1}ª abordagem) disponível na fila`, p.is_demo]);
    }
    // 2) limite de tentativas atingido e prazo encerrado sem resposta
    const closed = await c.query(`UPDATE campaign_contacts cc SET status='sem_resposta', closed_at=now(), no_response_deadline=NULL, updated_at=now()
      FROM campaigns cp
      WHERE cp.id = cc.campaign_id AND cp.status='ativa' AND cc.status IN ('enviada','aguardando','followup_pendente')
        AND cc.no_response_deadline IS NOT NULL AND cc.no_response_deadline < $1
        AND NOT EXISTS (SELECT 1 FROM followups f WHERE f.campaign_contact_id=cc.id AND f.status='pendente')
      RETURNING cc.id, cc.campaign_id, cc.contact_id, cc.is_demo, cc.attempts`, [t]);
    for (const p of closed.rows) {
      await c.query(`INSERT INTO interactions(campaign_contact_id, campaign_id, contact_id, type, to_status, note, is_demo)
        VALUES ($1,$2,$3,'sistema','sem_resposta',$4,$5)`, [p.id, p.campaign_id, p.contact_id, `Encerrado como "sem resposta" após ${p.attempts} tentativa(s)`, p.is_demo]);
    }
    // 3) limpeza de sessões expiradas
    await c.query(`DELETE FROM sessions WHERE expires_at < now()`);
    return { followupsDue: due.rowCount, closedNoResponse: closed.rowCount };
  });
}

export function startScheduler(intervalMinutes = 10) {
  const run = () => runScheduler()
    .then((r) => { if (r.followupsDue || r.closedNoResponse) console.log(`[agenda] ${r.followupsDue} follow-up(s) liberados, ${r.closedNoResponse} encerrados sem resposta`); })
    .catch((e) => console.error('[agenda] erro', e.message));
  run();
  return setInterval(run, intervalMinutes * 60 * 1000);
}
