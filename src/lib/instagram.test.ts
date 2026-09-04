import assert from "node:assert/strict";
import test from "node:test";
import { hashtagSearchPath, locationExplorePath, locationPageMatchesCity, parseCompactNumber } from "./instagram";

test("converte contagens compactas do Instagram", () => {
  assert.equal(parseCompactNumber("1,5 mil"), 1500);
  assert.equal(parseCompactNumber("37K"), 37000);
  assert.equal(parseCompactNumber("1.2K"), 1200);
  assert.equal(parseCompactNumber("1.234"), 1234);
});

test("gera a rota atual de busca por hashtag", () => {
  assert.equal(
    hashtagSearchPath("#medicosc"),
    "/explore/search/keyword/?q=%23medicosc",
  );
  assert.equal(
    hashtagSearchPath("##psicóloga online"),
    "/explore/search/keyword/?q=%23psic%C3%B3loga%20online",
  );
});

test("gera e valida a rota de busca por location_id", () => {
  assert.equal(locationExplorePath("109351455749641"), "/explore/locations/109351455749641/");
  assert.throws(() => locationExplorePath("Florianópolis"), /location_id inválido/);
});

test("confirma se a página de localização corresponde à cidade configurada", () => {
  assert.equal(locationPageMatchesCity("São José (Santa Catarina) Cidade", "São José SC"), true);
  assert.equal(locationPageMatchesCity("Victoria Hotel · Melbourne", "Joinville SC"), false);
});
