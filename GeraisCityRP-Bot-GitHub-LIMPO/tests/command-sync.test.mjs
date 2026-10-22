import test from "node:test";
import assert from "node:assert/strict";
import { syncBotCommands } from "../src/command-sync.ts";

const current = [
  { name: "ticket", type: 1 },
  { name: "painel-tickets", type: 1 },
  { name: "painel-admin", type: 1 },
  { name: "reaction-role", type: 1 },
  { name: "anunciar", type: 1 },
  { name: "divulgar", type: 1 },
];

function fakeApi(globalCommands = [], failGuildId = null) {
  const operations = [];
  const api = {
    replaceGuild: async (guildId, commands) => {
      operations.push(["guild", guildId, commands.map((command) => command.name)]);
      if (guildId === failGuildId) throw new Error("Discord indisponível");
    },
    replaceGlobal: async (commands) => {
      operations.push(["global", commands.map((command) => command.name)]);
    },
    listGlobal: async () => {
      operations.push(["list-global"]);
      return globalCommands;
    },
    deleteGlobal: async (id) => {
      operations.push(["delete-global", id]);
    },
  };
  return { api, operations };
}

test("sem servidor, publica globalmente uma única lista", async () => {
  const { api, operations } = fakeApi();
  const result = await syncBotCommands({ guildIds: [], commands: current, api });
  assert.deepEqual(operations, [["global", current.map((command) => command.name)]]);
  assert.equal(result.scope, "global");
});

test("sincroniza servidores e remove globais atuais e legados /spoiler e /seguranca", async () => {
  const { api, operations } = fakeApi([
    { id: "a", name: "painel-tickets", type: 1 },
    { id: "b", name: "anunciar", type: 1 },
    { id: "c", name: "outro", type: 1 },
    { id: "d", name: "anunciar", type: 2 },
    { id: "e", name: "spoiler", type: 1 },
    { id: "f", name: "seguranca", type: 1 },
  ]);
  const result = await syncBotCommands({ guildIds: ["111", "222", "111"], commands: current, api });
  assert.deepEqual(operations.map((op) => op[0]), [
    "guild", "guild", "list-global", "delete-global", "delete-global", "delete-global", "delete-global",
  ]);
  assert.deepEqual(operations.filter((op) => op[0] === "delete-global"), [
    ["delete-global", "a"], ["delete-global", "b"], ["delete-global", "e"], ["delete-global", "f"],
  ]);
  assert.equal(result.guildCount, 2);
  assert.equal(result.deletedGlobalCount, 4);
});

test("limpeza total explícita elimina globais antigos com nomes diferentes", async () => {
  const { api, operations } = fakeApi([{ id: "old", name: "qualquer-antigo", type: 1 }]);
  const result = await syncBotCommands({ guildIds: ["111"], commands: current, api, purgeLegacyGlobalCommands: true });
  assert.deepEqual(operations.map((op) => op[0]), ["guild", "global"]);
  assert.deepEqual(operations.at(-1), ["global", []]);
  assert.equal(result.purgedAllGlobalCommands, true);
});

test("não altera Discord se existem comandos duplicados no próprio código", async () => {
  const { api, operations } = fakeApi();
  await assert.rejects(
    syncBotCommands({ guildIds: ["111"], commands: [...current, { name: "ANUNCIAR" }], api }),
    /mais de uma vez/,
  );
  assert.deepEqual(operations, []);
});

test("não apaga comandos globais se a sincronização do servidor falhar", async () => {
  const { api, operations } = fakeApi([], "222");
  await assert.rejects(syncBotCommands({ guildIds: ["111", "222"], commands: current, api }), /Discord indisponível/);
  assert.deepEqual(operations.map((op) => op[0]), ["guild", "guild"]);
});
