import assert from "node:assert/strict";
import test from "node:test";
import { followerPoints, scoreQualification, type QualificationSignals } from "./qualification-score";
import type { InstagramProfile } from "./types";

const profile = (overrides: Partial<InstagramProfile> = {}): InstagramProfile => ({
  username: "psi.teste",
  fullName: "Ana — Psicóloga",
  bio: "Psicóloga clínica. Atendimento online e presencial.",
  followersCount: 25_000,
  followingCount: 300,
  postsCount: 80,
  profilePicUrl: null,
  recentPosts: ["Como cuidar da saúde mental", "Ansiedade e autocuidado"],
  whatsapp: null,
  email: null,
  igProfileUrl: "https://instagram.com/psi.teste",
  ...overrides,
});

const signals = (overrides: Partial<QualificationSignals> = {}): QualificationSignals => ({
  profession_confirmed: true,
  mental_health_content: true,
  professional_active: true,
  service_mentioned: true,
  personal_profile: false,
  evidence: "Perfil profissional com conteúdo recente.",
  ...overrides,
});

test("soma os cinco critérios até 100 pontos", () => {
  const result = scoreQualification(profile(), signals());
  assert.equal(result.score, 100);
  assert.equal(result.is_icp, true);
  assert.deepEqual(result.breakdown, {
    profession_confirmed: 35,
    mental_health_content: 25,
    followers_in_range: 15,
    professional_active: 15,
    service_mentioned: 10,
    subtotal: 100,
    automatic_block: null,
  });
});

test("distribui os pontos de seguidores por faixa", () => {
  assert.deepEqual(
    [499, 500, 3_000, 3_001, 5_000, 5_001, 10_000, 10_001, 20_000, 20_001, 30_000, 30_001].map(followerPoints),
    [0, 3, 3, 6, 6, 9, 9, 12, 12, 15, 15, 15],
  );
});

test("concede pontuação máxima acima de 20 mil sem teto superior", () => {
  const result = scoreQualification(profile({ followersCount: 40_000 }), signals());
  assert.equal(result.breakdown.followers_in_range, 15);
  assert.equal(result.score, 100);
});

test("limita profissão excluída sem psicologia a 40 pontos", () => {
  const result = scoreQualification(
    profile({ fullName: "Carlos Médico", bio: "Médico e coach. Atendimento online." }),
    signals({ profession_confirmed: false, personal_profile: false }),
  );
  assert.equal(result.score, 40);
  assert.equal(result.is_icp, false);
  assert.match(result.breakdown.automatic_block ?? "", /profissão fora do ICP/);
});

test("aplica bloqueio quando a profissão excluída aparece na evidência estruturada", () => {
  const result = scoreQualification(
    profile({ fullName: "Carlos", bio: "Atendimento online", recentPosts: [] }),
    signals({
      profession_confirmed: false,
      mental_health_content: false,
      evidence: "O perfil pertence a um médico urologista com consultório ativo.",
    }),
  );
  assert.equal(result.score, 40);
  assert.equal(result.is_icp, false);
  assert.match(result.breakdown.automatic_block ?? "", /profissão fora do ICP/);
});

test("não bloqueia terapeuta que também menciona coaching", () => {
  const result = scoreQualification(
    profile({ fullName: "Ana Terapeuta", bio: "Terapeuta e coach. Atendimento online." }),
    signals(),
  );
  assert.equal(result.score, 100);
  assert.equal(result.breakdown.automatic_block, null);
});

test("limita perfil pessoal sem vínculo profissional", () => {
  const result = scoreQualification(
    profile({ fullName: "João Silva", bio: "Minha vida e minha família", recentPosts: [] }),
    signals({ profession_confirmed: false, mental_health_content: false, professional_active: false, service_mentioned: false, personal_profile: true }),
  );
  assert.equal(result.is_icp, false);
  assert.match(result.breakdown.automatic_block ?? "", /perfil pessoal/);
});

test("não aprova perfil sem profissão-alvo mesmo que outros critérios somem 65", () => {
  const result = scoreQualification(
    profile({ fullName: "Gestor de marketing", bio: "Captação de pacientes para psicólogos" }),
    signals({ profession_confirmed: false, personal_profile: false }),
  );
  assert.equal(result.score, 65);
  assert.equal(result.is_icp, false);
});
