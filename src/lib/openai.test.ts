import assert from "node:assert/strict";
import test from "node:test";
import { geminiRetryReason } from "./openai";

test("reconhece cota esgotada do Gemini como condição reagendável", () => {
  assert.equal(
    geminiRetryReason({ status: 429, statusText: "RESOURCE_EXHAUSTED" }),
    "cota ou limite temporário do Gemini",
  );
});

test("reconhece indisponibilidade temporária do Gemini", () => {
  assert.equal(geminiRetryReason({ status: 503, statusText: "UNAVAILABLE" }), "Gemini temporariamente indisponível");
});

test("não mascara erros permanentes do Gemini", () => {
  assert.equal(geminiRetryReason({ status: 400, statusText: "INVALID_ARGUMENT" }), null);
});
