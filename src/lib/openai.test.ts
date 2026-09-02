import assert from "node:assert/strict";
import test from "node:test";
import { openAIRetryReason } from "./openai";

test("reconhece falta de créditos da OpenAI como condição reagendável", () => {
  assert.equal(
    openAIRetryReason({ status: 429, code: "credit_balance_exhausted", type: "insufficient_quota" }),
    "OpenAI sem créditos disponíveis",
  );
});

test("não mascara erros permanentes da OpenAI", () => {
  assert.equal(openAIRetryReason({ status: 401, code: "invalid_api_key" }), null);
});
