-- Libera jobs de qualificação que ficaram agendados no futuro pelo provedor antigo.
BEGIN;

SET LOCAL search_path TO prospecta, public, extensions;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_icp BOOLEAN;

-- Resultados antigos só persistiam a decisão final no status. Fazemos o backfill
-- dessa decisão efetiva; novas qualificações gravam o valor bruto retornado pela IA.
UPDATE leads
SET is_icp = (status = 'qualified')
WHERE qualified_at IS NOT NULL
  AND is_icp IS NULL;

UPDATE jobs
SET run_after = NOW(),
    attempts = 0,
    last_error = 'reagendado após migração de OpenAI para Gemini',
    updated_at = NOW()
WHERE kind = 'qualify'
  AND status = 'pending'
  AND last_error LIKE 'OpenAI%';

COMMIT;
