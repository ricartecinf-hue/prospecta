import assert from "node:assert/strict";
import test from "node:test";
import { firstName, isOptOut, renderDmTemplate, showsInterest } from "./text";

test("extrai o primeiro nome e substitui o template", () => {
  assert.equal(firstName("Dra. Ana Souza", "ana.psi"), "Ana");
  assert.equal(renderDmTemplate("Oi {{first_name}}!", "Ana Souza", "ana.psi"), "Oi Ana!");
});

test("detecta opt-out em português", () => {
  assert.equal(isOptOut("Obrigada, mas não quero receber mensagens"), true);
  assert.equal(isOptOut("Pode me mostrar?"), false);
});

test("detecta interesse sem confundir opt-out", () => {
  assert.equal(showsInterest("Sim, como funciona?"), true);
  assert.equal(showsInterest("Agora não"), false);
});
