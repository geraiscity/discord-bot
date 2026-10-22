import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Guild,
  GuildMember,
  PermissionFlagsBits,
  Role,
} from "discord.js";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { evaluateVerificationSignals } from "./verification-core.js";
import { buildOauthAuthorizationUrl, oauthVerificationConfigured, type OAuthVerificationResult } from "./verification-oauth.js";
import { loadStateFromDatabase, recordVerificationEvent, saveStateToDatabase } from "./persistence.js";

const STATE_FILE = resolve(process.env.VERIFICATION_STATE_FILE || ".data/gerais-verification.json");
const DATABASE_STATE_KEY = `verification:${process.env.SECURITY_GUILD_ID?.trim() || process.env.DISCORD_GUILD_ID?.trim() || "default"}`;
const DANGEROUS_ROLE_PERMISSIONS =
  PermissionFlagsBits.Administrator |
  PermissionFlagsBits.ManageGuild |
  PermissionFlagsBits.ManageChannels |
  PermissionFlagsBits.ManageRoles |
  PermissionFlagsBits.BanMembers |
  PermissionFlagsBits.KickMembers |
  PermissionFlagsBits.ModerateMembers |
  PermissionFlagsBits.ManageWebhooks;

function numberEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min && value <= max ? Math.floor(value) : fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

export const verificationEnvironment = {
  minAccountDays: numberEnv("VERIFICATION_MIN_ACCOUNT_DAYS", 30, 1, 3650),
  requireMembershipScreening: boolEnv("VERIFICATION_REQUIRE_SCREENING", true),
  requireNativeDiscordVerification: boolEnv("VERIFICATION_REQUIRE_DISCORD_VERIFICATION", true),
};

export interface VerificationConfig {
  enabled: boolean;
  guildId: string;
  channelId: string;
  roleId: string;
  updatedAt: number;
}

let cachedConfig: VerificationConfig | null | undefined;

function validVerificationConfig(parsed: VerificationConfig | null): parsed is VerificationConfig {
  return Boolean(
    parsed &&
    typeof parsed.enabled === "boolean" &&
    /^\d{15,22}$/.test(parsed.guildId) &&
    /^\d{15,22}$/.test(parsed.channelId) &&
    /^\d{15,22}$/.test(parsed.roleId)
  );
}

export async function loadVerificationConfig(): Promise<VerificationConfig | null> {
  if (cachedConfig !== undefined) return cachedConfig;
  const databaseConfig = await loadStateFromDatabase<VerificationConfig>(DATABASE_STATE_KEY);
  if (validVerificationConfig(databaseConfig)) {
    cachedConfig = databaseConfig;
    return databaseConfig;
  }
  try {
    const parsed = JSON.parse(await readFile(STATE_FILE, "utf8")) as VerificationConfig;
    if (validVerificationConfig(parsed)) {
      cachedConfig = parsed;
      return parsed;
    }
  } catch {
    // Arquivo ainda não existe ou está inválido: começa sem painel configurado.
  }
  cachedConfig = null;
  return null;
}

