import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../lib/decide.mjs";
import { DEFAULTS } from "../lib/config.mjs";

test("阈值边界(默认值)", () => {
  assert.equal(decide({ risk: 1.49, violation: 0.49 }, DEFAULTS).level, "allow");
  assert.equal(decide({ risk: 1.5, violation: 0 }, DEFAULTS).level, "confirm");
  assert.equal(decide({ risk: 0, violation: 0.5 }, DEFAULTS).level, "confirm");
  assert.equal(decide({ risk: 2.5, violation: 0 }, DEFAULTS).level, "block");
  assert.equal(decide({ risk: 0, violation: 0.85 }, DEFAULTS).level, "block");
  assert.equal(decide({ risk: 0.2, violation: 0.01 }, DEFAULTS).level, "allow");
});

test("reason 含两个数值", () => {
  assert.match(decide({ risk: 2.3, violation: 0.4 }, DEFAULTS).reason, /risk=2\.30 violation=0\.40/);
});
