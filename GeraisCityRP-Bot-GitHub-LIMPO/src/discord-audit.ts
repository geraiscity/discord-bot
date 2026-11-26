import { AuditLogEvent, ChannelType, EmbedBuilder, PermissionFlagsBits, PermissionsBitField, type Guild, type GuildAuditLogsEntry } from "discord.js";
import { roleChangeList, safeAuditText } from "./audit-core.js";
import { resolveLogRoute } from "./log-routing.js";

type Kind = "channel" | "role" | "member" | "server";
const actions = new Map<number, [Kind, string]>([
  [AuditLogEvent.ChannelCreate, ["channel", "Canal criado"]],
  [AuditLogEvent.ChannelUpdate, ["channel", "Canal alterado"]],
  [AuditLogEvent.ChannelDelete, ["channel", "Canal excluído"]],
  [AuditLogEvent.ChannelOverwriteCreate, ["channel", "Permissão de canal criada"]],
  [AuditLogEvent.ChannelOverwriteUpdate, ["channel", "Permissão de canal alterada"]],
  [AuditLogEvent.ChannelOverwriteDelete, ["channel", "Permissão de canal removida"]],
  [AuditLogEvent.RoleCreate, ["role", "Cargo criado"]],
  [AuditLogEvent.RoleUpdate, ["role", "Cargo alterado"]],
  [AuditLogEvent.RoleDelete, ["role", "Cargo excluído"]],
  [AuditLogEvent.MemberRoleUpdate, ["member", "Cargos de membro alterados"]],
  [AuditLogEvent.MemberUpdate, ["member", "Membro atualizado"]],
  [AuditLogEvent.MemberKick, ["member", "Membro expulso"]],
  [AuditLogEvent.MemberBanAdd, ["member", "Membro banido"]],
  [AuditLogEvent.MemberBanRemove, ["member", "Banimento removido"]],
  [AuditLogEvent.BotAdd, ["member", "Bot adicionado"]],
  [AuditLogEvent.GuildUpdate, ["server", "Servidor alterado"]],
  [AuditLogEvent.WebhookCreate, ["server", "Webhook criado"]],
  [AuditLogEvent.WebhookUpdate, ["server", "Webhook alterado"]],
  [AuditLogEvent.WebhookDelete, ["server", "Webhook removido"]],
  [AuditLogEvent.IntegrationCreate, ["server", "Integração criada"]],
  [AuditLogEvent.IntegrationUpdate, ["server", "Integração alterada"]],
  [AuditLogEvent.IntegrationDelete, ["server", "Integração removida"]],
]);
const labels: Record<string, string> = {
  name:"Nome", nick:"Apelido", type:"Tipo", parent_id:"Categoria", position:"Posição",
  color:"Cor", hoist:"Exibir separadamente", mentionable:"Mencionável", nsfw:"Restrição de idade",
  rate_limit_per_user:"Modo lento (segundos)", bitrate:"Taxa de bits", user_limit:"Limite de usuários",
  verification_level:"Nível de verificação", communication_disabled_until:"Timeout até",
  permissions:"Permissões do cargo", allow:"Permissões concedidas", deny:"Permissões negadas",
};
const channelTypes: Record<string,string> = {"0":"Texto","2":"Voz","4":"Categoria","5":"Anúncios","13":"Palco","15":"Fórum","16":"Mídia"};
function valueFor(key: string, value: unknown, guild: Guild): string {
  if (value === null || value === undefined) return "Não definido";
  if (key === "parent_id" && typeof value === "string") {
    const channel = guild.channels.cache.get(value);
    return channel ? safeAuditText(channel.name) + " (ID " + value + ")" : safeAuditText(value);
  }
  if (["permissions","allow","deny"].includes(key) && (typeof value === "string" || typeof value === "number")) {
    try { return new PermissionsBitField(BigInt(value)).toArray().join(", ").slice(0, 400) || "Nenhuma"; } catch { return "Não identificado"; }
  }
  if (key === "type") return channelTypes[String(value)] ?? safeAuditText(value);
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  return safeAuditText(value);
}
function accountName(user: unknown): string | null {
  if (!user || typeof user !== "object") return null;
  const u = user as { username?: unknown; globalName?: unknown };
  if (typeof u.username !== "string") return null;
  return (typeof u.globalName === "string" && u.globalName !== u.username ? safeAuditText(u.globalName, 70) + " • " : "") + "@" + safeAuditText(u.username, 70);
}
const stats = new Map<string,{sent:number;failed:number}>();
export function auditDeliveryStats(guildId: string) { return stats.get(guildId) ?? {sent:0,failed:0}; }