export async function saveVerificationConfig(config: VerificationConfig | null): Promise<void> {
  cachedConfig = config;
  await mkdir(dirname(STATE_FILE), { recursive: true });
  const temp = `${STATE_FILE}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(config, null, 2), { mode: 0o600 });
  await rename(temp, STATE_FILE);
  await saveStateToDatabase(DATABASE_STATE_KEY, config);
}

export function buildVerificationPanelEmbed(role: Role): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setAuthor({ name: "GERAIS CITY RP  •  VERIFICAÇÃO" })
    .setTitle("✅ Verificação de acesso")
    .setDescription(
      "Para liberar o acesso ao servidor, confirme sua conta pelo botão abaixo.\n\n" +
      `**Requisitos automáticos**\n` +
      `• Conta do Discord criada há pelo menos **${verificationEnvironment.minAccountDays} dias**\n` +
      "• Conta não pode ser um bot\n" +
      (verificationEnvironment.requireMembershipScreening
        ? "• Triagem/Regras do Discord concluídas, quando habilitadas\n"
        : "") +
      (oauthVerificationConfigured()
        ? "• **E-mail da conta confirmado pelo OAuth2 oficial do Discord** (o bot não armazena seu endereço)\n"
        : verificationEnvironment.requireNativeDiscordVerification
          ? "• Verificação nativa do Discord ativa no servidor (exigência de conta verificada)\n"
          : "") +
      `\nAo ser aprovado, você receberá automaticamente ${role}.`,
    )
    .setFooter({ text: "Gerais City RP • Sistema automático de verificação" })
    .setTimestamp();
}

export function verificationButtonRow(disabled = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("verification_check")
      .setLabel("Verificar minha conta")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
  );
}

export function serverUsesNativeVerification(guild: Guild): boolean {
  // Discord: Low (1) ou superior impõe a verificação nativa do servidor.
  return Number(guild.verificationLevel) >= 1;
}

export interface VerificationDecision {
  ok: boolean;
  reason: string;
  accountAgeDays: number;
}

export function evaluateVerification(member: GuildMember, options?: { skipNative?: boolean }): VerificationDecision {
  return evaluateVerificationSignals({
    accountAgeMs: Math.max(0, Date.now() - member.user.createdTimestamp),
    minAccountDays: verificationEnvironment.minAccountDays,
    isBot: member.user.bot,
    pending: member.pending,
    requireScreening: verificationEnvironment.requireMembershipScreening,
    requireNativeDiscordVerification: options?.skipNative ? false : verificationEnvironment.requireNativeDiscordVerification,
    nativeDiscordVerificationEnabled: serverUsesNativeVerification(member.guild),
  });
}

async function verificationRoleForMember(member: GuildMember): Promise<{ role: Role | null; error: string | null }> {
  const config = await loadVerificationConfig();
  if (!config?.enabled || config.guildId !== member.guild.id) return { role: null, error: "A verificação automática está desativada ou não configurada." };
  const role = await member.guild.roles.fetch(config.roleId).catch(() => null);
  if (!role) return { role: null, error: "O cargo de verificação configurado não existe mais. Avise a administração." };
  if ((role.permissions.bitfield & DANGEROUS_ROLE_PERMISSIONS) !== 0n) return { role: null, error: "O cargo configurado possui permissões administrativas e foi bloqueado por segurança." };
  if (!role.editable || !member.manageable) return { role: null, error: "O bot não consegue entregar o cargo de verificação. Coloque o cargo do bot acima do cargo verificado." };
  return { role, error: null };
}

async function grantVerificationRole(member: GuildMember): Promise<{ ok: boolean; role: Role | null; message: string }> {
  const resolved = await verificationRoleForMember(member);
  if (!resolved.role) return { ok: false, role: null, message: resolved.error ?? "Cargo de verificação indisponível." };
  if (!member.roles.cache.has(resolved.role.id)) {
    await member.roles.add(resolved.role, `Gerais City RP: verificação aprovada para ${member.id}`);
  }
  return { ok: true, role: resolved.role, message: "Cargo de verificação liberado." };
}

export function exactEmailVerificationEnabled(): boolean {
  return oauthVerificationConfigured();
}

export async function handleVerificationButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "Este botão só funciona dentro do servidor.", ephemeral: true });
    return;
  }

  const config = await loadVerificationConfig();
  if (!config?.enabled || config.guildId !== interaction.guild.id) {
    await interaction.reply({ content: "A verificação automática está desativada ou ainda não foi configurada.", ephemeral: true });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    await interaction.reply({ content: "Não consegui carregar seu perfil no servidor. Tente novamente em alguns segundos.", ephemeral: true });
    return;
  }

  const usingOAuth = oauthVerificationConfigured();
  const decision = evaluateVerification(member, { skipNative: usingOAuth });
  if (!decision.ok) {
    void recordVerificationEvent({
      guildId: interaction.guild.id,
      userId: interaction.user.id,
      approved: false,
      method: usingOAuth ? "oauth_email" : "native",
      accountAgeDays: decision.accountAgeDays,
      reason: decision.reason,
    });
    await interaction.reply({
      ephemeral: true,
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle("❌ Verificação não concluída")
          .setDescription(decision.reason)
          .addFields({ name: "Idade aproximada da conta", value: `${decision.accountAgeDays} dia(s)`, inline: true })
          .setFooter({ text: "Gerais City RP • Verificação" }),
      ],
    });
    return;
  }

  if (usingOAuth) {
    const url = buildOauthAuthorizationUrl(interaction.guild.id, interaction.user.id);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("Confirmar conta no Discord")
        .setEmoji("🔐")
        .setURL(url),
    );
    await interaction.reply({
      ephemeral: true,
      embeds: [new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("🔐 Última etapa da verificação")
        .setDescription("Sua conta já passou pela checagem de idade e triagem. Clique abaixo para o Discord confirmar **a mesma conta** e se o e-mail dela está verificado.\n\n**Privacidade:** o bot não salva nem exibe seu endereço de e-mail; guarda apenas o resultado da verificação.")
        .addFields({ name: "Idade aproximada da conta", value: `${decision.accountAgeDays} dia(s)`, inline: true })],
      components: [row],
    });
    return;
  }

  const granted = await grantVerificationRole(member);
  if (!granted.ok || !granted.role) {
    await interaction.reply({ content: granted.message, ephemeral: true });
    return;
  }
  void recordVerificationEvent({ guildId: interaction.guild.id, userId: interaction.user.id, approved: true, method: "native", accountAgeDays: decision.accountAgeDays });
  await interaction.reply({
    ephemeral: true,
    embeds: [
      new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("✅ Verificação concluída!")
        .setDescription(`Tudo certo, ${interaction.user}. Sua conta atende aos requisitos automáticos e o cargo ${granted.role} foi liberado.`)
        .addFields({ name: "Idade aproximada da conta", value: `${decision.accountAgeDays} dia(s)`, inline: true })
        .setFooter({ text: "Gerais City RP • Bem-vindo!" }),
    ],
  });
}

export async function completeOAuthVerification(
  client: Client,
  guildId: string,
  userId: string,
  emailVerified: boolean,
): Promise<OAuthVerificationResult> {
  const config = await loadVerificationConfig();
  if (!config?.enabled || config.guildId !== guildId) return { ok: false, message: "O painel de verificação não está mais ativo." };
  const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return { ok: false, message: "O servidor configurado não está disponível para o bot." };
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return { ok: false, message: "Sua conta não foi encontrada dentro do servidor." };
  const decision = evaluateVerification(member, { skipNative: true });
  if (!decision.ok) {
    void recordVerificationEvent({ guildId, userId, approved: false, method: "oauth_email", accountAgeDays: decision.accountAgeDays, emailVerified, reason: decision.reason });
    return { ok: false, message: decision.reason.replace(/\*\*/g, "") };
  }
  if (!emailVerified) {
    const reason = "O Discord informou que o e-mail desta conta ainda não está verificado.";
    void recordVerificationEvent({ guildId, userId, approved: false, method: "oauth_email", accountAgeDays: decision.accountAgeDays, emailVerified: false, reason });
    return { ok: false, message: `${reason} Verifique o e-mail na sua conta do Discord e tente novamente.` };
  }
  const granted = await grantVerificationRole(member);
  if (!granted.ok) {
    void recordVerificationEvent({ guildId, userId, approved: false, method: "oauth_email", accountAgeDays: decision.accountAgeDays, emailVerified: true, reason: granted.message });
    return { ok: false, message: granted.message };
  }
  void recordVerificationEvent({ guildId, userId, approved: true, method: "oauth_email", accountAgeDays: decision.accountAgeDays, emailVerified: true });
  return { ok: true, message: `Conta aprovada: mais de ${verificationEnvironment.minAccountDays} dias e e-mail confirmado pelo Discord. Seu cargo foi liberado.` };
}

export function verificationStateFile(): string {
  return STATE_FILE;
}
