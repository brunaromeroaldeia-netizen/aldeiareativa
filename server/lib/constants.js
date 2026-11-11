export const PARTICIPANT_STATUSES = [
  'pendente', 'enviada', 'aguardando', 'followup_pendente', 'respondeu', 'interesse',
  'retorno_futuro', 'negociacao', 'convertido', 'sem_interesse', 'sem_resposta', 'opt_out',
];
// Situações em que a abordagem da campanha terminou
export const FINAL_STATUSES = ['convertido', 'sem_interesse', 'sem_resposta', 'opt_out'];
// Situações que indicam que o cliente respondeu
export const RESPONDED_STATUSES = ['respondeu', 'interesse', 'retorno_futuro', 'negociacao', 'convertido', 'sem_interesse', 'opt_out'];
// Situações que aguardam envio/resposta (follow-up automático pode ocorrer)
export const AWAITING_STATUSES = ['enviada', 'aguardando', 'followup_pendente'];
export const HIST_STATUSES = ['ganho', 'perdido', 'aberto', 'revisao'];
