import test from "node:test";
import assert from "node:assert/strict";
import { auditDestination, roleChangeList, safeAuditText } from "../src/audit/audit-core.ts";
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

import { effectiveLogRoute, normalizeLogRoutes, isLogRouteKind } from "../src/audit/audit-core.ts";
test("painel substitui env por categoria sem alterar as demais", () => {
  const env = {DISCORD_ROLE_LOG_CHANNEL_ID:"env-role",GERAIS_LOG_CHANNEL_ID:"env-general"};
  assert.equal(effectiveLogRoute("role",{role:"panel-role",general:"panel-general"},env,"shield"),"panel-role");
  assert.equal(effectiveLogRoute("role",{general:"panel-general"},env,"shield"),"env-role");
  assert.equal(effectiveLogRoute("channel",{general:"panel-general"},env,"shield"),"panel-general");
  assert.equal(effectiveLogRoute("security",{security:"panel-security"},env,"shield"),"panel-security");
  assert.equal(effectiveLogRoute("security",{},env,"shield"),"shield");
  assert.equal(effectiveLogRoute("member",{}, {}, null),null);
});
test("configuração persistida aceita apenas categorias e IDs válidos", () => {
  assert.deepEqual(normalizeLogRoutes({role:"123456789012345678",channel:"wrong",other:"123456789012345678"}),{role:"123456789012345678"});
  assert.equal(isLogRouteKind("security"),true);
  assert.equal(isLogRouteKind("unknown"),false);
});

test("destinos de tickets e Roblox respeitam seleção do painel",()=>{assert.equal(effectiveLogRoute("ticket_bugs",{ticket_bugs:"new"},{},"shield"),"new");assert.equal(effectiveLogRoute("ticket_bugs",{},{TRANSCRIPT_CHANNEL_ID:"transcript"},"shield"),"transcript");assert.equal(effectiveLogRoute("roblox",{},{ROBLOX_LOG_CHANNEL_ID:"game"},"shield"),"game");assert.equal(effectiveLogRoute("roblox_security",{security:"shield2"},{},"shield"),"shield2");});
