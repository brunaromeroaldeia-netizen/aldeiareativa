-- Atualização de oportunidades já importadas (ex.: lead que estava aberto e foi perdido no CRM).
-- Idempotente: pode rodar mais de uma vez com segurança.
ALTER TABLE import_rows ADD COLUMN IF NOT EXISTS opp_changes JSONB NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS opportunity_history (
  id             SERIAL PRIMARY KEY,
  opportunity_id INT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  import_id      INT REFERENCES imports(id) ON DELETE SET NULL,
  user_id        INT REFERENCES users(id),
  changes        JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS opportunity_history_opp ON opportunity_history(opportunity_id);
