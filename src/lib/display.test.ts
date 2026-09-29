import assert from "node:assert/strict";
import test from "node:test";
import { conversionRate, eventLabel, jobKindLabel, jobStatusLabel, leadStatusLabel } from "./display";

test("traduz status e eventos operacionais para o painel", () => {
  assert.equal(leadStatusLabel("dm_sent"), "Mensagem enviada");
  assert.equal(jobStatusLabel("dead"), "Interrompidos");
  assert.equal(jobKindLabel("inbox_poll"), "Leitura do inbox");
  assert.equal(eventLabel("system.paused_by_user"), "Sistema pausado manualmente");
});

test("calcula conversão sem divisão por zero", () => {
  assert.equal(conversionRate(24, 58), 41.4);
  assert.equal(conversionRate(0, 0), 0);
});
