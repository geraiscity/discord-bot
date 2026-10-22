import {
  AuditLogEvent,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  Guild,
  GuildMember,
  Invite,
  Message,
  PermissionFlagsBits,
  Role,
  TextChannel,
  type GuildBasedChannel,
  type PartialGuildMember,
} from "discord.js";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  detectSensitiveContent,
  isPrivilegedPermissionChange,
  isProtectedChannel,
  scoreJoinRisk,
  shouldQuarantineRoles,
  SlidingCounter,
  type SecurityMode,
} from "./security-core.js";
import { parseTicketTopic } from "./ticket-meta.js";
import { createGuildSnapshot, loadGuildSnapshot, previewGuildRestore, restoreGuildSnapshot, snapshotFilePath } from "./security-snapshot.js";
import {
  loadRecentSecurityIncidents,
  loadStateFromDatabase,
  persistSecurityIncident,
  persistenceMode,
  saveStateToDatabase,
} from "./persistence.js";
import {
  buildVerificationPanelEmbed,
  exactEmailVerificationEnabled,
  loadVerificationConfig,
  saveVerificationConfig,
  serverUsesNativeVerification,
  verificationButtonRow,
  verificationEnvironment,
  verificationStateFile,
} from "./verification.js";

const CRITICAL_PERMISSIONS =
  PermissionFlagsBits.Administrator |
  PermissionFlagsBits.ManageGuild |
  PermissionFlagsBits.ManageChannels |
  PermissionFlagsBits.ManageRoles |
  PermissionFlagsBits.ManageWebhooks |
  PermissionFlagsBits.BanMembers |
  PermissionFlagsBits.KickMembers |
  PermissionFlagsBits.ModerateMembers |
  PermissionFlagsBits.ManageMessages |
  PermissionFlagsBits.MentionEveryone |
  PermissionFlagsBits.ViewAuditLog;

const LOCKDOWN_MILLISECONDS = 15 * 60_000;
const STATE_FILE = resolve(process.env.SECURITY_STATE_FILE || ".data/gerais-shield-final.json");
const OWNER_COMMANDS = new Set(["painel-tickets", "reaction-role", "anunciar", "divulgar", "seguranca"]);

