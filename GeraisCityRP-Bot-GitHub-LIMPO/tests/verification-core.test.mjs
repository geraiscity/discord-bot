import test from "node:test";
import assert from "node:assert/strict";
import { evaluateVerificationSignals } from "../src/verification-core.ts";

const day = 86_400_000;
const base = {
  accountAgeMs: 45 * day,
  minAccountDays: 30,
  isBot: false,
  pending: false,
  requireScreening: true,
  requireNativeDiscordVerification: true,
  nativeDiscordVerificationEnabled: true,
};

test("aprova conta humana antiga com triagem e verificação nativa prontas", () => {
  const result = evaluateVerificationSignals(base);
  assert.equal(result.ok, true);
  assert.equal(result.accountAgeDays, 45);
});

test("rejeita conta com menos de 30 dias", () => {
  const result = evaluateVerificationSignals({ ...base, accountAgeMs: 12 * day });
  assert.equal(result.ok, false);
  assert.match(result.reason, /30 dias/);
});

test("rejeita bot e membro ainda pendente na triagem", () => {
  assert.equal(evaluateVerificationSignals({ ...base, isBot: true }).ok, false);
  assert.match(evaluateVerificationSignals({ ...base, pending: true }).reason, /triagem/i);
});

test("rejeita quando a política exige verificação nativa e ela está desligada", () => {
  const result = evaluateVerificationSignals({ ...base, nativeDiscordVerificationEnabled: false });
  assert.equal(result.ok, false);
  assert.match(result.reason, /verificação nativa/i);
});
