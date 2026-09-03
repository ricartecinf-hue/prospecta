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
  location_confirmed: false,
  practice_ownership: false,
  student_or_resident: false,
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

test("nicho medico: aprova médico empreendedor de Florianópolis com todos os critérios", () => {
  const result = scoreQualification(
    profile({
      username: "dr.medico",
      fullName: "Carlos — Médico",
      bio: "Médico clínico geral. CRM SC 00000. Fundador da minha clínica em Florianópolis.",
      followersCount: 100_000,
      recentPosts: ["Prevenção e diagnóstico precoce", "Rotina do consultório e da nossa equipe"],
    }),
    signals({ location_confirmed: true, practice_ownership: true }),
    "medico",
  );
  assert.equal(result.score, 100);
  assert.equal(result.is_icp, true);
  assert.deepEqual(result.breakdown, {
    profession_confirmed: 35,
    location_confirmed: 25,
    practice_ownership: 20,
    professional_active: 15,
    followers_in_range: 5,
    subtotal: 100,
    automatic_block: null,
  });
});

test("nicho medico: sinal da IA sozinho não confirma localização sem menção explícita no perfil", () => {
  const result = scoreQualification(
    profile({
      fullName: "Carlos — Médico",
      bio: "Médico clínico geral. CRM 00000. Fundador da minha clínica.",
      followersCount: 100_000,
      recentPosts: ["Rotina do consultório e da nossa equipe"],
    }),
    // A IA marca location_confirmed=true, mas nem bio nem posts citam uma das 6 cidades.
    signals({ location_confirmed: true, practice_ownership: true }),
    "medico",
  );
  assert.equal(result.breakdown.location_confirmed, 0);
  assert.equal(result.is_icp, false, "sem localização confirmada, is_icp deve ser false mesmo com score alto");
  assert.ok(result.score >= 65, "score alto o suficiente se não fosse pela localização — prova que só a localização barrou o is_icp");
});

test("nicho medico: 'Santa Catarina'/'SC' genérico não conta como cidade confirmada", () => {
  const result = scoreQualification(
    profile({ bio: "Médico. Atendo pacientes em Santa Catarina, SC.", recentPosts: [] }),
    signals(),
    "medico",
  );
  assert.equal(result.breakdown.location_confirmed, 0);
});

test("nicho medico: 'São José dos Campos' (outra cidade) não conta como São José/SC", () => {
  const result = scoreQualification(
    profile({ bio: "Médico em São José dos Campos.", recentPosts: [] }),
    signals(),
    "medico",
  );
  assert.equal(result.breakdown.location_confirmed, 0);
});

test("nicho medico: 'São José' (SC, sem sufixo de outra cidade) conta normalmente", () => {
  const result = scoreQualification(
    profile({ bio: "Médico, atendo em São José, SC.", recentPosts: [] }),
    signals(),
    "medico",
  );
  assert.equal(result.breakdown.location_confirmed, 25);
});

test("nicho medico: distribui pontos de seguidores até o teto de 5", () => {
  const withFollowers = (followersCount: number) => scoreQualification(
    profile({ followersCount }),
    signals(),
    "medico",
  ).breakdown.followers_in_range;
  assert.deepEqual(
    [999, 1_000, 9_999, 10_000, 29_999, 30_000, 59_999, 60_000, 99_999, 100_000].map(withFollowers),
    [0, 1, 1, 2, 2, 3, 3, 4, 4, 5],
  );
});

test("nicho medico: bloqueia residente sem consultório próprio a 30 pontos", () => {
  const result = scoreQualification(
    profile({
      fullName: "Carlos",
      bio: "Residente de clínica médica no hospital universitário.",
      recentPosts: [],
    }),
    signals({ student_or_resident: true, location_confirmed: true }),
    "medico",
  );
  assert.equal(result.score, 30);
  assert.equal(result.is_icp, false);
  assert.match(result.breakdown.automatic_block ?? "", /residente sem consultório/);
});

test("nicho medico: residente com clínica própria não é bloqueado", () => {
  const result = scoreQualification(
    profile({
      fullName: "Carlos",
      bio: "Residente de clínica médica; fundador da minha clínica.",
      recentPosts: [],
    }),
    signals({ student_or_resident: true, practice_ownership: true, location_confirmed: true }),
    "medico",
  );
  assert.equal(result.breakdown.automatic_block, null);
});

test("nicho medico: bloqueia perfil pessoal sem vínculo profissional (teto de 30)", () => {
  const result = scoreQualification(
    profile({ fullName: "João Silva", bio: "Minha vida e minha família", recentPosts: [] }),
    signals({ profession_confirmed: false, personal_profile: true }),
    "medico",
  );
  assert.ok(result.score <= 30);
  assert.equal(result.is_icp, false);
  assert.match(result.breakdown.automatic_block ?? "", /perfil pessoal/);
});

test("nicho medico: bloqueio nunca eleva a nota acima do próprio subtotal", () => {
  const result = scoreQualification(
    profile({
      fullName: "Carlos",
      bio: "Médico atuante em Florianópolis.",
      followersCount: 100_000,
    }),
    signals({ student_or_resident: true, location_confirmed: true, practice_ownership: false }),
    "medico",
  );
  // profissão + local + ativo + seguidores somam mais que 30, mas o bloqueio de
  // residente sem consultório próprio limita a nota a 30.
  assert.equal(result.score, 30);
  assert.match(result.breakdown.automatic_block ?? "", /residente sem consultório/);
});

test("nicho medico: não bloqueia psicóloga, apenas nega os pontos de profissão", () => {
  const result = scoreQualification(
    profile(),
    signals({ profession_confirmed: false, personal_profile: false }),
    "medico",
  );
  assert.equal(result.is_icp, false);
  assert.equal(result.breakdown.automatic_block, null);
  assert.equal(result.breakdown.profession_confirmed, 0);
});
