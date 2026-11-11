-- Aldeia Reativa — esquema inicial
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE users (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  email            TEXT NOT NULL UNIQUE,
  role             TEXT NOT NULL CHECK (role IN ('admin','vendedora')),
  password_hash    TEXT NOT NULL,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  failed_logins    INT NOT NULL DEFAULT 0,
  locked_until     TIMESTAMPTZ,
  last_login_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id           SERIAL PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  ip           TEXT,
  user_agent   TEXT
);
CREATE INDEX ON sessions(user_id);

CREATE TABLE password_resets (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_by  INT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- pedidos de recuperação feitos na tela de login (quando não há e-mail configurado)
CREATE TABLE access_requests (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by INT REFERENCES users(id)
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INT REFERENCES users(id)
);

CREATE TABLE products (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  aliases     TEXT[] NOT NULL DEFAULT '{}',
  color       TEXT NOT NULL DEFAULT '#3f6b55',
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE imports (
  id                SERIAL PRIMARY KEY,
  filename          TEXT NOT NULL,
  stored_path       TEXT,
  file_hash         TEXT,
  file_size         INT,
  status            TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','analisada','concluida','cancelada')),
  update_rule       TEXT NOT NULL DEFAULT 'preencher_vazios' CHECK (update_rule IN ('nao_atualizar','preencher_vazios','sobrescrever')),
  stats             JSONB NOT NULL DEFAULT '{}',
  is_demo           BOOLEAN NOT NULL DEFAULT FALSE,
  created_by        INT REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at      TIMESTAMPTZ,
  committed_by      INT REFERENCES users(id)
);

CREATE TABLE import_sheets (
  id                 SERIAL PRIMARY KEY,
  import_id          INT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  position           INT NOT NULL,
  headers            JSONB NOT NULL,
  rows               JSONB NOT NULL,
  row_numbers        JSONB NOT NULL DEFAULT '[]',
  include            BOOLEAN NOT NULL DEFAULT TRUE,
  mapping            JSONB NOT NULL DEFAULT '{}',
  default_product_id INT REFERENCES products(id),
  default_year       INT,
  product_value_map  JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE contacts (
  id               SERIAL PRIMARY KEY,
  full_name        TEXT NOT NULL,
  first_name       TEXT,
  company          TEXT,
  phone            TEXT,
  phone_norm       TEXT,
  email            TEXT,
  email_norm       TEXT,
  notes            TEXT,
  do_not_contact   BOOLEAN NOT NULL DEFAULT FALSE,
  dnc_at           TIMESTAMPTZ,
  dnc_by           INT REFERENCES users(id),
  dnc_reason       TEXT,
  anonymized_at    TIMESTAMPTZ,
  source           TEXT NOT NULL DEFAULT 'importacao' CHECK (source IN ('importacao','manual','demo')),
  is_demo          BOOLEAN NOT NULL DEFAULT FALSE,
  extra            JSONB NOT NULL DEFAULT '{}',
  created_by       INT REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON contacts(phone_norm);
CREATE INDEX ON contacts(email_norm);
CREATE INDEX contacts_name_trgm ON contacts USING gin (full_name gin_trgm_ops);

CREATE TABLE import_rows (
  id              SERIAL PRIMARY KEY,
  import_id       INT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  sheet_name      TEXT NOT NULL,
  row_number      INT NOT NULL,
  raw             JSONB NOT NULL,
  mapped          JSONB NOT NULL,
  issues          JSONB NOT NULL DEFAULT '[]',
  historical_status TEXT,
  ref_year        INT,
  year_source     TEXT,
  product_id      INT REFERENCES products(id),
  match_type      TEXT NOT NULL,            -- novo | existente | ambiguo | interno
  match_contact_id INT REFERENCES contacts(id) ON DELETE SET NULL,
  candidates      JSONB NOT NULL DEFAULT '[]',
  group_key       TEXT,                     -- agrupa linhas da mesma pessoa no arquivo
  dup_opportunity_id INT,                   -- oportunidade idêntica já existente
  changes         JSONB NOT NULL DEFAULT '[]', -- prévia das atualizações do cadastro
  decision        TEXT NOT NULL DEFAULT 'auto', -- auto | criar | vincular | ignorar
  decision_contact_id INT REFERENCES contacts(id) ON DELETE SET NULL,
  result_contact_id INT,
  result_opportunity_id INT
);
CREATE INDEX ON import_rows(import_id);

CREATE TABLE opportunities (
  id                SERIAL PRIMARY KEY,
  contact_id        INT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  product_id        INT REFERENCES products(id),
  import_id         INT REFERENCES imports(id) ON DELETE SET NULL,
  source_sheet      TEXT,
  source_row        INT,
  title             TEXT,
  created_date      DATE,
  won_date          DATE,
  lost_date         DATE,
  lost_reason       TEXT,
  value             NUMERIC(14,2),
  original_owner    TEXT,
  unit              TEXT,
  notes             TEXT,
  status_column     TEXT,
  historical_status TEXT NOT NULL CHECK (historical_status IN ('ganho','perdido','aberto','revisao')),
  review_reasons    JSONB NOT NULL DEFAULT '[]',
  status_manual     BOOLEAN NOT NULL DEFAULT FALSE,
  ref_year          INT,
  year_source       TEXT CHECK (year_source IN ('criacao','ganho','perda','lote','manual')),
  year_inferred     BOOLEAN NOT NULL DEFAULT FALSE,
  raw               JSONB NOT NULL DEFAULT '{}',
  is_demo           BOOLEAN NOT NULL DEFAULT FALSE,
  created_by        INT REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON opportunities(contact_id);
CREATE INDEX ON opportunities(product_id, ref_year, historical_status);

CREATE TABLE campaigns (
  id                SERIAL PRIMARY KEY,
  name              TEXT NOT NULL,
  description       TEXT,
  promo_description TEXT,
  status            TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','ativa','pausada','encerrada')),
  start_date        DATE,
  end_date          DATE,
  product_ids       INT[] NOT NULL DEFAULT '{}',
  years             INT[] NOT NULL DEFAULT '{}',
  historical_statuses TEXT[] NOT NULL DEFAULT '{}',
  filters           JSONB NOT NULL DEFAULT '{}',
  goal_contacts     INT,
  goal_conversions  INT,
  goal_revenue      NUMERIC(14,2),
  followup_days     INT NOT NULL DEFAULT 3,
  max_attempts      INT NOT NULL DEFAULT 3,
  template_from_id  INT REFERENCES campaigns(id) ON DELETE SET NULL,
  is_demo           BOOLEAN NOT NULL DEFAULT FALSE,
  created_by        INT REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at      TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,
  closed_by         INT REFERENCES users(id)
);

CREATE TABLE campaign_sellers (
  campaign_id INT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id     INT NOT NULL REFERENCES users(id),
  PRIMARY KEY (campaign_id, user_id)
);

CREATE TABLE message_templates (
  id                SERIAL PRIMARY KEY,
  campaign_id       INT REFERENCES campaigns(id) ON DELETE CASCADE, -- NULL = biblioteca
  name              TEXT NOT NULL,
  kind              TEXT NOT NULL CHECK (kind IN ('inicial','followup')),
  step              INT NOT NULL DEFAULT 1,  -- 1 = primeira mensagem; 2 = 1º follow-up; 3 = 2º follow-up...
  product_id        INT REFERENCES products(id),
  ref_year          INT,
  historical_status TEXT,
  body              TEXT NOT NULL,
  version           INT NOT NULL DEFAULT 1,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_by        INT REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON message_templates(campaign_id);

CREATE TABLE message_template_versions (
  id          SERIAL PRIMARY KEY,
  template_id INT NOT NULL REFERENCES message_templates(id) ON DELETE CASCADE,
  version     INT NOT NULL,
  body        TEXT NOT NULL,
  created_by  INT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE campaign_contacts (
  id               SERIAL PRIMARY KEY,
  campaign_id      INT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id       INT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  opportunity_id   INT REFERENCES opportunities(id) ON DELETE SET NULL,
  assigned_to      INT REFERENCES users(id),
  assigned_at      TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN (
                     'pendente','enviada','aguardando','followup_pendente','respondeu','interesse',
                     'retorno_futuro','negociacao','convertido','sem_interesse','sem_resposta','opt_out')),
  attempts         INT NOT NULL DEFAULT 0,
  first_sent_at    TIMESTAMPTZ,
  last_sent_at     TIMESTAMPTZ,
  responded_at     TIMESTAMPTZ,
  interested_at    TIMESTAMPTZ,
  negotiation_at   TIMESTAMPTZ,
  converted_at     TIMESTAMPTZ,
  closed_at        TIMESTAMPTZ,
  conversion_value NUMERIC(14,2),
  conversion_product_id INT REFERENCES products(id),
  return_date      DATE,
  no_response_deadline DATE,
  notes            TEXT,
  is_demo          BOOLEAN NOT NULL DEFAULT FALSE,
  added_by         INT REFERENCES users(id),
  added_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, contact_id)
);
CREATE INDEX ON campaign_contacts(assigned_to, status);
CREATE INDEX ON campaign_contacts(contact_id);

CREATE TABLE followups (
  id                  SERIAL PRIMARY KEY,
  campaign_contact_id INT NOT NULL REFERENCES campaign_contacts(id) ON DELETE CASCADE,
  campaign_id         INT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  type                TEXT NOT NULL DEFAULT 'followup' CHECK (type IN ('followup','retorno')),
  step                INT,
  due_date            DATE NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','realizado','cancelado','suspenso')),
  status_reason       TEXT,
  created_by          INT REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at        TIMESTAMPTZ,
  completed_by        INT REFERENCES users(id)
);
CREATE INDEX ON followups(status, due_date);
CREATE INDEX ON followups(campaign_contact_id);

CREATE TABLE interactions (
  id                  SERIAL PRIMARY KEY,
  campaign_contact_id INT REFERENCES campaign_contacts(id) ON DELETE CASCADE,
  campaign_id         INT REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id          INT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  user_id             INT REFERENCES users(id),
  type                TEXT NOT NULL CHECK (type IN ('envio','copia','status','nota','atribuicao','followup_agendado','followup_cancelado','sistema','conversao','opt_out','participacao')),
  attempt             INT,
  from_status         TEXT,
  to_status           TEXT,
  message_text        TEXT,
  template_id         INT REFERENCES message_templates(id) ON DELETE SET NULL,
  template_version    INT,
  note                TEXT,
  value               NUMERIC(14,2),
  is_demo             BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON interactions(campaign_contact_id);
CREATE INDEX ON interactions(contact_id);
CREATE INDEX ON interactions(type, created_at);

CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INT REFERENCES users(id),
  action      TEXT NOT NULL,
  entity      TEXT,
  entity_id   INT,
  details     JSONB NOT NULL DEFAULT '{}',
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log(created_at);

INSERT INTO settings(key, value) VALUES
  ('unidade_padrao', '"Aldeia Coworking"'),
  ('janela_abordagem_recente_dias', '30'),
  ('followup_dias_padrao', '3'),
  ('max_tentativas_padrao', '3'),
  ('retencao_meses', '60');

INSERT INTO products(name, aliases, color, sort_order) VALUES
  ('Mesa / Plano Full', ARRAY['mesa','plano full','full','coworking','estacao','estação','posição','posicao','mesa fixa','mesa rotativa','hot desk'], '#3f6b55', 1),
  ('Escritório Privativo', ARRAY['escritorio','escritório','privativo','sala privativa','escritorio privativo'], '#6b5b3f', 2),
  ('Endereço Fiscal', ARRAY['endereco','endereço','fiscal','endereço fiscal','endereco fiscal','domicilio','domicílio','sede fiscal'], '#3f556b', 3),
  ('Salas de Reunião', ARRAY['sala de reuniao','sala de reunião','salas de reunião','reuniao','reunião','sala'], '#6b3f5e', 4),
  ('Eventos', ARRAY['evento','eventos','auditorio','auditório'], '#8a5a2b', 5);
