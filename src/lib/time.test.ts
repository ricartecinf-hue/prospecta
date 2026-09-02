import assert from "node:assert/strict";
import test from "node:test";
import { isWithinOperationWindow, nextOperationWindow } from "./time";

test("respeita a janela 09:00–20:00 de São Paulo", () => {
  assert.equal(isWithinOperationWindow(new Date("2026-09-01T15:00:00Z"), 9, 20), true);
  assert.equal(isWithinOperationWindow(new Date("2026-09-02T01:00:00Z"), 9, 20), false);
});

test("reagenda manhã cedo para 09:00 local", () => {
  assert.equal(nextOperationWindow(new Date("2026-09-01T10:00:00Z"), 9, 20).toISOString(), "2026-09-01T12:00:00.000Z");
});
