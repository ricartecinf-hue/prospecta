import assert from "node:assert/strict";
import test from "node:test";
import { filterMedicoProspect, filterProspectByNiche, filterPsychologyProspect } from "./prospecting-filter";
import type { InstagramProfile } from "./types";

const profile = (overrides: Partial<InstagramProfile> = {}): InstagramProfile => ({
  username: "perfil",
  fullName: "Nome",
  bio: "",
  followersCount: 1_000,
  followingCount: 100,
  postsCount: 20,
  profilePicUrl: null,
  recentPosts: [],
  whatsapp: null,
  email: null,
  igProfileUrl: "https://instagram.com/perfil",
  ...overrides,
});

test("aceita psicóloga identificada na bio", () => {
  assert.equal(filterPsychologyProspect(profile({ bio: "Psicóloga clínica | CRP 00/0000" })).accepted, true);
});

test("aceita identidade psi no username", () => {
  assert.equal(filterPsychologyProspect(profile({ username: "ana.silva.psi" })).accepted, true);
});

test("rejeita médico mesmo que publique sobre saúde mental", () => {
  const result = filterPsychologyProspect(profile({
    username: "dr.medico",
    bio: "Médico e palestrante",
    recentPosts: ["Como cuidar da saúde mental"],
  }));
  assert.equal(result.accepted, false);
});

test("rejeita agência que atende psicólogos sem profissional identificado", () => {
  assert.equal(filterPsychologyProspect(profile({ bio: "Marketing para psicólogos" })).accepted, false);
});

test("aceita médico identificado na bio", () => {
  assert.equal(filterMedicoProspect(profile({ bio: "Médico | Clínica Geral | CRM 00000" })).accepted, true);
});

test("aceita identidade dr./dra. no username", () => {
  assert.equal(filterMedicoProspect(profile({ username: "dra.juliana" })).accepted, true);
});

test("rejeita psicóloga na barreira de médico", () => {
  assert.equal(filterMedicoProspect(profile({ bio: "Psicóloga clínica | CRP 00/0000" })).accepted, false);
});

test("aceita médico identificado só pela especialidade na bio", () => {
  assert.equal(filterMedicoProspect(profile({ bio: "Cardiologista | Consultório em Florianópolis" })).accepted, true);
});

test("aceita 'dr' colado ao nome no username, sem separador", () => {
  assert.equal(filterMedicoProspect(profile({ username: "drcassiooliveira" })).accepted, true);
});

test("filterProspectByNiche despacha para o filtro do nicho certo", () => {
  const medico = profile({ bio: "Médico e palestrante" });
  assert.equal(filterProspectByNiche("medico", medico).accepted, true);
  assert.equal(filterProspectByNiche("psicologo", medico).accepted, false);
});
