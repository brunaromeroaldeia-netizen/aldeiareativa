// Regras de sequência de abordagem de uma campanha (intervalos entre etapas, janela e prazo final).
import { addDays } from '../lib/dates.js';
import { stageShort } from '../lib/template.js';

const fmt = (d) => (d ? d.split('-').reverse().join('/') : '');

/** Intervalo (em dias corridos) até a etapa `step`, contado do envio anterior. */
export function stepRule(campaign, step) {
  const s = campaign.followup_schedule?.steps?.find((x) => Number(x.step) === step);
  if (s) return { min: Number(s.min), max: Math.max(Number(s.min), Number(s.max ?? s.min)) };
  return { min: campaign.followup_days, max: campaign.followup_days };
}

export function closeAfterDays(campaign) {
  return Number(campaign.followup_schedule?.close_after_days ?? campaign.followup_days);
}

/**
 * O que acontece depois de um envio confirmado (attempts = total de envios já feitos, incluindo este):
 *  - ainda há etapas: agenda o próximo follow-up com janela [min, max], nunca depois do fim da campanha;
 *  - se a próxima etapa cairia depois do fim da campanha: não agenda nem antecipa; encerra no fim da campanha;
 *  - última etapa: não gera novos follow-ups; encerra como "sem resposta" após o prazo configurado.
 */
export function planAfterSend(campaign, attempts, today) {
  const end = campaign.end_date || null;
  if (attempts < campaign.max_attempts) {
    const step = attempts + 1;
    const r = stepRule(campaign, step);
    const due = addDays(today, r.min);
    let until = addDays(today, r.max);
    if (end && due > end) {
      return {
        followup: null,
        deadline: end,
        note: `O ${stageShort(step)} ficaria para ${fmt(due)}, depois do fim da campanha (${fmt(end)}). Nenhum follow-up será agendado nem antecipado; sem resposta até ${fmt(end)}, o contato é encerrado nesta campanha.`,
      };
    }
    if (end && until > end) until = end;
    return { followup: { step, due, until }, deadline: null };
  }
  let deadline = addDays(today, closeAfterDays(campaign));
  if (end && deadline > end) deadline = end;
  return { followup: null, deadline, note: `Última abordagem (${attempts}ª) enviada. Sem resposta até ${fmt(deadline)}, o contato é encerrado como "sem resposta". Nenhum novo follow-up será gerado.` };
}

export const windowText = (f) => (f.due_until && f.due_until !== f.due_date ? `entre ${fmt(f.due_date)} e ${fmt(f.due_until)}` : `em ${fmt(f.due_date)}`);
