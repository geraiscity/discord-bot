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