function csv(name: string): string[] {
  return (process.env[name] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

function numberEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

export const securityEnvironment = {
  ownerId: process.env.SECURITY_OWNER_ID?.trim() ?? "",
  guildId: process.env.SECURITY_GUILD_ID?.trim() || process.env.DISCORD_GUILD_ID?.trim() || "",
  defaultEnabled: process.env.SECURITY_ENABLED !== "false",
  defaultMode: (process.env.SECURITY_MODE === "alerta" ? "alerta" : "proteger") as SecurityMode,
  defaultLogChannelId: process.env.SECURITY_ALERT_CHANNEL_ID?.trim() || process.env.SECURITY_LOG_CHANNEL_ID?.trim() || "",
  restrictManagementCommands: process.env.SECURITY_OWNER_ONLY_COMMANDS !== "false",
  blockInvites: process.env.SECURITY_BLOCK_INVITES !== "false",
  allowedInviteCodes: csv("SECURITY_ALLOWED_INVITES").map((code) => code.replace(/^.*\//, "").toLowerCase()),
  protectedTerms: csv("SECURITY_PROTECTED_TERMS").filter((term) => term.length >= 5),
  protectedChannelIds: csv("SECURITY_PRIVATE_CHANNEL_IDS"),
  strictTicketAcl: process.env.SECURITY_LOCK_TICKET_ACL !== "false",
  allowedTicketRoleIds: (process.env.MODERATION_ROLE_IDS ? csv("MODERATION_ROLE_IDS") : csv("MODERATION_ROLE_ID")),
  allowedTicketRoleNames: csv("MODERATION_ROLE_NAMES").map((name) => name.toLowerCase()),
  blockUnauthorizedInvites: boolEnv("SECURITY_BLOCK_UNAUTHORIZED_INVITES", true),
  joinThreshold: numberEnv("SECURITY_JOIN_THRESHOLD", 8, 4, 100),
  spamThreshold: numberEnv("SECURITY_SPAM_THRESHOLD", 6, 3, 30),
  destructiveThreshold: numberEnv("SECURITY_DESTRUCTIVE_THRESHOLD", 3, 2, 20),
  creationThreshold: numberEnv("SECURITY_CREATION_THRESHOLD", 6, 3, 30),
  riskThreshold: numberEnv("SECURITY_RISK_THRESHOLD", 7, 3, 20),
  quarantineMinutes: numberEnv("SECURITY_QUARANTINE_MINUTES", 15, 1, 1440),
  antiCopy: boolEnv("SECURITY_ANTI_COPY", true),
  blockMassCreation: boolEnv("SECURITY_BLOCK_MASS_CREATION", true),
  autoRestore: boolEnv("SECURITY_AUTO_RESTORE", false),
  autoSnapshots: boolEnv("SECURITY_AUTO_SNAPSHOTS", true),
  snapshotIntervalMinutes: numberEnv("SECURITY_SNAPSHOT_INTERVAL_MINUTES", 360, 30, 1440),
  allowedBotIds: csv("SECURITY_ALLOWED_BOT_IDS"),
  trustedAdminIds: csv("SECURITY_TRUSTED_ADMIN_IDS"),
};

interface Lockdown {
  guildId: string;
  previousLevel: number;
  expiresAt: number;
}

interface Incident {
  id: string;
  guildId: string;
  createdAt: number;
  title: string;
  details: string;
  urgent: boolean;
}

interface PersistedState {
  enabled?: boolean;
  mode?: SecurityMode;
  logChannelId?: string;
  lockdown?: Lockdown | null;
  allowedBotIds?: string[];
  trustedAdminIds?: string[];
  incidents?: Incident[];
  safeMode?: boolean;
}

function validSnowflake(value: string): boolean { return /^\d{15,22}$/.test(value); }

function databaseStateKey(): string {
  return `security:${securityEnvironment.guildId || "default"}`;
}

export function isDangerousSelfRole(role: Role): boolean {
  return (role.permissions.bitfield & CRITICAL_PERMISSIONS) !== 0n;
}

export class GeraisShield {
  enabled = securityEnvironment.defaultEnabled;
  mode: SecurityMode = securityEnvironment.defaultMode;
  logChannelId = securityEnvironment.defaultLogChannelId;
  safeMode = false;
  private lockdown: Lockdown | null = null;
  private readonly joins = new SlidingCounter(20_000);
  private readonly messages = new SlidingCounter(10_000);
  private readonly violations = new SlidingCounter(60_000);
  private readonly destructive = new SlidingCounter(30_000);
  private readonly creations = new SlidingCounter(30_000);
  private readonly cooldown = new Map<string, number>();
  private readonly contained = new Set<string>();
  private pendingLockdown = false;
  private readonly observedPrivateChannels = new Set<string>();
  private readonly allowedBotIds = new Set(securityEnvironment.allowedBotIds);
  private readonly trustedAdminIds = new Set(securityEnvironment.trustedAdminIds);
  private incidents: Incident[] = [];
  private saveTimer: NodeJS.Timeout | null = null;
  private readonly snapshotTimers = new Map<string, NodeJS.Timeout>();
  private lastUrgentAt = 0;
  private autoRestoreRunning = false;

  constructor(private readonly client: Client) {}

  isOwner(userId: string): boolean { return Boolean(securityEnvironment.ownerId) && userId === securityEnvironment.ownerId; }
  isTargetGuild(guildId: string): boolean { return !securityEnvironment.guildId || securityEnvironment.guildId === guildId; }
  shouldRestrictCommand(name: string): boolean { return name === "seguranca" || (securityEnvironment.restrictManagementCommands && OWNER_COMMANDS.has(name)); }
  isActive(guildId: string): boolean { return Boolean(securityEnvironment.ownerId && this.enabled && this.isTargetGuild(guildId)); }
  isAllowedBot(userId: string): boolean { return userId === this.client.user?.id || this.allowedBotIds.has(userId); }
  isTrustedAdmin(userId: string): boolean { return this.isOwner(userId) || this.trustedAdminIds.has(userId); }
  private canAutomate(): boolean { return this.mode === "proteger" && !this.safeMode; }


  panelState() {
    return {
      enabled: this.enabled,
      mode: this.mode,
      safeMode: this.safeMode,
      logChannelId: this.logChannelId || null,
      incidentCount: this.incidents.length,
      allowedBotCount: this.allowedBotIds.size,
      trustedAdminCount: this.trustedAdminIds.size,
    };
  }

  private panelDenied(userId: string, guild: Guild): string | null {
    if (!this.isOwner(userId)) return "⛔ Apenas o proprietário configurado pode controlar o Gerais Shield.";
    if (!this.isTargetGuild(guild.id)) return "O Shield só pode ser administrado no servidor configurado.";
    return null;
  }

  async panelAction(
    guild: Guild,
    userId: string,
    action: string,
    params: { targetId?: string; channelId?: string; roleId?: string; incidentId?: string } = {},
  ): Promise<{ content?: string; embeds?: EmbedBuilder[] }> {
    const denied = this.panelDenied(userId, guild);
    if (denied) return { content: denied };

    if (action === "status") {
      const perms = guild.members.me?.permissions;
      const needed = [
        ["Ver Registro de Auditoria", PermissionFlagsBits.ViewAuditLog],
        ["Gerenciar Servidor", PermissionFlagsBits.ManageGuild],
        ["Gerenciar Canais", PermissionFlagsBits.ManageChannels],
        ["Gerenciar Mensagens", PermissionFlagsBits.ManageMessages],
        ["Moderar Membros", PermissionFlagsBits.ModerateMembers],
        ["Expulsar Membros", PermissionFlagsBits.KickMembers],
        ["Banir Membros", PermissionFlagsBits.BanMembers],
        ["Gerenciar Cargos", PermissionFlagsBits.ManageRoles],
        ["Gerenciar Webhooks", PermissionFlagsBits.ManageWebhooks],
      ] as const;
      const missing = needed.filter(([, bit]) => !perms?.has(bit)).map(([name]) => name);
      const snapshot = await loadGuildSnapshot(guild.id);
      const verification = await loadVerificationConfig();
      const storage = await persistenceMode();
      return {
        embeds: [new EmbedBuilder()
          .setColor(this.enabled ? (this.safeMode ? 0xfee75c : 0x57f287) : 0x747f8d)
          .setTitle("🛡️ Gerais Shield • Status")
          .addFields(
            { name: "Estado", value: this.enabled ? "🟢 Ligado" : "🔴 Desligado", inline: true },
            { name: "Modo", value: this.mode === "proteger" ? "Proteção automática" : "Somente alertas", inline: true },
            { name: "Safe Mode", value: this.safeMode ? "🟡 ATIVO" : "Desativado", inline: true },
            { name: "Anti-cópia", value: securityEnvironment.antiCopy ? "Ativo" : "Desativado", inline: true },
            { name: "Risk Score", value: `Limite: **${securityEnvironment.riskThreshold}**`, inline: true },
            { name: "Anti-nuke", value: `${securityEnvironment.destructiveThreshold} ações / 30s`, inline: true },
            { name: "Logs", value: this.logChannelId ? `<#${this.logChannelId}>` : "DM do proprietário", inline: false },
            { name: "Snapshot", value: snapshot ? `Salvo <t:${Math.floor(snapshot.createdAt / 1000)}:R> • ${snapshot.roles.length} cargos • ${snapshot.channels.length} canais` : "Nenhum snapshot salvo", inline: false },
            { name: "Verificação", value: verification?.enabled ? `Ativa em <#${verification.channelId}> → <@&${verification.roleId}>` : "Não configurada/desativada", inline: false },
            { name: "Persistência", value: storage === "postgresql" ? "PostgreSQL + fallback local" : "Arquivo local", inline: true },
            { name: "Permissões faltantes", value: missing.length ? missing.join(", ") : "Nenhuma detectada", inline: false },
          )
          .setTimestamp()],
      };
    }

    if (action === "toggle") {
      this.enabled = !this.enabled;
      this.queueSave();
      await this.alert(guild, "Proteção alterada", `O proprietário ${this.enabled ? "ativou" : "desativou"} o Gerais Shield.`);
      return { content: `Shield ${this.enabled ? "🟢 ativado" : "🔴 desativado"}.` };
    }

    if (action === "mode") {
      this.mode = this.mode === "proteger" ? "alerta" : "proteger";
      this.queueSave();
      return { content: `Modo alterado para **${this.mode === "proteger" ? "proteção automática" : "somente alertas"}**.` };
    }

    if (action === "safe") {
      this.safeMode = !this.safeMode;
      this.queueSave();
      await this.alert(guild, "Safe Mode alterado", this.safeMode ? "Punições automáticas foram pausadas pelo proprietário." : "Punições automáticas foram reativadas pelo proprietário.", true);
      return { content: this.safeMode ? "🟡 Safe Mode ativado." : "🟢 Safe Mode desativado." };
    }

    if (action === "release") {
      const restored = await this.restoreLockdown(guild);
      return { content: restored ? "🔓 Bloqueio de raid revertido." : "Não existe bloqueio automático ativo." };
    }

    if (action === "test") {
      await this.alert(guild, "Alerta de teste", "✅ O canal privado de segurança está recebendo alertas.");
      return { content: "📣 Alerta de teste enviado." };
    }

    if (action === "incidents") {
      const latest = this.incidents.slice(-10).reverse();
      const text = latest.length
        ? latest.map((item) => `**${item.urgent ? "🚨" : "🛡️"} ${item.title}** • <t:${Math.floor(item.createdAt / 1000)}:R>\n\`${item.id}\` • ${item.details.slice(0, 220)}`).join("\n\n")
        : "Nenhum incidente armazenado.";
      return { embeds: [new EmbedBuilder().setTitle("📋 Últimos incidentes").setDescription(text.slice(0, 3900)).setColor(0x5865f2)] };
    }

    if (action === "incident") {
      const id = params.incidentId?.trim() ?? "";
      const incident = this.incidents.find((item) => item.id === id);
      if (!incident) return { content: "Incidente não encontrado no histórico local." };
      return {
        embeds: [new EmbedBuilder()
          .setColor(incident.urgent ? 0xed4245 : 0x5865f2)
          .setTitle(`${incident.urgent ? "🚨" : "🛡️"} Incidente ${incident.id}`)
          .setDescription(incident.details.slice(0, 3900))
          .addFields(
            { name: "Tipo", value: incident.title, inline: true },
            { name: "Data", value: `<t:${Math.floor(incident.createdAt / 1000)}:F>`, inline: true },
            { name: "Urgência", value: incident.urgent ? "Crítica" : "Normal", inline: true },
          )],
      };
    }

    if (action === "snapshot_create") {
      const snapshot = await createGuildSnapshot(guild);
      await this.alert(guild, "Snapshot atualizado", "O proprietário atualizou manualmente o backup estrutural do servidor.");
      return { content: `✅ Snapshot criado: **${snapshot.roles.length} cargos** e **${snapshot.channels.length} canais**.` };
    }

    if (action === "snapshot_preview") {
      const snapshot = await loadGuildSnapshot(guild.id);
      if (!snapshot) return { content: "Nenhum snapshot válido foi encontrado para este servidor." };
      const preview = await previewGuildRestore(guild, snapshot);
      const roleNames = preview.missingRoles.slice(0, 12).map((item) => `• ${item.name}`).join("\n") || "Nenhum";
      const channelNames = preview.missingChannels.slice(0, 12).map((item) => `• ${item.name}`).join("\n") || "Nenhum";
      return {
        embeds: [new EmbedBuilder()
          .setColor(0xfee75c)
          .setTitle("♻️ Prévia de restauração")
          .setDescription("Nenhuma alteração foi feita.")
          .addFields(
            { name: `Cargos ausentes (${preview.missingRoles.length})`, value: roleNames.slice(0, 1000) },
            { name: `Canais ausentes (${preview.missingChannels.length})`, value: channelNames.slice(0, 1000) },
            { name: "Tipos não suportados", value: `${preview.unsupportedChannels}`, inline: true },
          )],
      };
    }

    if (action === "snapshot_restore") {
      const snapshot = await loadGuildSnapshot(guild.id);
      if (!snapshot) return { content: "Nenhum snapshot válido foi encontrado para este servidor." };
      const report = await restoreGuildSnapshot(guild, snapshot);
      await this.alert(guild, "Restauração de snapshot executada", `Cargos: ${report.rolesCreated} • canais: ${report.channelsCreated} • ignorados: ${report.skipped}.`, true);
      return { content: `♻️ Restauração concluída. Cargos: **${report.rolesCreated}** • canais: **${report.channelsCreated}** • ignorados: **${report.skipped}**.` };
    }

    if (action === "bot_list") {
      return { content: this.allowedBotIds.size ? `Bots permitidos:\n${[...this.allowedBotIds].map((id) => `• <@${id}> (\`${id}\`)`).join("\n")}` : "Nenhum bot adicional está na allowlist." };
    }

    if (action === "bot_add" || action === "bot_remove") {
      const targetId = params.targetId?.trim() ?? "";
      if (!validSnowflake(targetId)) return { content: "Informe um ID de usuário válido." };
      const user = await this.client.users.fetch(targetId).catch(() => null);
      if (!user?.bot) return { content: "O ID informado não pertence a uma conta de bot." };
      if (action === "bot_add") this.allowedBotIds.add(targetId); else this.allowedBotIds.delete(targetId);
      this.queueSave();
      return { content: action === "bot_add" ? `✅ <@${targetId}> entrou na allowlist anti-cópia.` : `🗑️ <@${targetId}> foi removido da allowlist.` };
    }

    if (action === "team_list") {
      return { content: this.trustedAdminIds.size ? `Equipe confiável:\n${[...this.trustedAdminIds].map((id) => `• <@${id}> (\`${id}\`)`).join("\n")}` : "Nenhum administrador adicional está marcado como confiável." };
    }

    if (action === "team_add" || action === "team_remove") {
      const targetId = params.targetId?.trim() ?? "";
      if (!validSnowflake(targetId)) return { content: "Informe um ID de usuário válido." };
      const user = await this.client.users.fetch(targetId).catch(() => null);
      if (!user || user.bot) return { content: "Informe o ID de uma pessoa válida." };
      if (action === "team_add") this.trustedAdminIds.add(targetId); else this.trustedAdminIds.delete(targetId);
      this.queueSave();
      return { content: action === "team_add" ? `✅ <@${targetId}> adicionado à equipe confiável.` : `🗑️ <@${targetId}> removido da equipe confiável.` };
    }

    if (action === "log_channel") {
      const channelId = params.channelId?.trim() ?? "";
      if (!validSnowflake(channelId)) return { content: "Informe um ID de canal válido." };
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText || channel.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)) {
        return { content: "Escolha um canal de texto privado, invisível para @everyone." };
      }
      this.logChannelId = channel.id;
      this.queueSave();
      await this.alert(guild, "Canal de segurança configurado", "Este canal receberá os incidentes privados do Shield.");
      return { content: `✅ Canal de segurança configurado: <#${channel.id}>.` };
    }

    if (action === "verification_status") {
      const current = await loadVerificationConfig();
      return {
        embeds: [new EmbedBuilder()
          .setColor(current?.enabled ? 0x57f287 : 0x747f8d)
          .setTitle("✅ Verificação de membros")
          .addFields(
            { name: "Estado", value: current?.enabled ? "Ativa" : "Desativada/não configurada", inline: true },
            { name: "Idade mínima", value: `${verificationEnvironment.minAccountDays} dias`, inline: true },
            { name: "E-mail", value: exactEmailVerificationEnabled() ? "OAuth2 exato" : serverUsesNativeVerification(guild) ? "Verificação nativa" : "Sem checagem exata", inline: false },
            { name: "Canal", value: current?.channelId ? `<#${current.channelId}>` : "—", inline: true },
            { name: "Cargo", value: current?.roleId ? `<@&${current.roleId}>` : "—", inline: true },
          )],
      };
    }

    if (action === "verification_disable") {
      const current = await loadVerificationConfig();
      if (!current) return { content: "Nenhuma verificação estava configurada." };
      await saveVerificationConfig({ ...current, enabled: false, updatedAt: Date.now() });
      return { content: "⛔ Verificação automática desativada." };
    }

    if (action === "verification_publish") {
      const channelId = params.channelId?.trim() ?? "";
      const roleId = params.roleId?.trim() ?? "";
      if (!validSnowflake(channelId) || !validSnowflake(roleId)) return { content: "Informe IDs válidos de canal e cargo." };
      const channel = await guild.channels.fetch(channelId).catch(() => null);
      const role = await guild.roles.fetch(roleId).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText) return { content: "Escolha um canal de texto válido." };
      if (!role) return { content: "Não foi possível consultar o cargo." };
      if (isDangerousSelfRole(role)) return { content: "Por segurança, o cargo de verificação não pode possuir permissões administrativas/moderação." };
      if (!role.editable) return { content: "Coloque o cargo do bot acima do cargo de verificação na hierarquia." };
      if (!exactEmailVerificationEnabled() && verificationEnvironment.requireNativeDiscordVerification && !serverUsesNativeVerification(guild)) {
        return { content: "Ative pelo menos o nível Baixo de verificação nativa do Discord ou configure o OAuth2 antes de publicar." };
      }
      const me = guild.members.me;
      const permissions = me ? channel.permissionsFor(me) : null;
      if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.SendMessages) || !permissions.has(PermissionFlagsBits.EmbedLinks)) {
        return { content: "O bot precisa de Ver Canal, Enviar Mensagens e Incorporar Links nesse canal." };
      }
      await channel.send({ embeds: [buildVerificationPanelEmbed(role)], components: [verificationButtonRow()] });
      await saveVerificationConfig({ enabled: true, guildId: guild.id, channelId: channel.id, roleId: role.id, updatedAt: Date.now() });
      return { content: `✅ Painel de verificação publicado em <#${channel.id}> com o cargo <@&${role.id}>.` };
    }

    return { content: "Ação de segurança desconhecida." };
  }

  private isCooling(key: string, intervalMs: number): boolean {
    const now = Date.now();
    if ((this.cooldown.get(key) ?? 0) > now) return true;
    this.cooldown.set(key, now + intervalMs);
    if (this.cooldown.size > 3000) for (const [id, expires] of this.cooldown) if (expires < now) this.cooldown.delete(id);
    return false;
  }

  async initialize(): Promise<void> {
    let stored = await loadStateFromDatabase<PersistedState>(databaseStateKey());
    if (!stored) {
      try {
        stored = JSON.parse(await readFile(STATE_FILE, "utf8")) as PersistedState;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("Gerais Shield Final: estado anterior inválido ou inacessível:", error);
      }
    }
    if (stored) {
      if (typeof stored.enabled === "boolean") this.enabled = stored.enabled;
      if (stored.mode === "alerta" || stored.mode === "proteger") this.mode = stored.mode;
      if (typeof stored.safeMode === "boolean") this.safeMode = stored.safeMode;
      if (typeof stored.logChannelId === "string" && (!stored.logChannelId || validSnowflake(stored.logChannelId))) this.logChannelId = stored.logChannelId;
      if (stored.lockdown && typeof stored.lockdown.guildId === "string" && Number.isFinite(stored.lockdown.expiresAt)) this.lockdown = stored.lockdown;
      for (const id of stored.allowedBotIds ?? []) if (validSnowflake(id)) this.allowedBotIds.add(id);
      for (const id of stored.trustedAdminIds ?? []) if (validSnowflake(id)) this.trustedAdminIds.add(id);
      this.incidents = (stored.incidents ?? [])
        .filter((item) => item && typeof item.id === "string")
        .map((item) => ({ ...item, guildId: item.guildId || securityEnvironment.guildId || "unknown" }))
        .slice(-200);
    }
    if (securityEnvironment.guildId) {
      const databaseIncidents = await loadRecentSecurityIncidents(securityEnvironment.guildId, 200);
      if (databaseIncidents.length) this.incidents = databaseIncidents.slice(-200);
    }
    if (!securityEnvironment.ownerId || !validSnowflake(securityEnvironment.ownerId)) {
      this.enabled = false;
      console.error("GERAIS SHIELD FINAL DESATIVADO: configure SECURITY_OWNER_ID.");
    }
    if (!this.logChannelId) console.warn("Gerais Shield Final: sem canal de logs; tentarei DM ao proprietário.");

    for (const guild of this.client.guilds.cache.values()) {
      if (!this.isTargetGuild(guild.id)) continue;
      for (const channel of guild.channels.cache.values()) {
        if ("topic" in channel && typeof channel.topic === "string" && channel.topic.startsWith("ticket:")) this.observedPrivateChannels.add(channel.id);
      }
      if (securityEnvironment.autoSnapshots) this.startSnapshotLoop(guild);
    }
    if (this.lockdown) {
      const guild = this.client.guilds.cache.get(this.lockdown.guildId);
      if (guild) this.scheduleRecovery(guild);
    }
  }

  private queueSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, 1500);
    this.saveTimer.unref();
  }

  private async save(): Promise<void> {
    try {
      await mkdir(dirname(STATE_FILE), { recursive: true });
      const tempfile = `${STATE_FILE}.${process.pid}.tmp`;
      const state: PersistedState = {
        enabled: this.enabled,
        mode: this.mode,
        logChannelId: this.logChannelId,
        lockdown: this.lockdown,
        allowedBotIds: [...this.allowedBotIds],
        trustedAdminIds: [...this.trustedAdminIds],
        incidents: this.incidents.slice(-200),
        safeMode: this.safeMode,
      };
      await writeFile(tempfile, JSON.stringify(state, null, 2), { mode: 0o600 });
      await rename(tempfile, STATE_FILE);
      await saveStateToDatabase(databaseStateKey(), state);
    } catch (error) {
      console.error("Gerais Shield Final: não foi possível persistir o estado.", error);
    }
  }

  private recordIncident(guildId: string, title: string, details: string, urgent: boolean): Incident {
    const incident: Incident = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      guildId,
      createdAt: Date.now(),
      title,
      details: details.slice(0, 1500),
      urgent,
    };
    this.incidents.push(incident);
    if (this.incidents.length > 200) this.incidents.splice(0, this.incidents.length - 200);
    if (urgent) this.lastUrgentAt = Date.now();
    this.queueSave();
    void persistSecurityIncident(incident);
    return incident;
  }

  private async alert(guild: Guild, title: string, details: string, urgent = false): Promise<void> {
    const incident = this.recordIncident(guild.id, title, details, urgent);
    const embed = new EmbedBuilder()
      .setColor(urgent ? 0xed4245 : 0xfaa61a)
      .setTitle(`${urgent ? "🚨" : "🛡️"} ${title}`)
      .setDescription(details.slice(0, 3800))
      .addFields({ name: "Incidente", value: `\`${incident.id}\``, inline: true })
      .setFooter({ text: "Gerais Shield Final • logs privados • conteúdo sensível não é reproduzido" })
      .setTimestamp();
    if (this.logChannelId) {
      const channel = await guild.channels.fetch(this.logChannelId).catch(() => null);
      if (channel?.type === ChannelType.GuildText) {
        if (!channel.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)) {
          const ok = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).then(() => true).catch(() => false);
          if (ok) return;
        } else if (!this.isCooling(`public_logs:${guild.id}`, 3600_000)) {
          console.error("Gerais Shield Final: canal de logs está público. Recusando publicar nele.");
        }
      }
    }
    if (securityEnvironment.ownerId) {
      const owner = await this.client.users.fetch(securityEnvironment.ownerId).catch(() => null);
      if (owner && await owner.send({ embeds: [embed], allowedMentions: { parse: [] } }).then(() => true).catch(() => false)) return;
    }
    console.warn(`[Gerais Shield Final] ${guild.id} ${title}: alerta privado não entregue.`);
  }

  private startSnapshotLoop(guild: Guild): void {
    if (this.snapshotTimers.has(guild.id)) return;
    const interval = securityEnvironment.snapshotIntervalMinutes * 60_000;
    const takeSafeSnapshot = async () => {
      if (!this.isActive(guild.id)) return;
      if (Date.now() - this.lastUrgentAt < 10 * 60_000) return;
      const existing = await loadGuildSnapshot(guild.id);
      if (!existing || Date.now() - existing.createdAt >= interval) {
        await createGuildSnapshot(guild).catch((error) => console.error("Gerais Shield Final/snapshot automático:", error));
      }
    };
    setTimeout(() => { void takeSafeSnapshot(); }, 15_000).unref();
    const timer = setInterval(() => { void takeSafeSnapshot(); }, interval);
    timer.unref();
    this.snapshotTimers.set(guild.id, timer);
  }

  async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!this.isOwner(interaction.user.id)) {
      await interaction.reply({ content: "⛔ Apenas o proprietário configurado pode controlar o Gerais Shield.", ephemeral: true });
      return;
    }
    if (!interaction.guild || !this.isTargetGuild(interaction.guild.id)) {
      await interaction.reply({ content: "O Shield só pode ser administrado no servidor configurado.", ephemeral: true });
      return;
    }

    const group = interaction.options.getSubcommandGroup(true);
    const subcommand = interaction.options.getSubcommand(true);

    if (group === "bots") {
      if (subcommand === "listar") {
        await interaction.reply({
          content: this.allowedBotIds.size
            ? `Bots permitidos:\n${[...this.allowedBotIds].map((id) => `• <@${id}> (\`${id}\`)`).join("\n")}`
            : "Nenhum bot adicional está na allowlist.",
          ephemeral: true,
        });
        return;
      }
      const user = interaction.options.getUser("usuario", true);
      if (!user.bot) {
        await interaction.reply({ content: "Escolha uma conta de bot.", ephemeral: true });
        return;
      }
      if (subcommand === "permitir") this.allowedBotIds.add(user.id);
      else this.allowedBotIds.delete(user.id);
      this.queueSave();
      await interaction.reply({
        content: subcommand === "permitir"
          ? `✅ ${user} entrou na allowlist anti-cópia.`
          : `🗑️ ${user} foi removido da allowlist anti-cópia.`,
        ephemeral: true,
      });
      return;
    }

    if (group === "equipe") {
      if (subcommand === "listar") {
        await interaction.reply({
          content: this.trustedAdminIds.size
            ? `Administradores confiáveis:\n${[...this.trustedAdminIds].map((id) => `• <@${id}> (\`${id}\`)`).join("\n")}`
            : "Nenhum administrador adicional está marcado como confiável.",
          ephemeral: true,
        });
        return;
      }
      const user = interaction.options.getUser("usuario", true);
      if (subcommand === "adicionar") this.trustedAdminIds.add(user.id);
      else this.trustedAdminIds.delete(user.id);
      this.queueSave();
      await interaction.reply({
        content: subcommand === "adicionar"
          ? `✅ ${user} marcado como confiável para alterações administrativas isoladas.`
          : `🗑️ ${user} removido da lista de confiáveis.`,
        ephemeral: true,
      });
      return;
    }

    if (group === "geral") {
      if (subcommand === "status") {
        const perms = interaction.guild.members.me?.permissions;
        const needed = [
          ["Ver Registro de Auditoria", PermissionFlagsBits.ViewAuditLog],
          ["Gerenciar Servidor", PermissionFlagsBits.ManageGuild],
          ["Gerenciar Canais", PermissionFlagsBits.ManageChannels],
          ["Gerenciar Mensagens", PermissionFlagsBits.ManageMessages],
          ["Moderar Membros", PermissionFlagsBits.ModerateMembers],
          ["Expulsar Membros", PermissionFlagsBits.KickMembers],
          ["Banir Membros", PermissionFlagsBits.BanMembers],
          ["Gerenciar Cargos", PermissionFlagsBits.ManageRoles],
          ["Gerenciar Webhooks", PermissionFlagsBits.ManageWebhooks],
        ] as const;
        const missing = needed.filter(([, bit]) => !perms?.has(bit)).map(([name]) => name);
        const snapshot = await loadGuildSnapshot(interaction.guild.id);
        const verification = await loadVerificationConfig();
        const storage = await persistenceMode();
        await interaction.reply({
          ephemeral: true,
          embeds: [new EmbedBuilder()
            .setColor(this.enabled ? (this.safeMode ? 0xfee75c : 0x57f287) : 0x747f8d)
            .setTitle("🛡️ Gerais Shield • Central Final de Defesa")
            .addFields(
              { name: "Estado", value: this.enabled ? "🟢 Ligado" : "🔴 Desligado", inline: true },
              { name: "Modo", value: this.mode === "proteger" ? "Proteção automática" : "Somente alertas", inline: true },
              { name: "Safe Mode", value: this.safeMode ? "🟡 ATIVO — sem punições automáticas" : "Desativado", inline: true },
              { name: "Anti-cópia", value: securityEnvironment.antiCopy ? "Ativo" : "Desativado", inline: true },
              { name: "Risk Score", value: `Limite: **${securityEnvironment.riskThreshold}**`, inline: true },
              { name: "Anti-nuke", value: `${securityEnvironment.destructiveThreshold} ações / 30s`, inline: true },
              { name: "Anti-clone", value: `${securityEnvironment.creationThreshold} criações / 30s`, inline: true },
              { name: "2FA da moderação", value: Number(interaction.guild.mfaLevel) >= 1 ? "Exigido pelo servidor" : "Não exigido — recomendado ativar no Discord", inline: false },
              { name: "Logs", value: this.logChannelId ? `<#${this.logChannelId}>` : "DM do proprietário", inline: false },
              { name: "Snapshot", value: snapshot ? `Salvo <t:${Math.floor(snapshot.createdAt / 1000)}:R> • ${snapshot.roles.length} cargos • ${snapshot.channels.length} canais` : "Nenhum snapshot salvo", inline: false },
              { name: "Verificação", value: verification?.enabled ? `Ativa em <#${verification.channelId}> → <@&${verification.roleId}>` : "Não configurada/desativada", inline: false },
              { name: "Bots permitidos", value: `${this.allowedBotIds.size}`, inline: true },
              { name: "Incidentes armazenados", value: `${this.incidents.length}`, inline: true },
              { name: "Persistência", value: storage === "postgresql" ? "PostgreSQL + fallback local" : "Arquivo local (configure DATABASE_URL para PostgreSQL)", inline: false },
              { name: "Permissões faltantes", value: missing.length ? missing.join(", ") : "Nenhuma detectada", inline: false },
            )],
        });
        return;
      }

      if (subcommand === "ativar" || subcommand === "desativar") {
        this.enabled = subcommand === "ativar";
        this.queueSave();
        await interaction.reply({ content: `Shield ${this.enabled ? "ativado" : "desativado"}.`, ephemeral: true });
        await this.alert(interaction.guild, "Proteção alterada", `O proprietário ${this.enabled ? "ativou" : "desativou"} o Gerais Shield.`);
        return;
      }

      if (subcommand === "modo") {
        this.mode = interaction.options.getString("tipo", true) === "alerta" ? "alerta" : "proteger";
        this.queueSave();
        await interaction.reply({ content: `Modo alterado para **${this.mode}**.`, ephemeral: true });
        return;
      }

      if (subcommand === "safemode") {
        this.safeMode = interaction.options.getString("estado", true) === "ativar";
        this.queueSave();
        await interaction.reply({
          content: this.safeMode
            ? "🟡 Safe Mode ativado. O Shield continuará detectando e registrando incidentes, mas não aplicará punições/reversões automáticas."
            : "🟢 Safe Mode desativado. As ações automáticas voltam a seguir o modo de proteção configurado.",
          ephemeral: true,
        });
        await this.alert(interaction.guild, "Safe Mode alterado", this.safeMode ? "Punições automáticas foram pausadas pelo proprietário." : "Punições automáticas foram reativadas pelo proprietário.", true);
        return;
      }

      if (subcommand === "liberar") {
        const restored = await this.restoreLockdown(interaction.guild);
        await interaction.reply({ content: restored ? "Bloqueio de raid revertido." : "Não existe bloqueio automático ativo.", ephemeral: true });
        return;
      }

      if (subcommand === "teste") {
        await interaction.deferReply({ ephemeral: true });
        await this.alert(interaction.guild, "Alerta de teste", "✅ O canal privado de segurança está recebendo alertas.");
        await interaction.editReply("Alerta enviado. Confira o canal de segurança ou sua DM.");
        return;
      }
    }

    if (group === "logs") {
      if (subcommand === "canal") {
        const channel = interaction.options.getChannel("canal", true);
        const resolved = await interaction.guild.channels.fetch(channel.id).catch(() => null);
        if (!resolved || resolved.type !== ChannelType.GuildText || resolved.permissionsFor(interaction.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)) {
          await interaction.reply({ content: "Escolha um canal de texto privado, invisível para @everyone.", ephemeral: true });
          return;
        }
        this.logChannelId = resolved.id;
        this.queueSave();
        await interaction.reply({ content: `Canal de segurança configurado: <#${resolved.id}>.`, ephemeral: true });
        await this.alert(interaction.guild, "Canal de segurança configurado", "Este canal receberá os incidentes privados do Shield.");
        return;
      }

      if (subcommand === "incidentes") {
        const latest = this.incidents.slice(-10).reverse();
        const text = latest.length
          ? latest.map((item) => `**${item.urgent ? "🚨" : "🛡️"} ${item.title}** • <t:${Math.floor(item.createdAt / 1000)}:R>\n\`${item.id}\` • ${item.details.slice(0, 220)}`).join("\n\n")
          : "Nenhum incidente armazenado.";
        await interaction.reply({ ephemeral: true, embeds: [new EmbedBuilder().setTitle("📋 Últimos incidentes").setDescription(text.slice(0, 3900)).setColor(0x5865f2)] });
        return;
      }

      if (subcommand === "incidente") {
        const id = interaction.options.getString("id", true).trim();
        const incident = this.incidents.find((item) => item.id === id);
        if (!incident) {
          await interaction.reply({ content: "Incidente não encontrado no histórico local.", ephemeral: true });
          return;
        }
        await interaction.reply({
          ephemeral: true,
          embeds: [new EmbedBuilder()
            .setColor(incident.urgent ? 0xed4245 : 0x5865f2)
            .setTitle(`${incident.urgent ? "🚨" : "🛡️"} Incidente ${incident.id}`)
            .setDescription(incident.details.slice(0, 3900))
            .addFields(
              { name: "Tipo", value: incident.title, inline: true },
              { name: "Data", value: `<t:${Math.floor(incident.createdAt / 1000)}:F>`, inline: true },
              { name: "Urgência", value: incident.urgent ? "Crítica" : "Normal", inline: true },
            )],
        });
        return;
      }
    }

    if (group === "backup") {
      if (subcommand === "criar") {
        await interaction.deferReply({ ephemeral: true });
        const snapshot = await createGuildSnapshot(interaction.guild);
        await interaction.editReply(`✅ Snapshot protegido criado: **${snapshot.roles.length} cargos** e **${snapshot.channels.length} canais**. A versão mais recente fica em \`${snapshotFilePath()}\` e o histórico mantém até 10 versões.`);
        await this.alert(interaction.guild, "Snapshot atualizado", "O proprietário atualizou manualmente o backup estrutural do servidor.");
        return;
      }

      if (subcommand === "preview") {
        const snapshot = await loadGuildSnapshot(interaction.guild.id);
        if (!snapshot) {
          await interaction.reply({ content: "Nenhum snapshot válido foi encontrado para este servidor.", ephemeral: true });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        const preview = await previewGuildRestore(interaction.guild, snapshot);
        const roleNames = preview.missingRoles.slice(0, 12).map((item) => `• ${item.name}`).join("\n") || "Nenhum";
        const channelNames = preview.missingChannels.slice(0, 12).map((item) => `• ${item.name}`).join("\n") || "Nenhum";
        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setColor(0xfee75c)
            .setTitle("♻️ Prévia de restauração")
            .setDescription("Nenhuma alteração foi feita. Esta é apenas a comparação com o último snapshot.")
            .addFields(
              { name: `Cargos ausentes (${preview.missingRoles.length})`, value: roleNames.slice(0, 1000) },
              { name: `Canais ausentes (${preview.missingChannels.length})`, value: channelNames.slice(0, 1000) },
              { name: "Tipos não suportados", value: `${preview.unsupportedChannels}`, inline: true },
            )],
        });
        return;
      }

      if (subcommand === "restaurar") {
        if (interaction.options.getString("confirmacao", true) !== "RESTAURAR") {
          await interaction.reply({ content: "Confirmação inválida. Digite exatamente **RESTAURAR**.", ephemeral: true });
          return;
        }
        const snapshot = await loadGuildSnapshot(interaction.guild.id);
        if (!snapshot) {
          await interaction.reply({ content: "Nenhum snapshot válido foi encontrado para este servidor.", ephemeral: true });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        const report = await restoreGuildSnapshot(interaction.guild, snapshot);
        await interaction.editReply(`Restauração concluída. Cargos recriados: **${report.rolesCreated}** • canais recriados: **${report.channelsCreated}** • itens ignorados/falhos: **${report.skipped}**.`);
        await this.alert(interaction.guild, "Restauração de snapshot executada", `Cargos: ${report.rolesCreated} • canais: ${report.channelsCreated} • ignorados: ${report.skipped}.`, true);
        return;
      }
    }

    if (group === "verificacao") {
      if (subcommand === "painel") {
        const selected = interaction.options.getChannel("canal", true);
        const channel = await interaction.guild.channels.fetch(selected.id).catch(() => null);
        const selectedRole = interaction.options.getRole("cargo", true);
        const role = await interaction.guild.roles.fetch(selectedRole.id).catch(() => null);
        if (!role) {
          await interaction.reply({ content: "Não foi possível consultar o cargo no servidor. Tente novamente.", ephemeral: true });
          return;
        }
        if (!channel || channel.type !== ChannelType.GuildText) {
          await interaction.reply({ content: "Escolha um canal de texto válido.", ephemeral: true });
          return;
        }
        if (isDangerousSelfRole(role)) {
          await interaction.reply({ content: "Por segurança, o cargo de verificação não pode possuir permissões administrativas/moderação.", ephemeral: true });
          return;
        }
        if (!role.editable) {
          await interaction.reply({ content: "Coloque o cargo do bot acima do cargo de verificação na hierarquia.", ephemeral: true });
          return;
        }
        if (!exactEmailVerificationEnabled() && verificationEnvironment.requireNativeDiscordVerification && !serverUsesNativeVerification(interaction.guild)) {
          await interaction.reply({
            content: "Antes de publicar o painel, ative pelo menos o nível **Baixo** de verificação nativa do Discord em Configurações do servidor → Segurança. Isso faz o Discord aplicar sua própria exigência de conta verificada.",
            ephemeral: true,
          });
          return;
        }
        const me = interaction.guild.members.me;
        const permissions = me ? channel.permissionsFor(me) : null;
        if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.SendMessages) || !permissions.has(PermissionFlagsBits.EmbedLinks)) {
          await interaction.reply({ content: "O bot precisa de Ver Canal, Enviar Mensagens e Incorporar Links nesse canal.", ephemeral: true });
          return;
        }
        await channel.send({ embeds: [buildVerificationPanelEmbed(role)], components: [verificationButtonRow()] });
        await saveVerificationConfig({
          enabled: true,
          guildId: interaction.guild.id,
          channelId: channel.id,
          roleId: role.id,
          updatedAt: Date.now(),
        });
        await interaction.reply({ content: `✅ Painel publicado em <#${channel.id}>. Cargo aprovado: ${role}.`, ephemeral: true });
        return;
      }

      if (subcommand === "status") {
        const current = await loadVerificationConfig();
        await interaction.reply({
          ephemeral: true,
          embeds: [new EmbedBuilder()
            .setColor(current?.enabled ? 0x57f287 : 0x747f8d)
            .setTitle("✅ Verificação de membros")
            .addFields(
              { name: "Estado", value: current?.enabled ? "Ativa" : "Desativada/não configurada", inline: true },
              { name: "Idade mínima", value: `${verificationEnvironment.minAccountDays} dias`, inline: true },
              { name: "Triagem", value: verificationEnvironment.requireMembershipScreening ? "Obrigatória quando pendente" : "Não exigida pelo bot", inline: true },
              { name: "E-mail", value: exactEmailVerificationEnabled() ? "OAuth2 exato (endereço não armazenado)" : serverUsesNativeVerification(interaction.guild) ? "Protegido pela verificação nativa" : "Sem checagem exata; configure OAuth2 ou verificação nativa", inline: false },
              { name: "Verificação nativa", value: serverUsesNativeVerification(interaction.guild) ? "Ativa no servidor" : "Desativada no servidor", inline: true },
              { name: "Canal", value: current?.channelId ? `<#${current.channelId}>` : "—", inline: true },
              { name: "Cargo", value: current?.roleId ? `<@&${current.roleId}>` : "—", inline: true },
              { name: "Estado local", value: `\`${verificationStateFile()}\``, inline: false },
            )],
        });
        return;
      }

      if (subcommand === "desativar") {
        const current = await loadVerificationConfig();
        if (!current) {
          await interaction.reply({ content: "Nenhuma verificação estava configurada.", ephemeral: true });
          return;
        }
        await saveVerificationConfig({ ...current, enabled: false, updatedAt: Date.now() });
        await interaction.reply({ content: "Verificação automática desativada. O painel antigo continuará visível, mas o botão recusará novas verificações.", ephemeral: true });
        return;
      }
    }
  }

  async memberJoin(member: GuildMember): Promise<void> {
    if (!this.isActive(member.guild.id)) return;
    const count = this.joins.record(member.guild.id);

    if (member.user.bot) {
      await this.handleBotJoin(member);
      return;
    }

    const risk = scoreJoinRisk({
      accountAgeMs: Math.max(0, Date.now() - member.user.createdTimestamp),
      defaultAvatar: member.user.avatar === null,
      username: member.user.username,
      joinsInWindow: count,
      raidThreshold: securityEnvironment.joinThreshold,
      isBot: false,
      botAllowed: true,
    });
    if (risk.score >= securityEnvironment.riskThreshold && !this.isCooling(`risk:${member.guild.id}:${member.id}`, 5 * 60_000)) {
      await this.alert(member.guild, "Entrada com Risk Score elevado", `Membro: <@${member.id}> • Score: **${risk.score}**/${securityEnvironment.riskThreshold}. Sinais: ${risk.factors.join(", ") || "nenhum"}.`, count >= securityEnvironment.joinThreshold);
      if (this.canAutomate() && member.moderatable) {
        await member.timeout(securityEnvironment.quarantineMinutes * 60_000, `Gerais Shield Final: Risk Score ${risk.score}`).catch(() => undefined);
      }
    }

    if (count < securityEnvironment.joinThreshold || this.isCooling(`raid:${member.guild.id}`, 60_000)) return;
    await this.alert(member.guild, "Possível raid: entradas em massa", `${count} contas entraram em até 20 segundos. ${this.canAutomate() ? "Elevando a verificação por 15 minutos." : this.safeMode ? "Safe Mode: apenas alerta, sem restrição automática." : "Modo alerta: nenhuma restrição aplicada."}`, true);
    if (!this.canAutomate() || this.lockdown || this.pendingLockdown) return;
    this.pendingLockdown = true;
    try {
      const prior = member.guild.verificationLevel;
      if (prior < 4) {
        await member.guild.setVerificationLevel(4 as Guild["verificationLevel"], "Gerais Shield Final: possível raid");
        this.lockdown = { guildId: member.guild.id, previousLevel: prior, expiresAt: Date.now() + LOCKDOWN_MILLISECONDS };
        this.queueSave();
        this.scheduleRecovery(member.guild);
      }
    } catch (error) {
      console.error("Gerais Shield Final: falha ao elevar verificação", error);
      await this.alert(member.guild, "Falha ao aplicar proteção contra raid", "Verifique a permissão Gerenciar Servidor.", true);
    } finally { this.pendingLockdown = false; }
  }

  private async handleBotJoin(member: GuildMember): Promise<void> {
    if (!securityEnvironment.antiCopy || this.isAllowedBot(member.id)) return;
    const actorId = await this.executorFromAudit(member.guild, AuditLogEvent.BotAdd, member.id);
    await this.alert(member.guild, "Bot não autorizado detectado", `Bot: <@${member.id}> • adicionado por: ${actorId ? `<@${actorId}>` : "não identificado"}. O bot não está na allowlist anti-cópia.`, true);
    if (!this.canAutomate()) return;
    if (member.kickable) await member.kick("Gerais Shield Final: bot não autorizado / proteção anti-cópia").catch(() => undefined);
    if (actorId && !this.isOwner(actorId) && actorId !== this.client.user?.id) await this.contain(member.guild, actorId, "adição de bot não autorizado");
  }

  private scheduleRecovery(guild: Guild): void {
    const current = this.lockdown;
    if (!current || current.guildId !== guild.id) return;
    const remaining = Math.max(0, current.expiresAt - Date.now());
    setTimeout(() => { void this.restoreLockdown(guild).catch((error) => console.error("Gerais Shield Final/recuperação:", error)); }, remaining).unref();
  }

  private async restoreLockdown(guild: Guild): Promise<boolean> {
    const current = this.lockdown;
    if (!current || current.guildId !== guild.id) return false;
    try {
      const latest = await guild.fetch();
      if (latest.verificationLevel === 4) await latest.setVerificationLevel(current.previousLevel as Guild["verificationLevel"], "Gerais Shield Final: fim do bloqueio emergencial");
      this.lockdown = null;
      this.queueSave();
      await this.alert(guild, "Fim do bloqueio emergencial", "Nível de verificação anterior restaurado.");
      return true;
    } catch (error) {
      console.error("Gerais Shield Final: falha ao restaurar verificação", error);
      return false;
    }
  }

  async message(message: Message): Promise<void> {
    if (!message.inGuild() || !this.isActive(message.guildId) || message.author.bot || this.isOwner(message.author.id)) return;
    const detection = detectSensitiveContent(message.content, {
      blockInvites: securityEnvironment.blockInvites,
      allowedInviteCodes: securityEnvironment.allowedInviteCodes,
      protectedTerms: securityEnvironment.protectedTerms,
    });
    const mentions = message.mentions.users.size + message.mentions.roles.size;
    const spamCount = this.messages.record(`${message.guildId}:${message.author.id}`);
    const reason = detection ?? (mentions >= 6 ? "menções em massa" : spamCount >= securityEnvironment.spamThreshold ? "flood" : null);
    if (!reason) return;
    if (this.canAutomate()) await message.delete().catch(() => undefined);
    const violationCount = this.violations.record(`${message.guildId}:${message.author.id}`);
    if (!this.isCooling(`msg:${message.guildId}:${message.author.id}:${reason}`, 20_000)) {
      await this.alert(message.guild, "Mensagem suspeita identificada", `Autor: <@${message.author.id}> • canal: <#${message.channelId}> • tipo: **${reason}**. ${this.canAutomate() ? "Remoção solicitada." : this.safeMode ? "Safe Mode: somente alerta." : "Somente alerta."}\nO conteúdo original não é copiado para os logs.`, detection === "possivel_token");
    }
    if (this.canAutomate() && violationCount === 3) {
      const member = await message.guild.members.fetch(message.author.id).catch(() => null);
      if (member?.moderatable) await member.timeout(10 * 60_000, "Gerais Shield Final: 3 infrações em 60 segundos").catch(() => undefined);
    }
  }

  async channelUpdate(oldChannel: GuildBasedChannel, newChannel: GuildBasedChannel): Promise<void> {
    if (!this.isActive(newChannel.guild.id) || !("permissionOverwrites" in newChannel) || !("permissionOverwrites" in oldChannel)) return;
    const oldTopic = "topic" in oldChannel && typeof oldChannel.topic === "string" ? oldChannel.topic : null;
    const newTopic = "topic" in newChannel && typeof newChannel.topic === "string" ? newChannel.topic : null;
    const ticketMeta = parseTicketTopic(newTopic ?? oldTopic);
    if (ticketMeta) this.observedPrivateChannels.add(newChannel.id);
    if (!this.observedPrivateChannels.has(newChannel.id) && !isProtectedChannel(newChannel.id, newTopic, securityEnvironment.protectedChannelIds)) return;

    const everyoneVisible = newChannel.permissionsFor(newChannel.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel);
    if (everyoneVisible) {
      if (this.canAutomate()) {
        await newChannel.permissionOverwrites.edit(newChannel.guild.roles.everyone, { ViewChannel: false }, { reason: "Gerais Shield Final: canal privado não pode ficar público" })
          .then(() => this.alert(newChannel.guild, "Exposição pública revertida", `O canal <#${newChannel.id}> foi novamente ocultado de @everyone.`, true))
          .catch(() => this.alert(newChannel.guild, "RISCO: canal privado exposto", `Não consegui reocultar <#${newChannel.id}>.`, true));
      } else if (!this.isCooling(`private:${newChannel.id}`, 60_000)) {
        await this.alert(newChannel.guild, "RISCO: canal privado exposto", `<#${newChannel.id}> ficou visível para @everyone.`, true);
      }
    }

    for (const current of newChannel.permissionOverwrites.cache.values()) {
      const before = oldChannel.permissionOverwrites.cache.get(current.id);
      if (!current.allow.has(PermissionFlagsBits.ViewChannel) || before?.allow.has(PermissionFlagsBits.ViewChannel)) continue;
      if (current.id === newChannel.guild.id) continue;
      const role = newChannel.guild.roles.cache.get(current.id);
      const allowed = current.id === ticketMeta?.ownerId || ticketMeta?.addedUserIds.includes(current.id) || current.id === this.client.user?.id ||
        current.id === securityEnvironment.ownerId || securityEnvironment.allowedTicketRoleIds.includes(current.id) ||
        Boolean(role && (securityEnvironment.allowedTicketRoleNames.includes(role.name.toLowerCase()) ||
          (process.env.TICKET_AUTO_INCLUDE_ADMIN_ROLES === "true" && (role.permissions.has(PermissionFlagsBits.Administrator) || role.permissions.has(PermissionFlagsBits.ManageChannels)))));
      if (allowed) continue;
      if (this.canAutomate() && securityEnvironment.strictTicketAcl && ticketMeta) {
        await newChannel.permissionOverwrites.edit(current.id, { ViewChannel: false }, { reason: "Gerais Shield Final: ACL de ticket" })
          .then(() => this.alert(newChannel.guild, "Acesso não autorizado a ticket revertido", `O ID \`${current.id}\` perdeu a nova permissão em <#${newChannel.id}>.`, true))
          .catch(() => this.alert(newChannel.guild, "Falha ao reverter acesso de ticket", `Revise o ID \`${current.id}\` em <#${newChannel.id}>.`, true));
      }
    }
  }

  private async executorFromAudit(guild: Guild, type: AuditLogEvent, targetId: string): Promise<string | null> {
    try {
      await new Promise((done) => setTimeout(done, 900));
      const entries = await guild.fetchAuditLogs({ type, limit: 10 });
      const entry = entries.entries.find((item) => item.targetId === targetId && Date.now() - item.createdTimestamp <= 20_000);
      return entry?.executorId ?? null;
    } catch { return null; }
  }

  private async maybeAutoRestore(guild: Guild): Promise<void> {
    if (!securityEnvironment.autoRestore || this.autoRestoreRunning) return;
    const snapshot = await loadGuildSnapshot(guild.id);
    if (!snapshot) return;
    this.autoRestoreRunning = true;
    try {
      const report = await restoreGuildSnapshot(guild, snapshot);
      await this.alert(guild, "Auto-restauração anti-nuke", `Snapshot aplicado. Cargos: ${report.rolesCreated} • canais: ${report.channelsCreated} • ignorados: ${report.skipped}.`, true);
    } finally { this.autoRestoreRunning = false; }
  }

  async destructiveAction(guild: Guild, type: AuditLogEvent, targetId: string, label: string): Promise<void> {
    if (!this.isActive(guild.id)) return;
    const actorId = await this.executorFromAudit(guild, type, targetId);
    if (actorId && (this.isOwner(actorId) || actorId === this.client.user?.id)) return;
    const count = actorId ? this.destructive.record(`${guild.id}:${actorId}`) : 0;
    if (!actorId || count === 1 || count === securityEnvironment.destructiveThreshold || count % 5 === 0) {
      await this.alert(guild, `Ação administrativa: ${label}`, `Alvo: \`${targetId}\` • responsável: ${actorId ? `<@${actorId}>` : "não identificado"}.${actorId ? ` ${count} ação(ões) destrutiva(s) em 30 segundos.` : " Confira o Audit Log."}`, count >= securityEnvironment.destructiveThreshold);
    }
    if (actorId && count >= securityEnvironment.destructiveThreshold && this.canAutomate() && !this.contained.has(`${guild.id}:${actorId}`)) {
      this.contained.add(`${guild.id}:${actorId}`);
      await this.contain(guild, actorId, `${count} ações destrutivas em 30s`);
      await this.maybeAutoRestore(guild);
    }
  }

  async creationAction(guild: Guild, type: AuditLogEvent, targetId: string, label: string, remove?: () => Promise<unknown>): Promise<void> {
    if (!this.isActive(guild.id) || !securityEnvironment.antiCopy) return;
    const actorId = await this.executorFromAudit(guild, type, targetId);
    if (actorId && (this.isOwner(actorId) || actorId === this.client.user?.id)) return;
    const count = actorId ? this.creations.record(`${guild.id}:${actorId}`) : 0;
    if (!actorId || count === 1 || count === securityEnvironment.creationThreshold) {
      await this.alert(guild, `Anti-cópia: ${label}`, `Alvo: \`${targetId}\` • responsável: ${actorId ? `<@${actorId}>` : "não identificado"}.${actorId ? ` ${count} criação(ões) em 30 segundos.` : ""}`, count >= securityEnvironment.creationThreshold);
    }
    if (actorId && count >= securityEnvironment.creationThreshold && this.canAutomate()) {
      await this.contain(guild, actorId, "criação em massa / possível clone");
      if (securityEnvironment.blockMassCreation && remove) await remove().catch(() => undefined);
    }
  }

  private async contain(guild: Guild, actorId: string, reason: string): Promise<void> {
    const member = await guild.members.fetch(actorId).catch(() => null);
    if (!member || member.id === guild.ownerId) {
      await this.alert(guild, "Contenção manual necessária", `Não consigo conter <@${actorId}> automaticamente. Motivo detectado: ${reason}.`, true);
      return;
    }
    const roles = member.roles.cache.filter((role) => !role.managed && role.editable && role.id !== guild.id && shouldQuarantineRoles(role.permissions.bitfield, CRITICAL_PERMISSIONS));
    const removed: string[] = [];
    for (const role of roles.values()) {
      if (await member.roles.remove(role, `Gerais Shield Final: ${reason}`).then(() => true).catch(() => false)) removed.push(role.id);
    }
    if (member.moderatable) await member.timeout(60 * 60_000, `Gerais Shield Final: contenção (${reason})`).catch(() => undefined);
    await this.alert(guild, "Conta administrativa contida", `Responsável: <@${actorId}> • motivo: **${reason}** • cargos perigosos removidos: ${removed.length ? removed.map((id) => `<@&${id}>`).join(", ") : "nenhum removível"}.`, true);
  }

  async memberRemove(member: GuildMember | PartialGuildMember): Promise<void> {
    if (!this.isActive(member.guild.id) || member.user?.bot) return;
    const actorId = await this.executorFromAudit(member.guild, AuditLogEvent.MemberKick, member.id);
    if (!actorId) return; // Saída voluntária: não é incidente.
    if (this.isOwner(actorId) || actorId === this.client.user?.id) return;
    const count = this.destructive.record(`${member.guild.id}:${actorId}`);
    await this.alert(member.guild, "Expulsão de membro", `Membro: <@${member.id}> • executor: <@${actorId}> • ${count} expulsão(ões)/ações destrutivas recentes.`, count >= securityEnvironment.destructiveThreshold);
    if (count >= securityEnvironment.destructiveThreshold && this.canAutomate()) await this.contain(member.guild, actorId, "expulsões em massa");
  }

  async memberUpdate(oldMember: GuildMember | PartialGuildMember, newMember: GuildMember): Promise<void> {
    if (!this.isActive(newMember.guild.id) || this.isOwner(newMember.id) || newMember.id === this.client.user?.id) return;
    if (!("roles" in oldMember) || !oldMember.roles) {
      if (!this.isCooling(`partial_member:${newMember.guild.id}:${newMember.id}`, 60_000)) await this.alert(newMember.guild, "Atualização de cargo parcialmente observada", `Não havia estado anterior completo para <@${newMember.id}>; consulte o Audit Log se a mudança for sensível.`);
      return;
    }
    const newlyPrivileged = newMember.roles.cache.filter((role) => !oldMember.roles.cache.has(role.id) && shouldQuarantineRoles(role.permissions.bitfield, CRITICAL_PERMISSIONS));
    if (!newlyPrivileged.size) return;
    const actorId = await this.executorFromAudit(newMember.guild, AuditLogEvent.MemberRoleUpdate, newMember.id);
    if (actorId && this.isOwner(actorId)) return;
    await this.alert(newMember.guild, "Atribuição de cargo privilegiado", `Membro: <@${newMember.id}> • cargos: ${newlyPrivileged.map((r) => `<@&${r.id}>`).join(", ")} • executor: ${actorId ? `<@${actorId}>` : "não confirmado"}.`, true);
    if (!this.canAutomate() || !actorId || actorId === this.client.user?.id || this.isTrustedAdmin(actorId)) return;
    for (const role of newlyPrivileged.values()) {
      if (role.editable && newMember.manageable) await newMember.roles.remove(role, "Gerais Shield Final: promoção administrativa não autorizada").catch(() => undefined);
    }
  }

  async inviteCreate(invite: Invite): Promise<void> {
    if (!invite.guild || !this.isActive(invite.guild.id)) return;
    const guild = this.client.guilds.cache.get(invite.guild.id);
    if (!guild || !invite.inviterId || this.isOwner(invite.inviterId) || invite.inviterId === this.client.user?.id) return;
    await this.alert(guild, "Novo convite criado", `Criado por <@${invite.inviterId}> no canal ${invite.channelId ? `<#${invite.channelId}>` : "desconhecido"}.`);
    if (securityEnvironment.blockUnauthorizedInvites && this.canAutomate() && !this.isTrustedAdmin(invite.inviterId)) await invite.delete("Gerais Shield Final: convite não autorizado").catch(() => undefined);
  }

  async roleUpdate(oldRole: Role, newRole: Role): Promise<void> {
    if (!this.isActive(newRole.guild.id)) return;
    const dangerous = isPrivilegedPermissionChange(oldRole.permissions.bitfield, newRole.permissions.bitfield, CRITICAL_PERMISSIONS);
    const everyoneChanged = newRole.id === newRole.guild.id && oldRole.permissions.bitfield !== newRole.permissions.bitfield;
    if (!dangerous && !everyoneChanged) return;
    const actorId = await this.executorFromAudit(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
    if (actorId && this.isOwner(actorId)) return;
    await this.alert(newRole.guild, everyoneChanged ? "Permissões do @everyone alteradas" : "Elevação de permissões em cargo", `Cargo: <@&${newRole.id}> • responsável: ${actorId ? `<@${actorId}>` : "não confirmado"}.`, true);
    if (this.canAutomate() && actorId && actorId !== this.client.user?.id && !this.isTrustedAdmin(actorId)) {
      await newRole.setPermissions(oldRole.permissions, "Gerais Shield Final: alteração privilegiada não autorizada").catch(() => undefined);
    }
  }

  async guildUpdate(oldGuild: Guild, newGuild: Guild): Promise<void> {
    if (!this.isActive(newGuild.id)) return;
    const changed = oldGuild.name !== newGuild.name || oldGuild.icon !== newGuild.icon || oldGuild.verificationLevel !== newGuild.verificationLevel;
    if (!changed) return;
    const actorId = await this.executorFromAudit(newGuild, AuditLogEvent.GuildUpdate, newGuild.id);
    if (actorId && this.isOwner(actorId)) return;
    await this.alert(newGuild, "Configuração principal do servidor alterada", `Responsável: ${actorId ? `<@${actorId}>` : "não confirmado"}. Nome/ícone/verificação foram modificados.`, true);
    if (!this.canAutomate() || !actorId || actorId === this.client.user?.id || this.isTrustedAdmin(actorId)) return;
    if (oldGuild.name !== newGuild.name) await newGuild.setName(oldGuild.name, "Gerais Shield Final: reversão de nome").catch(() => undefined);
    if (oldGuild.verificationLevel !== newGuild.verificationLevel) await newGuild.setVerificationLevel(oldGuild.verificationLevel, "Gerais Shield Final: reversão de verificação").catch(() => undefined);
    if (oldGuild.icon !== newGuild.icon) {
      if (!oldGuild.icon) await newGuild.setIcon(null, "Gerais Shield Final: reversão de ícone").catch(() => undefined);
      else {
        const url = oldGuild.iconURL({ extension: "png", size: 512 });
        if (url) {
          const buffer = await fetch(url, { signal: AbortSignal.timeout(8000) }).then(async (r) => r.ok ? Buffer.from(await r.arrayBuffer()) : null).catch(() => null);
          if (buffer) await newGuild.setIcon(buffer, "Gerais Shield Final: reversão de ícone").catch(() => undefined);
        }
      }
    }
  }

  async webhookUpdate(channel: TextChannel): Promise<void> {
    if (!this.isActive(channel.guild.id) || this.isCooling(`webhook:${channel.id}`, 5000)) return;
    let recent: { type: AuditLogEvent; actorId: string | null; targetId: string | null } | null = null;
    for (const type of [AuditLogEvent.WebhookCreate, AuditLogEvent.WebhookUpdate, AuditLogEvent.WebhookDelete]) {
      try {
        const logs = await channel.guild.fetchAuditLogs({ type, limit: 5 });
        const entry = logs.entries.find((item) => Date.now() - item.createdTimestamp <= 15_000);
        if (entry) { recent = { type, actorId: entry.executorId ?? null, targetId: entry.targetId ?? null }; break; }
      } catch { /* sem auditoria */ }
    }
    if (recent?.actorId && this.isOwner(recent.actorId)) return;
    await this.alert(channel.guild, "Alteração em webhook", `Canal: <#${channel.id}> • executor: ${recent?.actorId ? `<@${recent.actorId}>` : "não identificado"} • tipo: ${recent?.type ?? "desconhecido"}.`, true);
    if (this.canAutomate() && recent?.type === AuditLogEvent.WebhookCreate && recent.targetId && recent.actorId && !this.isTrustedAdmin(recent.actorId)) {
      const hooks = await channel.fetchWebhooks().catch(() => null);
      const hook = hooks?.get(recent.targetId);
      if (hook) await hook.delete("Gerais Shield Final: webhook não autorizado").catch(() => undefined);
    }
  }

  async integrationsUpdate(guild: Guild): Promise<void> {
    if (!this.isActive(guild.id) || this.isCooling(`integration:${guild.id}`, 10_000)) return;
    let actorId: string | null = null;
    for (const type of [AuditLogEvent.IntegrationCreate, AuditLogEvent.IntegrationUpdate, AuditLogEvent.IntegrationDelete]) {
      try {
        const logs = await guild.fetchAuditLogs({ type, limit: 5 });
        const entry = logs.entries.find((item) => Date.now() - item.createdTimestamp <= 15_000);
        if (entry) { actorId = entry.executorId ?? null; break; }
      } catch { /* ignore */ }
    }
    if (actorId && this.isOwner(actorId)) return;
    await this.alert(guild, "Integração do servidor alterada", `Executor: ${actorId ? `<@${actorId}>` : "não identificado"}. Revise Apps, integrações e bots autorizados.`, true);
  }
}