export async function deliverDiscordAudit(entry: GuildAuditLogsEntry, guild: Guild, shieldChannel: string | null): Promise<void> {
  const action = actions.get(entry.action);
  if (!action) return;
  const [kind,title] = action;
  const destination = await resolveLogRoute(guild.id, kind, shieldChannel);
  const delivery = stats.get(guild.id) ?? {sent:0,failed:0};
  stats.set(guild.id, delivery);
  const channel = destination ? await guild.channels.fetch(destination).catch(() => null) : null;
  const me = guild.members.me;
  if (channel?.type !== ChannelType.GuildText || channel.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel) !== false || !me || !channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
    delivery.failed++;
    return;
  }
  const executor = entry.executor ?? (entry.executorId ? guild.client.users.cache.get(entry.executorId) ?? await guild.client.users.fetch(entry.executorId).catch(() => null) : null);
  const actor = accountName(executor) ?? "Não identificado pelo Discord";
  const changes = entry.changes ?? [];
  const targetId = entry.targetId;
  const target = entry.target as unknown;
  const targetObject = target && typeof target === "object" ? target as { name?: unknown } : null;
  const historicalName = changes.find((c) => c.key === "name");
  const cachedName = targetId ? (kind === "channel" ? guild.channels.cache.get(targetId)?.name : kind === "role" ? guild.roles.cache.get(targetId)?.name : undefined) : undefined;
  const targetUser = kind === "member" && targetId ? guild.client.users.cache.get(targetId) ?? (accountName(target) ? null : await guild.client.users.fetch(targetId).catch(() => null)) : null;
  const targetName = kind === "member" ? accountName(target) ?? accountName(targetUser) ?? "Conta não identificada" : safeAuditText(historicalName?.new ?? historicalName?.old ?? targetObject?.name ?? cachedName ?? (kind === "server" ? guild.name : undefined));
  const timestamp = Math.floor(entry.createdTimestamp / 1000);
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle("📋 " + title)
    .addFields(
      {name:"Responsável",value:actor + (entry.executorId ? "\nID: " + entry.executorId : ""),inline:false},
      {name:"Alvo",value:targetName + (targetId ? "\nID: " + targetId : ""),inline:false},
      {name:"Data e horário",value:"<t:" + timestamp + ":F> • <t:" + timestamp + ":R>",inline:false},
    );
  const details: string[] = [];
  for (const change of changes) {
    if (change.key === "$add" || change.key === "$remove") {
      embed.addFields({name:change.key === "$add" ? "Cargos adicionados" : "Cargos removidos",value:roleChangeList(change.new ?? change.old)});
      continue;
    }
    const label = labels[change.key];
    if (!label) continue;
    details.push("**" + label + "**\nAntes: " + valueFor(change.key, change.old, guild) + "\nDepois: " + valueFor(change.key, change.new, guild));
  }
  if (details.length) embed.setDescription(details.join("\n\n").slice(0, 3500));
  embed.setFooter({text:"Auditoria Discord • " + entry.id}).setTimestamp(entry.createdTimestamp);
  try { await channel.send({embeds:[embed],allowedMentions:{parse:[]}}); delivery.sent++; }
  catch { delivery.failed++; }
}
