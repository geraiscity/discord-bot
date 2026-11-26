import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSensitiveContent, SlidingCounter, isProtectedChannel, isPrivilegedPermissionChange, shouldQuarantineRoles, scoreJoinRisk } from '../src/security-core.ts';

const base = { blockInvites: true, allowedInviteCodes: ['GeraisOficial'], protectedTerms: ['interior secreto'] };
test('Bloqueia convites de terceiros, respeita lista permitida', () => {
  assert.equal(detectSensitiveContent('entra https://discord.gg/ABCde', base), 'convite');
  assert.equal(detectSensitiveContent('https://discord.com/invite/GeraisOficial', base), null);
  assert.equal(detectSensitiveContent('https://discord.gg/unknown', {...base, blockInvites:false}), null);
});
test('Detecta padrões de token sem registrar seu valor', () => {
  assert.equal(detectSensitiveContent('mfa.' + 'a'.repeat(40), base), 'possivel_token');
});
test('Detecta termos de proteção e ignora termos pequenos', () => {
  assert.equal(detectSensitiveContent('Vi o INTERIOR SECRETO', base), 'termo_protegido');
  assert.equal(detectSensitiveContent('oi', {...base, protectedTerms:['oi']}), null);
});
test('Conta entradas em janela separada por chave, expira entradas antigas', () => {
  const joins = new SlidingCounter(20_000);
  assert.equal(joins.record('guild-a', 100_000), 1);
  assert.equal(joins.record('guild-a', 101_000), 2);
  assert.equal(joins.record('guild-b', 101_000), 1);
  assert.equal(joins.record('guild-a', 121_001), 1);
});
test('Protege tickets e canais explicitamente configurados', () => {
  assert.equal(isProtectedChannel('123','ticket:999999999999999:bugs',[]), true);
  assert.equal(isProtectedChannel('123',null,['123']), true);
  assert.equal(isProtectedChannel('123',null,[]), false);
});
test('Avisa somente quando uma permissão perigosa foi acrescentada', () => {
  assert.equal(isPrivilegedPermissionChange(0n,8n,8n), true);
  assert.equal(isPrivilegedPermissionChange(8n,8n,8n), false);
  assert.equal(isPrivilegedPermissionChange(0n,4n,8n), false);
  assert.equal(shouldQuarantineRoles(8n,8n),true);
});
test('Risk Score sobe para contas novas em pico e bots não autorizados', () => {
  const human = scoreJoinRisk({ accountAgeMs: 2 * 60 * 60 * 1000, defaultAvatar: true, username:'user12345', joinsInWindow:8, raidThreshold:8, isBot:false, botAllowed:true });
  assert.ok(human.score >= 9);
  assert.ok(human.factors.includes('entrada durante pico de raid'));
  const bot = scoreJoinRisk({ accountAgeMs: 365 * 86400000, defaultAvatar:false, username:'BotSeguro', joinsInWindow:1, raidThreshold:8, isBot:true, botAllowed:false });
  assert.equal(bot.score, 10);
});

import { uniqueAuditEvidence, AuditClaims, auditRoleAdditionMatches, auditValueMatches, massActionDecision, shouldQuarantineJoin } from '../src/security-core.ts';
test('auditoria rejeita entradas antigas, ambíguas e sem executor', () => {
  const entry = {id:'a',targetId:'target',executorId:'actor',createdTimestamp:10000};
  assert.equal(uniqueAuditEvidence([entry],'target',10001),entry);
  assert.equal(uniqueAuditEvidence([entry],'target',16000),null);
  assert.equal(uniqueAuditEvidence([entry],'other',10001),null);
  assert.equal(uniqueAuditEvidence([entry,{...entry,id:'b'}],'target',10001),null);
  assert.equal(uniqueAuditEvidence([{...entry,executorId:null}],'target',10001),null);
  const claims = new AuditClaims();
  assert.equal(claims.claim('a',1000),true);
  assert.equal(claims.claim('a',2000),false);
  assert.equal(claims.claim('a',62000),true);
});
test('correlaciona alterações de cargo e permissões exatas', () => {
  const entry = {id:'a',targetId:'target',executorId:'actor',createdTimestamp:10000,changes:[{key:'$add',new:[{id:'role'}]},{key:'permissions',old:'0',new:'8'}]};
  assert.equal(auditRoleAdditionMatches(entry,['role']),true);
  assert.equal(auditRoleAdditionMatches(entry,['other']),false);
  assert.equal(auditValueMatches(entry,'permissions','0','8'),true);
  assert.equal(auditValueMatches(entry,'permissions','0','16'),false);
});
test('equipe confiável continua monitorada com limite dobrado', () => {
  assert.deepEqual(massActionDecision(3,3,true,true),{alert:true,contain:false,effectiveThreshold:6});
  assert.equal(massActionDecision(6,3,true,true).contain,true);
  assert.equal(massActionDecision(3,3,false,true).contain,true);
  assert.equal(massActionDecision(20,3,false,false).contain,false);
});
test('sinais fracos isolados não autorizam quarentena', () => {
  const base = {accountAgeMs:1000,defaultAvatar:true,username:'user12345',joinsInWindow:3,raidThreshold:8,isBot:false,botAllowed:true};
  assert.equal(shouldQuarantineJoin(base,3),false);
  assert.equal(shouldQuarantineJoin({...base,joinsInWindow:8},7),true);
  assert.equal(shouldQuarantineJoin({...base,joinsInWindow:8,accountAgeMs:30*86400000},3),false);
});
