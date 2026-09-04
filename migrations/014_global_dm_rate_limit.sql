-- Consolida os contadores legados por nicho antes de aplicar o teto global da conta.
-- O código novo reserva sempre em `dm_total`.
INSERT INTO prospecta.rate_limit_counters AS global_counter (date, kind, count)
SELECT date, 'dm_total', LEAST(30, SUM(count)::INTEGER)
FROM prospecta.rate_limit_counters
WHERE kind LIKE 'dm_total:%'
GROUP BY date
ON CONFLICT (date, kind) DO UPDATE
SET count = GREATEST(global_counter.count, EXCLUDED.count);
