import assert from "node:assert/strict";
import test from "node:test";
import { prospectingNightKey, prospectingSchedule } from "./prospecting-safety";

const brt = (day: number, hour: number, minute: number) => new Date(Date.UTC(2026, 8, day, hour + 3, minute));

test("pausa entre 02:00 e 03:00 e retorna às 03:01", () => {
  const permit = prospectingSchedule(brt(3, 2, 30));
  assert.equal(permit.allowed, false);
  assert.equal(permit.runAfter.toISOString(), brt(3, 3, 1).toISOString());
});

test("permite a janela de 03:01 até 03:40", () => {
  assert.equal(prospectingSchedule(brt(3, 3, 20)).allowed, true);
});

test("pausa entre 03:41 e 07:00 e retorna às 07:01", () => {
  const permit = prospectingSchedule(brt(3, 5, 0));
  assert.equal(permit.allowed, false);
  assert.equal(permit.runAfter.toISOString(), brt(3, 7, 1).toISOString());
});

test("agrupa a madrugada na noite do dia anterior", () => {
  assert.equal(prospectingNightKey(brt(3, 0, 10)), "2026-09-02");
});
