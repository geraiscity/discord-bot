import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
test("no legacy server name in runtime source", () => {
  const dir = new URL("../src/", import.meta.url);
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".ts"))) {
    assert.doesNotMatch(readFileSync(new URL(file, dir), "utf8"), /gerais[\s_-]*city/i, file);
  }
});
