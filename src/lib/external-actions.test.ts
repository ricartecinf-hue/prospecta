import assert from "node:assert/strict";
import test from "node:test";
import { externalActionEnabled } from "./external-actions";

test("ações externas ficam bloqueadas por padrão seguro", () => {
  const config = { INSTAGRAM_DMS_ENABLED: "false", WHATSAPP_HANDOFF_ENABLED: "false" } as const;
  assert.equal(externalActionEnabled("instagram_dm", config), false);
  assert.equal(externalActionEnabled("whatsapp_handoff", config), false);
});

test("cada ação externa exige sua própria liberação", () => {
  const config = { INSTAGRAM_DMS_ENABLED: "true", WHATSAPP_HANDOFF_ENABLED: "false" } as const;
  assert.equal(externalActionEnabled("instagram_dm", config), true);
  assert.equal(externalActionEnabled("whatsapp_handoff", config), false);
});
