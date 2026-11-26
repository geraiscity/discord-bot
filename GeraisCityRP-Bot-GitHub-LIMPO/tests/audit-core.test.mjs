import test from "node:test";
import assert from "node:assert/strict";
import { auditDestination, roleChangeList, safeAuditText } from "../src/audit-core.ts";
test("roteamento por categoria e sem fallback para PV", () => {
  assert.equal(auditDestination("role", {DISCORD_ROLE_LOG_CHANNEL_ID:"role", GERAIS_LOG_CHANNEL_ID:"general"}, "shield"), "role");
  assert.equal(auditDestination("member", {GERAIS_LOG_CHANNEL_ID:"general"}, "shield"), "general");
  assert.equal(auditDestination("channel", {}, "shield"), "shield");
  assert.equal(auditDestination("channel", {}, null), null);
});
test("cargos exibem nome e ID sem gerar menções", () => {
  assert.match(roleChangeList([{name:"Moderador",id:"123456789012345678"}]), /Moderador.*123456789012345678/);
  assert.equal(safeAuditText("@everyone"), "\\@everyone");
  assert.equal(roleChangeList([]), "Não informado");
});
