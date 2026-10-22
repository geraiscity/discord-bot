import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTicketTopic, parseTicketTopic } from '../src/ticket-meta.ts';

test('Metadados de ticket preservam titular, convidados e atendente', () => {
  const topic = buildTicketTopic({ ownerId:'123456789012345678', type:'suporte', addedUserIds:['223456789012345678','323456789012345678'], claimedBy:'423456789012345678' });
  assert.deepEqual(parseTicketTopic(topic), {
    ownerId:'123456789012345678',
    type:'suporte',
    addedUserIds:['223456789012345678','323456789012345678'],
    claimedBy:'423456789012345678',
  });
});

test('Ignora tópicos que não são tickets', () => {
  assert.equal(parseTicketTopic('canal normal'), null);
  assert.equal(parseTicketTopic(null), null);
});
