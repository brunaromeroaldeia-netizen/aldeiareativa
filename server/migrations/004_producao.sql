-- Arquivo original de cada importação guardado no próprio banco (não depende do disco do servidor).
ALTER TABLE imports ADD COLUMN IF NOT EXISTS file_data BYTEA;
