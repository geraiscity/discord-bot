/**
 * Mantém os slash commands sincronizados sem apagar comandos de outros aplicativos.
 *
 * O Discord permite um comando global e um comando de servidor com o mesmo nome;
 * ao alternar entre os dois modos, versões antigas podem continuar aparecendo.
 * Este módulo não precisa de discord.js, o que permite testes sem conectar ao Discord.
 */
export type CommandDefinition = { name: string; type?: number };

export type RegisteredGlobalCommand = {
  id: string;
  name: string;
  type: number;
};

export interface CommandSyncApi {
  replaceGuild(guildId: string, commands: readonly CommandDefinition[]): Promise<void>;
  replaceGlobal(commands: readonly CommandDefinition[]): Promise<void>;
  listGlobal(): Promise<readonly RegisteredGlobalCommand[]>;
  deleteGlobal(commandId: string): Promise<void>;
}

export interface SyncOptions {
  guildIds: readonly string[];
  commands: readonly CommandDefinition[];
  api: CommandSyncApi;
  /** Apaga todos os comandos globais deste aplicativo, inclusive nomes antigos. */
  purgeLegacyGlobalCommands?: boolean;
}

export interface SyncResult {
  scope: "guild" | "global";
  guildCount: number;
  deletedGlobalCount: number;
  purgedAllGlobalCommands: boolean;
}

const CHAT_INPUT_TYPE = 1;
// Comandos antigos deste projeto que devem desaparecer mesmo não existindo mais na lista atual.
const LEGACY_CHAT_INPUT_NAMES = new Set(["spoiler", "seguranca"]);

export async function syncBotCommands(options: SyncOptions): Promise<SyncResult> {
  const { commands, api } = options;
  const seen = new Set<string>();

  // Falha antes de alterar o Discord caso um futuro comando seja duplicado no código.
  for (const command of commands) {
    const name = command.name.trim().toLowerCase();
    if (!name) throw new Error("Encontrado slash command sem nome.");
    const key = `${command.type ?? CHAT_INPUT_TYPE}:${name}`;
    if (seen.has(key)) {
      throw new Error(`Slash command definido mais de uma vez: ${name}`);
    }
    seen.add(key);
  }

  const guildIds = [...new Set(options.guildIds.filter(Boolean))];

  if (guildIds.length === 0) {
    // Sem servidores conectados: registra globalmente, como no projeto original.
    await api.replaceGlobal(commands);
    return {
      scope: "global",
      guildCount: 0,
      deletedGlobalCount: 0,
      purgedAllGlobalCommands: false,
    };
  }

  // PUT substitui a lista de comandos do aplicativo em cada servidor: limpa
  // comandos de servidor antigos, além de atualizar as definições atuais.
  // Não remove globais antes de confirmar que o registro nos servidores funcionou.
  for (const guildId of guildIds) {
    await api.replaceGuild(guildId, commands);
  }

  if (options.purgeLegacyGlobalCommands) {
    // Opção explicitamente ativada: também elimina comandos globais antigos
    // com nomes diferentes. Use somente se este aplicativo pertencer a este bot.
    await api.replaceGlobal([]);
    return {
      scope: "guild",
      guildCount: guildIds.length,
      deletedGlobalCount: 0,
      purgedAllGlobalCommands: true,
    };
  }

  // Por padrão, remove SOMENTE versões globais dos slash commands gerenciados
  // por este projeto. Outros comandos globais permanecem intactos.
  const managedNames = new Set(
    commands
      .filter((command) => (command.type ?? CHAT_INPUT_TYPE) === CHAT_INPUT_TYPE)
      .map((command) => command.name.toLowerCase()),
  );
  const registeredGlobal = await api.listGlobal();
  const duplicated = registeredGlobal.filter(
    (command) =>
      command.type === CHAT_INPUT_TYPE && (managedNames.has(command.name.toLowerCase()) || LEGACY_CHAT_INPUT_NAMES.has(command.name.toLowerCase())),
  );

  for (const command of duplicated) {
    await api.deleteGlobal(command.id);
  }

  return {
    scope: "guild",
    guildCount: guildIds.length,
    deletedGlobalCount: duplicated.length,
    purgedAllGlobalCommands: false,
  };
}
