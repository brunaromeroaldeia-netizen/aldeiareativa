// Renderização de mensagens com variáveis {{variavel}} ou {{variavel|texto alternativo}}

export const VARIABLES = [
  { key: 'primeiro_nome', label: 'Primeiro nome', fallback: null },
  { key: 'nome_completo', label: 'Nome completo', fallback: null },
  { key: 'empresa', label: 'Empresa', fallback: 'sua empresa' },
  { key: 'produto', label: 'Produto', fallback: 'nossos espaços' },
  { key: 'unidade', label: 'Unidade', fallback: 'Aldeia' },
  { key: 'vendedora', label: 'Nome de quem envia', fallback: 'equipe Aldeia' },
  { key: 'campanha', label: 'Campanha', fallback: '' },
  { key: 'ano', label: 'Ano da base', fallback: '' },
];
const KNOWN = new Map(VARIABLES.map((v) => [v.key, v]));

/**
 * Substitui variáveis. Quando um dado falta:
 *  - usa o texto alternativo informado ({{empresa|sua empresa}}) ou o padrão da variável;
 *  - para nomes sem valor, remove a variável junto com a vírgula/espaço anterior ("Oi, {{primeiro_nome}}!" -> "Oi!").
 * Nunca devolve variáveis sem preencher.
 */
export function renderTemplate(body, data) {
  const warnings = [];
  let text = String(body ?? '').replace(/\r\n/g, '\n');
  text = text.replace(/([ \t]*,?[ \t]*)\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/gi, (match, prefix, rawKey, alt) => {
    const key = rawKey.toLowerCase();
    const value = data[key];
    if (value !== null && value !== undefined && String(value).trim() !== '') return prefix + String(value).trim();
    const def = KNOWN.get(key);
    if (!def) {
      warnings.push(`Variável desconhecida removida: {{${rawKey}}}`);
      return '';
    }
    const fb = alt !== undefined ? alt.trim() : def.fallback;
    if (fb) {
      warnings.push(`${def.label} não informado(a) — usado texto alternativo "${fb}".`);
      return prefix + fb;
    }
    warnings.push(`${def.label} não informado(a) — trecho ajustado automaticamente.`);
    return '';
  });
  text = text.replace(/[ \t]+([!?.,])/g, '$1').replace(/[ \t]{2,}/g, ' ');
  return { text, warnings: [...new Set(warnings)] };
}

export function templateData({ contact, opportunity, product, campaign, seller, unit }) {
  return {
    primeiro_nome: contact?.first_name,
    nome_completo: contact?.full_name,
    empresa: contact?.company,
    produto: product?.name,
    unidade: opportunity?.unit || unit,
    vendedora: seller?.name ? seller.name.split(' ')[0] : null,
    campanha: campaign?.name,
    ano: opportunity?.ref_year,
  };
}

/** Escolhe o modelo mais específico para a etapa do contato. */
export function pickTemplate(templates, { step, product_id, ref_year, historical_status }) {
  const matches = (t) =>
    t.active &&
    (t.product_id == null || t.product_id === product_id) &&
    (t.ref_year == null || t.ref_year === ref_year) &&
    (t.historical_status == null || t.historical_status === historical_status);
  const score = (t) => (t.product_id != null) + (t.ref_year != null) + (t.historical_status != null);
  const eligible = templates.filter(matches);
  const byKind = step <= 1
    ? eligible.filter((t) => t.kind === 'inicial')
    : eligible.filter((t) => t.kind === 'followup' && t.step <= step);
  if (!byKind.length) return null;
  byKind.sort((a, b) => (b.step - a.step) * 10 + (score(b) - score(a)) || b.id - a.id);
  // prioriza a etapa exata; dentro dela, o segmento mais específico
  const best = byKind[0].step;
  return byKind.filter((t) => t.step === best).sort((a, b) => score(b) - score(a) || b.id - a.id)[0];
}
