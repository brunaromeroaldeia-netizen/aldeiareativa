import { many, one } from '../db.js';
import { getSettings } from '../routes/settings.js';

/**
 * Monta a consulta de elegibilidade de uma campanha.
 * Para cada contato escolhe a oportunidade mais recente que atende aos filtros (segmento = produto × ano × status histórico).
 */
export async function eligibilitySql(campaign, { extraWhere = '' } = {}) {
  const settings = await getSettings();
  const f = campaign.filters || {};
  const recentDays = Number(f.exclude_recent_days ?? settings.janela_abordagem_recente_dias ?? 30);
  const params = [
    campaign.product_ids || [], campaign.years || [], campaign.historical_statuses || [],
    f.lost_reasons || [], campaign.id || 0, recentDays,
  ];
  const previous = f.previous || 'todos';
  const sql = `
    WITH opp AS (
      SELECT DISTINCT ON (o.contact_id) o.id AS opportunity_id, o.contact_id, o.product_id, o.ref_year, o.historical_status
        FROM opportunities o JOIN contacts ct ON ct.id = o.contact_id
       WHERE ct.anonymized_at IS NULL
         AND (cardinality($1::int[]) = 0 OR o.product_id = ANY($1::int[]))
         AND (cardinality($2::int[]) = 0 OR o.ref_year = ANY($2::int[]))
         AND (cardinality($3::text[]) = 0 OR o.historical_status = ANY($3::text[]))
         AND (cardinality($4::text[]) = 0 OR COALESCE(o.lost_reason,'(sem motivo)') = ANY($4::text[]))
       ORDER BY o.contact_id, o.ref_year DESC NULLS LAST, o.id DESC
    ), flags AS (
      SELECT opp.*, ct.do_not_contact AS dnc, (ct.client_status = 'ativo') IS TRUE AS active_client,
        EXISTS (SELECT 1 FROM campaign_contacts x WHERE x.campaign_id = $5 AND x.contact_id = opp.contact_id) AS already,
        EXISTS (SELECT 1 FROM campaign_contacts x JOIN campaigns c2 ON c2.id = x.campaign_id
                 WHERE x.contact_id = opp.contact_id AND x.campaign_id <> $5 AND c2.status IN ('ativa','pausada')
                   AND x.status NOT IN ('convertido','sem_interesse','sem_resposta','opt_out')) AS in_active,
        EXISTS (SELECT 1 FROM interactions i WHERE i.contact_id = opp.contact_id AND i.type = 'envio'
                 AND i.created_at > now() - make_interval(days => $6::int) AND COALESCE(i.campaign_id,0) <> $5) AS recent,
        EXISTS (SELECT 1 FROM campaign_contacts x WHERE x.contact_id = opp.contact_id AND x.campaign_id <> $5) AS approached_before,
        EXISTS (SELECT 1 FROM campaign_contacts x WHERE x.contact_id = opp.contact_id AND x.converted_at IS NOT NULL) AS converted_before
      FROM opp JOIN contacts ct ON ct.id = opp.contact_id
    )
    SELECT * FROM flags
     WHERE TRUE
       ${previous === 'nunca_abordados' ? 'AND NOT approached_before' : ''}
       ${previous === 'ja_abordados' ? 'AND approached_before' : ''}
       ${f.exclude_converted ? 'AND NOT converted_before' : ''}
       ${f.exclude_active_clients !== false ? 'AND NOT active_client' : ''}
       ${extraWhere}`;
  return { sql, params, recentDays, excludeActive: f.exclude_active_campaigns !== false };
}

export async function eligibilityPreview(campaign) {
  const { sql, params, recentDays, excludeActive } = await eligibilitySql(campaign);
  const rows = await many(`
    SELECT e.product_id, p.name AS product_name, e.ref_year, e.historical_status,
      count(*)::int AS matching,
      count(*) FILTER (WHERE e.dnc)::int AS excluded_dnc,
      count(*) FILTER (WHERE NOT e.dnc AND e.already)::int AS already,
      count(*) FILTER (WHERE NOT e.dnc AND NOT e.already AND e.in_active)::int AS in_active,
      count(*) FILTER (WHERE NOT e.dnc AND NOT e.already AND e.recent)::int AS recent,
      count(*) FILTER (WHERE NOT e.dnc AND NOT e.already ${excludeActive ? 'AND NOT e.in_active' : ''} AND NOT e.recent)::int AS eligible
    FROM (${sql}) e LEFT JOIN products p ON p.id = e.product_id
    GROUP BY 1,2,3,4 ORDER BY p.name NULLS LAST, e.ref_year DESC NULLS LAST, e.historical_status`, params);
  const total = rows.reduce((a, r) => {
    for (const k of ['matching', 'excluded_dnc', 'already', 'in_active', 'recent', 'eligible']) a[k] = (a[k] || 0) + r[k];
    return a;
  }, {});
  return { segments: rows, total, recentDays, excludeActive };
}

/** Distribui participantes entre vendedoras conforme pesos, equilibrando os segmentos. */
export function distribute(participants, weights) {
  const users = Object.keys(weights).map(Number).filter((u) => weights[u] > 0);
  if (!users.length) return [];
  const sum = users.reduce((a, u) => a + weights[u], 0);
  const n = participants.length;
  const quota = {};
  let assigned = 0;
  users.forEach((u) => { quota[u] = Math.floor((n * weights[u]) / sum); assigned += quota[u]; });
  // sobras para quem tem maior fração
  const rest = users.map((u) => ({ u, frac: (n * weights[u]) / sum - quota[u] })).sort((a, b) => b.frac - a.frac);
  for (let i = 0; assigned < n; i++, assigned++) quota[rest[i % rest.length].u]++;
  const given = Object.fromEntries(users.map((u) => [u, 0]));
  const sorted = [...participants].sort((a, b) =>
    String(a.segment).localeCompare(String(b.segment)) || a.id - b.id);
  return sorted.map((p) => {
    const u = users.filter((x) => given[x] < quota[x])
      .sort((a, b) => given[a] / quota[a] - given[b] / quota[b] || a - b)[0];
    given[u]++;
    return { id: p.id, user_id: u };
  });
}

export async function campaignSummary(campaignId) {
  return one(`SELECT count(*)::int AS participants,
      count(*) FILTER (WHERE assigned_to IS NOT NULL)::int AS assigned,
      count(*) FILTER (WHERE assigned_to IS NULL)::int AS unassigned,
      count(*) FILTER (WHERE status <> 'pendente')::int AS worked,
      count(*) FILTER (WHERE status = 'pendente')::int AS pending,
      count(first_sent_at)::int AS sent,
      count(responded_at)::int AS responded,
      count(interested_at)::int AS interested,
      count(converted_at)::int AS converted,
      COALESCE(sum(conversion_value) FILTER (WHERE converted_at IS NOT NULL),0) AS revenue
    FROM campaign_contacts WHERE campaign_id=$1`, [campaignId]);
}
