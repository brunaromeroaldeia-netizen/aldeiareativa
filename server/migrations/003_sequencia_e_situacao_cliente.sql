-- Situação atual do cliente, janelas de follow-up por etapa e registro de atualizações de dados.
-- Idempotente: pode rodar mais de uma vez com segurança.

-- situação atual do contato como cliente da Aldeia (NULL = não confirmada)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS client_status TEXT CHECK (client_status IN ('ativo','inativo'));
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS client_status_at TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS client_status_by INT REFERENCES users(id);

-- modelo que só vale para ex-clientes confirmados (não ativos)
ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS client_status TEXT CHECK (client_status IN ('inativo'));

-- follow-up com janela: disponível a partir de due_date, atrasado depois de due_until
ALTER TABLE followups ADD COLUMN IF NOT EXISTS due_until DATE;

-- regras de sequência por campanha: {"steps":[{"step":2,"min":3,"max":3},...],"close_after_days":3}
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS followup_schedule JSONB NOT NULL DEFAULT '{}';

-- atualizações de dados já aplicadas (pacotes de campanha etc.)
CREATE TABLE IF NOT EXISTS data_updates (
  name       TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  details    JSONB NOT NULL DEFAULT '{}'
);

-- {{primeiro_nome}} nunca deve vir da empresa, do telefone ou do e-mail
UPDATE contacts SET first_name = NULL
 WHERE first_name IS NOT NULL
   AND (full_name = company OR full_name = phone OR full_name = email OR full_name = '(sem nome)');
