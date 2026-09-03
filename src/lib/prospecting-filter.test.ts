import assert from "node:assert/strict";
import test from "node:test";
import { filterPsychologyProspect } from "./prospecting-filter";
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
