import assert from "node:assert/strict";
import test from "node:test";
import { extractProfileContacts } from "./profile-contacts";

test("extrai WhatsApp de link wa.me e email", () => {
  assert.deepEqual(
    extractProfileContacts("Contato: psi@exemplo.com", ["https://wa.me/5554999999999"], "psi.teste"),
    { whatsapp: "5554999999999", email: "psi@exemplo.com", igProfileUrl: "https://instagram.com/psi.teste" },
  );
});

test("normaliza telefone brasileiro escrito na bio", () => {
  assert.equal(extractProfileContacts("Agende: (54) 99999-8888", [], "psi").whatsapp, "5554999998888");
});

test("não confunde texto sem contato", () => {
  assert.equal(extractProfileContacts("Psicóloga clínica", [], "psi").whatsapp, null);
});
