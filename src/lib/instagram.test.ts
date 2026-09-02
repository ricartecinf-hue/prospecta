import assert from "node:assert/strict";
import test from "node:test";
import { parseCompactNumber } from "./instagram";

test("converte contagens compactas do Instagram", () => {
  assert.equal(parseCompactNumber("1,5 mil"), 1500);
  assert.equal(parseCompactNumber("37K"), 37000);
  assert.equal(parseCompactNumber("1.2K"), 1200);
  assert.equal(parseCompactNumber("1.234"), 1234);
});
