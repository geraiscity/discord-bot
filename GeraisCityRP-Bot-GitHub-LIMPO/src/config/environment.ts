import { ChannelType } from "discord.js";

const DEFAULT_RULES = [
  "Explique o seu caso com clareza e aguarde a equipe.",
  "Não marque membros da equipe sem necessidade.",
  "Envie todas as informações relevantes em uma única mensagem quando possível.",
  "Respeite as regras do servidor durante o atendimento.",
];

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function requiredEnv(name: string): string {
  const value = optionalEnv(name);
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

function parseList(value: string | undefined): string[] {
  return value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean) ?? [];
}

function parseHexColor(value: string | undefined, fallback = 0x5865f2): number {
  const normalized = value?.trim().replace(/^#/, "");
  if (!normalized || !/^[\da-f]{6}$/i.test(normalized)) {
    return fallback;
  }
  return Number.parseInt(normalized, 16);
}

export const config = {
  token: requiredEnv("DISCORD_TOKEN"),
  guildId: optionalEnv("DISCORD_GUILD_ID"),
  purgeLegacyGlobalCommands: optionalEnv("DISCORD_PURGE_LEGACY_GLOBAL_COMMANDS") === "true",
  moderationRoleIds: parseList(
    optionalEnv("MODERATION_ROLE_IDS") ?? optionalEnv("MODERATION_ROLE_ID"),
  ),
  moderationRoleNames: parseList(optionalEnv("MODERATION_ROLE_NAMES")),
  ticketCategoryId: optionalEnv("TICKET_CATEGORY_ID"),
  ticketCategoryName: optionalEnv("TICKET_CATEGORY_NAME"),
  rules: optionalEnv("TICKET_RULES")?.split(/\r?\n/).filter(Boolean) ?? DEFAULT_RULES,
  defaults: {
    panelTitle: optionalEnv("TICKET_PANEL_TITLE") ?? "Central de Atendimento",
    panelDescription:
      optionalEnv("TICKET_PANEL_DESCRIPTION") ??
      "Escolha uma categoria abaixo para abrir um atendimento privado com a nossa equipe.",
    panelColor: parseHexColor(optionalEnv("TICKET_PANEL_COLOR")),
    footerImage: optionalEnv("TICKET_PANEL_FOOTER_IMAGE"),
  },
  validCategoryTypes: [ChannelType.GuildCategory],
} as const;

export function colorFromOption(value: string | null | undefined): number {
  return parseHexColor(value ?? undefined, config.defaults.panelColor);
}