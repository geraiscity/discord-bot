import {AuditLogEvent,Events,type Client} from "discord.js";
import type {GeraisShield} from "../security/shield.js";
import {deliverDiscordAudit} from "../audit/discord-audit.js";
import {auditQueue} from "../performance/work-queue.js";
export function registerSecurityEvents(client:Client,shield:GeraisShield):void {
  // Auditoria exata do Discord: independente do modo de punição do Shield.
  client.on(Events.GuildAuditLogEntryCreate, (entry, guild) => {
    if (!shield.isTargetGuild(guild.id)) return;
    void shield.auditWebhook(guild, entry).catch(() => console.warn("Shield: falha na análise de webhook."));
    if(!auditQueue.submit(()=>deliverDiscordAudit(entry,guild,shield.logChannelId||null))) console.warn("Auditoria: fila cheia; evento não processado.");
  });
  
  // A proteção passiva é independente dos slash commands e continua ativa 24h
  // enquanto o cliente Discord estiver conectado.
  client.on(Events.GuildMemberAdd, (member) => {
    void shield.memberJoin(member).catch((error) => console.error("Shield/entrada:", error));
  });
  client.on(Events.GuildMemberRemove, (member) => {
    void shield.memberRemove(member).catch((error) => console.error("Shield/saída-kick:", error));
  });
  client.on(Events.MessageCreate, (message) => {
    void shield.message(message).catch((error) => console.error("Shield/mensagem:", error));
  });
  client.on(Events.ChannelUpdate, (before, after) => {
    if (before.isDMBased() || after.isDMBased()) return;
    void shield.channelUpdate(before, after).catch((error) => console.error("Shield/canal:", error));
  });
  client.on(Events.ChannelCreate, (channel) => {
    if (channel.isDMBased()) return;
    void shield.creationAction(channel.guild, AuditLogEvent.ChannelCreate, channel.id, "criação de canal", async () => channel.delete("Shield: criação em massa / anti-cópia"))
      .catch((error) => console.error("Shield/criação de canal:", error));
  });
  client.on(Events.ChannelDelete, (channel) => {
    if (channel.isDMBased()) return;
    void shield.destructiveAction(channel.guild, AuditLogEvent.ChannelDelete, channel.id, "exclusão de canal")
      .catch((error) => console.error("Shield/exclusão de canal:", error));
  });
  client.on(Events.GuildRoleCreate, (role) => {
    void shield.creationAction(role.guild, AuditLogEvent.RoleCreate, role.id, "criação de cargo", async () => role.delete("Shield: criação em massa / anti-cópia"))
      .catch((error) => console.error("Shield/criação de cargo:", error));
  });
  client.on(Events.GuildRoleDelete, (role) => {
    void shield.destructiveAction(role.guild, AuditLogEvent.RoleDelete, role.id, "exclusão de cargo")
      .catch((error) => console.error("Shield/exclusão de cargo:", error));
  });
  client.on(Events.GuildBanAdd, (ban) => {
    void shield.destructiveAction(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id, "banimento")
      .catch((error) => console.error("Shield/banimento:", error));
  });
  client.on(Events.GuildMemberUpdate, (before, after) => {
    void shield.memberUpdate(before, after).catch((error) => console.error("Shield/permissão de membro:", error));
  });
  client.on(Events.InviteCreate, (invite) => {
    void shield.inviteCreate(invite).catch((error) => console.error("Shield/convite:", error));
  });
  client.on(Events.GuildRoleUpdate, (before, after) => {
    void shield.roleUpdate(before, after).catch((error) => console.error("Shield/cargo:", error));
  });
  client.on(Events.GuildUpdate, (before, after) => {
    void shield.guildUpdate(before, after).catch((error) => console.error("Shield/servidor:", error));
  });
  client.on(Events.GuildEmojiCreate, (emoji) => {
    void shield.creationAction(emoji.guild, AuditLogEvent.EmojiCreate, emoji.id, "criação de emoji", async () => emoji.delete("Shield: criação em massa / anti-cópia"))
      .catch((error) => console.error("Shield/criação de emoji:", error));
  });
  client.on(Events.GuildEmojiDelete, (emoji) => {
    void shield.destructiveAction(emoji.guild, AuditLogEvent.EmojiDelete, emoji.id, "exclusão de emoji")
      .catch((error) => console.error("Shield/exclusão de emoji:", error));
  });
  client.on(Events.GuildStickerCreate, (sticker) => {
    if (!sticker.guild) return;
    void shield.creationAction(sticker.guild, AuditLogEvent.StickerCreate, sticker.id, "criação de sticker", async () => sticker.delete("Shield: criação em massa / anti-cópia"))
      .catch((error) => console.error("Shield/criação de sticker:", error));
  });
  client.on(Events.GuildStickerDelete, (sticker) => {
    if (!sticker.guild) return;
    void shield.destructiveAction(sticker.guild, AuditLogEvent.StickerDelete, sticker.id, "exclusão de sticker")
      .catch((error) => console.error("Shield/exclusão de sticker:", error));
  });
  
}
