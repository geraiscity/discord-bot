import {
  ActionRowBuilder,
  AuditLogEvent,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  ContainerBuilder,
  EmbedBuilder,
  FileUploadBuilder,
  LabelBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  Events,
  GatewayIntentBits,
  GuildBasedChannel,
  Interaction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  Message,
  ModalBuilder,
  ModalSubmitInteraction,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  REST,
  Routes,
  TextChannel,
  type InteractionReplyOptions,
  type InteractionEditReplyOptions,
  type MessageCreateOptions,
} from "discord.js";
import express from "express";
import { buildMediaPromo } from "./media-promo.js";
import { GeraisShield, isDangerousSelfRole, securityEnvironment } from "./security.js";
import { getMediaPromoInfo, type MediaPromoKind } from "./media-promo-utils.js";
import { commandDefinitions } from "./commands.js";
import { syncBotCommands, type RegisteredGlobalCommand } from "./command-sync.js";
import { colorFromOption, config } from "./config.js";
import { buildTicketTopic, parseTicketTopic, type TicketMeta } from "./ticket-meta.js";
import {
  MAX_ANNOUNCEMENT_IMAGE_BYTES,
  MAX_ANNOUNCEMENT_MEDIA_BYTES,
  MAX_ANNOUNCEMENT_MEDIA_ITEMS,
  announcementImageName,
  announcementMediaName,
  isAcceptedAnnouncementMedia,
  isAcceptedImage,
} from "./announcement-utils.js";
import { completeOAuthVerification, handleVerificationButton } from "./verification.js";
import { oauthVerificationConfigured, registerVerificationOAuthRoutes } from "./verification-oauth.js";
import { closePersistence, persistenceMode, recordTicketEvent, recordTicketRating } from "./persistence.js";
import { buildAdminPanel, buildAdminSecurityConfigPanel, type AdminSection } from "./admin-panel.js";
import { getRobloxBridgeStats, registerRobloxBridgeRoutes, robloxBridgeConfigured } from "./roblox-bridge.js";
import {
  buildRulesEmbed,
  buildTicketPanelEmbed,
} from "./embeds.js";

type TicketType = "bugs" | "suporte" | "denuncias" | "compras" | "parcerias";

const ticketTypes: Array<{
  id: TicketType;
  label: string;
  emoji: string;
  description: string;
}> = [
  {
    id: "bugs",
    label: "Bugs",
    emoji: "🐛",
    description: "Relate um problema técnico.",
  },
  {
    id: "suporte",
    label: "Suporte Geral",
    emoji: "🛠️",
    description: "Tire dúvidas e peça ajuda.",
  },
  {
    id: "denuncias",
    label: "Denúncias",
    emoji: "⚠️",
    description: "Envie uma denúncia com provas.",
  },
  {
    id: "compras",
    label: "Compras",
    emoji: "🛒",
    description: "Atendimento para produtos e compras do Gerais City.",
  },
  {
    id: "parcerias",
    label: "Parcerias",
    emoji: "🤝",
    description: "Fale sobre oportunidades de parceria.",
  },
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildExpressions,
    GatewayIntentBits.GuildIntegrations,
    ...(securityEnvironment.ownerId ? [
      GatewayIntentBits.GuildMembers,       // Privilegiada: habilitar no Developer Portal
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,     // Privilegiada: habilitar no Developer Portal
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildWebhooks,
      GatewayIntentBits.GuildInvites,
    ] : []),
  ],
});
const shield = new GeraisShield(client);

// Evita criar dois canais quando a mesma pessoa aperta o botão várias vezes.
const openingTickets = new Set<string>();


type PendingAnnouncement = {
  guildId: string;
  channelId: string;
  title: string;
  message: string;
  color: number;
  roleId: string | null;
  createdAt: number;
};

const pendingAnnouncements = new Map<string, PendingAnnouncement>();

function announcementKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

function announcementMediaModal(): ModalBuilder {
  const upload = new FileUploadBuilder()
    .setCustomId("anuncio_midias")
    .setMinValues(0)
    .setMaxValues(MAX_ANNOUNCEMENT_MEDIA_ITEMS)
    .setRequired(false);

  const label = new LabelBuilder()
    .setLabel("Fotos / vídeo (opcional)")
    .setDescription("Selecione até 10 imagens, GIFs ou vídeos de uma vez.")
    .setFileUploadComponent(upload);

  return new ModalBuilder()
    .setCustomId("announcement_media_modal")
    .setTitle("Mídia do anúncio")
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("Escolha as mídias abaixo. Você pode selecionar vários arquivos da galeria no mesmo campo."),
    )
    .addLabelComponents(label);
}

function securitySingleIdModal(customId: string, title: string, label: string, placeholder: string): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId("valor")
    .setLabel(label)
    .setPlaceholder(placeholder)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(30);
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

function securityVerificationModal(): ModalBuilder {
  const channel = new TextInputBuilder()
    .setCustomId("canal")
    .setLabel("ID do canal de verificação")
    .setPlaceholder("Ex.: 123456789012345678")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(30);
  const role = new TextInputBuilder()
    .setCustomId("cargo")
    .setLabel("ID do cargo entregue")
    .setPlaceholder("Ex.: 123456789012345678")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(30);
  return new ModalBuilder()
    .setCustomId("shield_cfg_verification_publish")
    .setTitle("Publicar verificação")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(channel),
      new ActionRowBuilder<TextInputBuilder>().addComponents(role),
    );
}

type RepliableInteraction = ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction;
type ReplyOptions = InteractionReplyOptions;

async function respond(
  interaction: RepliableInteraction,
  options: ReplyOptions,
) {
  if (interaction.deferred) {
    // Reply visibility is fixed on the initial response; editReply must not
    // receive flags such as Ephemeral.
    const { flags: _flags, ephemeral: _ephemeral, ...editOptions } = options;
    return interaction.editReply(editOptions as InteractionEditReplyOptions);
  }

  if (interaction.replied) {
    return interaction.followUp(options);
  }

  return interaction.reply(options);
}

async function fetchInteractionTextChannel(interaction: RepliableInteraction): Promise<TextChannel | null> {
  const guild = interaction.guild;
  const channelId = interaction.channelId;
  if (!guild || !channelId) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  return channel?.type === ChannelType.GuildText ? channel : null;
}

function ticketPanelButtons(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    ticketTypes.map((ticket) =>
      new ButtonBuilder()
        .setCustomId(`ticket_open:${ticket.id}`)
        .setLabel(ticket.label)
        .setEmoji(ticket.emoji)
        .setStyle(
          ticket.id === "denuncias" ? ButtonStyle.Danger : ticket.id === "compras" ? ButtonStyle.Success : ButtonStyle.Primary,
        ),
    ),
  );
}

function evidenceButtons(disabled = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("denuncia_provas:sim")
      .setLabel("Sim, tenho provas")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId("denuncia_provas:nao")
      .setLabel("Não tenho provas")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

function ticketActionButtons(disabled = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("ticket_claim").setLabel("Assumir").setEmoji("👮").setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId("ticket_add").setLabel("Adicionar pessoa").setEmoji("➕").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId("ticket_remove").setLabel("Remover pessoa").setEmoji("➖").setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId("ticket_close").setLabel("Fechar").setEmoji("🔒").setStyle(ButtonStyle.Danger).setDisabled(disabled),
  );
}

function ticketCloseConfirmButtons(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("ticket_close_confirm").setLabel("Confirmar fechamento").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("ticket_close_cancel").setLabel("Cancelar").setStyle(ButtonStyle.Secondary),
  );
}

function ticketRatingButtons(guildId: string, ticketId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...[1, 2, 3, 4, 5].map((rating) =>
      new ButtonBuilder().setCustomId(`ticket_rate:${guildId}:${ticketId}:${rating}`).setLabel(`${rating} ⭐`).setStyle(ButtonStyle.Secondary),
    ),
  );
}

function rolePanelButtons(
  roles: Array<{ id: string; label: string }>,
): ActionRowBuilder<ButtonBuilder>[] {
  const buttons = roles.map(({ id, label }, index) =>
    new ButtonBuilder()
      .setCustomId(`role_toggle:${id}`)
      .setLabel(label.slice(0, 80))
      .setEmoji("✨")
      .setStyle(ButtonStyle.Secondary),
  );

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let index = 0; index < buttons.length; index += 3) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        buttons.slice(index, index + 3),
      ),
    );
  }
  return rows;
}

const sendPermissionRequirements = [
  {
    flag: PermissionFlagsBits.ViewChannel,
    label: "Ver Canal",
  },
  {
    flag: PermissionFlagsBits.SendMessages,
    label: "Enviar Mensagens",
  },
  {
    flag: PermissionFlagsBits.EmbedLinks,
    label: "Incorporar Links",
  },
];

async function ensureChannelAccess(
  interaction: ChatInputCommandInteraction,
  channel: GuildBasedChannel,
  requiresAttachment = false,
): Promise<boolean> {
  const botMember = interaction.guild?.members.me;
  const permissions = botMember ? channel.permissionsFor(botMember) : null;
  const requirements = requiresAttachment
    ? [...sendPermissionRequirements, { flag: PermissionFlagsBits.AttachFiles, label: "Anexar Arquivos" }]
    : sendPermissionRequirements;
  const missing = requirements
    .filter((requirement) => !permissions?.has(requirement.flag))
    .map((requirement) => requirement.label);

  if (missing.length === 0) {
    return true;
  }

  await respond(interaction, {
    content:
      `O Discord está bloqueando o acesso do bot em <#${channel.id}>. ` +
      `Permissões efetivas faltando: ${missing.join(", ")}. ` +
      "Confira as permissões específicas do canal e da categoria.",
    ephemeral: true,
  });
  return false;
}

function channelNameFor(type: TicketType, username: string): string {
  const safeUsername = username
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 24);
  return `ticket-${type}-${safeUsername}`;
}

function existingTicket(guildId: string, userId: string, type: TicketType) {
  const guild = client.guilds.cache.get(guildId);
  return guild?.channels.cache.find((channel) => {
    if (channel.type !== ChannelType.GuildText) return false;
    const meta = parseTicketTopic(channel.topic);
    return meta?.ownerId === userId && meta.type === type;
  });
}

function moderationRoleIds(guild: NonNullable<Interaction["guild"]>): string[] {
  const configuredIds = new Set(config.moderationRoleIds);
  const configuredNames = new Set(
    config.moderationRoleNames.map((name) => name.toLowerCase()),
  );

  return guild.roles.cache
    .filter(
      (role) =>
        role.id !== guild.id &&
        (configuredIds.has(role.id) ||
          configuredNames.has(role.name.toLowerCase()) ||
          (process.env.TICKET_AUTO_INCLUDE_ADMIN_ROLES === "true" &&
            (role.permissions.has(PermissionFlagsBits.ManageChannels) ||
             role.permissions.has(PermissionFlagsBits.Administrator)))),
    )
    .map((role) => role.id);
}

const ticketBotAccess = {
  ViewChannel: true,
  SendMessages: true,
  ReadMessageHistory: true,
  EmbedLinks: true,
  ManageChannels: true,
  AttachFiles: true,
};

const ticketMemberAccess = {
  ViewChannel: true,
  SendMessages: true,
  ReadMessageHistory: true,
  AttachFiles: true,
};

async function repairTicketPermissions(
  channel: TextChannel,
  guild: NonNullable<Interaction["guild"]>,
  userId: string,
  staffRoleIds: string[],
) {
  await channel.permissionOverwrites.edit(guild.roles.everyone.id, {
    ViewChannel: false,
  });
  await channel.permissionOverwrites.edit(channel.client.user.id, ticketBotAccess);
  await channel.permissionOverwrites.edit(userId, ticketMemberAccess);
  await Promise.all(
    staffRoleIds.map((roleId) =>
      channel.permissionOverwrites.edit(roleId, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        EmbedLinks: true,
        ManageChannels: true,
      }),
    ),
  );
}

async function ensureTicketRules(channel: TextChannel) {
  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const alreadyHasRules = messages?.some((message) =>
    message.embeds.some((embed) => embed.title === "Regras do atendimento"),
  );

  if (!alreadyHasRules) {
    await channel.send({ embeds: [buildRulesEmbed()] });
  }
}

function ticketMetaFromChannel(channel: TextChannel): TicketMeta | null {
  return parseTicketTopic(channel.topic);
}

function isTicketStaff(guild: NonNullable<Interaction["guild"]>, userId: string): boolean {
  if (shield.isOwner(userId) || guild.ownerId === userId) return true;
  const member = guild.members.cache.get(userId);
  if (!member) return false;
  const staff = new Set(moderationRoleIds(guild));
  return member.roles.cache.some((role) => staff.has(role.id));
}

function canManageTicketMembers(guild: NonNullable<Interaction["guild"]>, userId: string, meta: TicketMeta): boolean {
  return isTicketStaff(guild, userId) || (process.env.TICKET_OWNER_CAN_MANAGE_MEMBERS === "true" && meta.ownerId === userId);
}

function canUseAdminPanel(interaction: ChatInputCommandInteraction | ButtonInteraction): boolean {
  if (!interaction.guild) return false;
  if (shield.isOwner(interaction.user.id) || interaction.guild.ownerId === interaction.user.id) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  return isTicketStaff(interaction.guild, interaction.user.id);
}

function parseUserReference(value: string): string | null {
  const normalized = value.trim().replace(/[<@!>]/g, "");
  return /^\d{15,22}$/.test(normalized) ? normalized : null;
}

function parseSnowflakeReference(value: string): string | null {
  const match = value.match(/\d{15,22}/);
  return match?.[0] ?? null;
}

async function updateTicketTopic(channel: TextChannel, meta: TicketMeta): Promise<void> {
  await channel.setTopic(buildTicketTopic(meta), "Gerais Tickets Final: metadados do atendimento");
}

async function buildTicketTranscript(channel: TextChannel, maxMessages = 500): Promise<Buffer> {
  const messages: Message[] = [];
  let before: string | undefined;
  while (messages.length < maxMessages) {
    const page = await channel.messages.fetch({ limit: Math.min(100, maxMessages - messages.length), before }).catch(() => null);
    if (!page?.size) break;
    messages.push(...page.values());
    before = page.last()?.id;
    if (page.size < 100) break;
  }
  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const lines = [
    `Gerais City RP • Transcript de Ticket`,
    `Canal: #${channel.name} (${channel.id})`,
    `Servidor: ${channel.guild.name} (${channel.guild.id})`,
    `Gerado em: ${new Date().toISOString()}`,
    "=".repeat(72),
  ];
  for (const message of messages) {
    const content = message.content || "[sem texto]";
    const attachments = [...message.attachments.values()].map((item) => item.url);
    lines.push(`[${new Date(message.createdTimestamp).toISOString()}] ${message.author.tag} (${message.author.id}): ${content}`);
    if (attachments.length) lines.push(`  Anexos: ${attachments.join(" | ")}`);
  }
  return Buffer.from(lines.join("\n"), "utf8");
}

async function privateTicketLogChannel(guild: NonNullable<Interaction["guild"]>): Promise<TextChannel | null> {
  const id = process.env.TRANSCRIPT_CHANNEL_ID?.trim() || process.env.TICKET_LOG_CHANNEL_ID?.trim();
  if (!id) return null;
  const channel = await guild.channels.fetch(id).catch(() => null);
  if (channel?.type !== ChannelType.GuildText) return null;
  if (channel.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)) return null;
  return channel;
}

async function privateGeneralLogChannel(guild: NonNullable<Interaction["guild"]>): Promise<TextChannel | null> {
  const id = process.env.GERAIS_LOG_CHANNEL_ID?.trim() || process.env.TICKET_LOG_CHANNEL_ID?.trim();
  if (!id) return null;
  const channel = await guild.channels.fetch(id).catch(() => null);
  if (channel?.type !== ChannelType.GuildText) return null;
  return channel;
}

async function sendTicketLog(guild: NonNullable<Interaction["guild"]>, options: MessageCreateOptions): Promise<boolean> {
  const log = await privateTicketLogChannel(guild);
  if (log && await log.send(options).then(() => true).catch(() => false)) return true;
  if (securityEnvironment.ownerId) {
    const owner = await client.users.fetch(securityEnvironment.ownerId).catch(() => null);
    if (owner && await owner.send(options).then(() => true).catch(() => false)) return true;
  }
  return false;
}

async function sendGeneralLog(guild: NonNullable<Interaction["guild"]>, options: MessageCreateOptions): Promise<boolean> {
  const log = await privateGeneralLogChannel(guild);
  return log ? log.send(options).then(() => true).catch(() => false) : false;
}

async function claimTicket(channel: TextChannel, userId: string): Promise<string> {
  const meta = ticketMetaFromChannel(channel);
  if (!meta) return "Este canal não é um ticket reconhecido.";
  if (!isTicketStaff(channel.guild, userId)) return "Apenas a equipe pode assumir tickets.";
  meta.claimedBy = userId;
  await updateTicketTopic(channel, meta);
  void recordTicketEvent({ guildId: channel.guild.id, channelId: channel.id, ownerId: meta.ownerId, actorId: userId, action: "claim" });
  await channel.send({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("👮 Atendimento assumido").setDescription(`<@${userId}> assumiu este ticket.`).setTimestamp()] });
  void sendGeneralLog(channel.guild, { embeds: [new EmbedBuilder().setColor(0x57f287).setAuthor({ name: "GERAIS CITY • TICKET" }).setTitle("Ticket assumido").setDescription(`<#${channel.id}> foi assumido por <@${userId}>.`).setFooter({ text: `Canal ${channel.id}` }).setTimestamp()], allowedMentions: { parse: [] } });
  return "Ticket assumido com sucesso.";
}

async function addTicketMember(channel: TextChannel, actorId: string, userId: string): Promise<string> {
  const meta = ticketMetaFromChannel(channel);
  if (!meta) return "Este canal não é um ticket reconhecido.";
  if (!canManageTicketMembers(channel.guild, actorId, meta)) return "Somente a equipe autorizada pode adicionar pessoas a este ticket.";
  if (userId === meta.ownerId || userId === client.user?.id) return "Essa pessoa já possui acesso essencial ao ticket.";
  if (meta.addedUserIds.includes(userId)) return "Essa pessoa já foi adicionada ao ticket.";
  const member = await channel.guild.members.fetch(userId).catch(() => null);
  if (!member) return "Não encontrei essa pessoa no servidor.";
  meta.addedUserIds.push(userId);
  await channel.permissionOverwrites.edit(userId, ticketMemberAccess, { reason: `Ticket Final: membro adicionado por ${actorId}` });
  await updateTicketTopic(channel, meta);
  void recordTicketEvent({ guildId: channel.guild.id, channelId: channel.id, ownerId: meta.ownerId, actorId, action: "member_add", payload: { userId } });
  await channel.send({ content: `➕ <@${userId}> foi adicionado ao atendimento por <@${actorId}>.`, allowedMentions: { users: [userId, actorId] } });
  return `<@${userId}> foi adicionado ao ticket.`;
}

async function removeTicketMember(channel: TextChannel, actorId: string, userId: string): Promise<string> {
  const meta = ticketMetaFromChannel(channel);
  if (!meta) return "Este canal não é um ticket reconhecido.";
  if (!canManageTicketMembers(channel.guild, actorId, meta)) return "Somente a equipe autorizada pode remover pessoas deste ticket.";
  if (userId === meta.ownerId) return "O titular do ticket não pode ser removido. Feche o ticket se necessário.";
  if (!meta.addedUserIds.includes(userId)) return "Essa pessoa não está na lista de convidados deste ticket.";
  meta.addedUserIds = meta.addedUserIds.filter((id) => id !== userId);
  await channel.permissionOverwrites.delete(userId, `Ticket Final: membro removido por ${actorId}`).catch(async () => {
    await channel.permissionOverwrites.edit(userId, { ViewChannel: false }, { reason: `Ticket Final: membro removido por ${actorId}` });
  });
  await updateTicketTopic(channel, meta);
  void recordTicketEvent({ guildId: channel.guild.id, channelId: channel.id, ownerId: meta.ownerId, actorId, action: "member_remove", payload: { userId } });
  await channel.send({ content: `➖ <@${userId}> foi removido do atendimento por <@${actorId}>.`, allowedMentions: { users: [userId, actorId] } });
  return `<@${userId}> foi removido do ticket.`;
}

async function closeTicket(channel: TextChannel, actorId: string): Promise<void> {
  const meta = ticketMetaFromChannel(channel);
  if (!meta) throw new Error("Este canal não é um ticket reconhecido.");
  if (actorId !== meta.ownerId && !isTicketStaff(channel.guild, actorId)) throw new Error("Somente o titular ou a equipe pode fechar este ticket.");
  void recordTicketEvent({ guildId: channel.guild.id, channelId: channel.id, ownerId: meta.ownerId, actorId, action: "close_requested", payload: { claimedBy: meta.claimedBy ?? null, addedUserIds: meta.addedUserIds } });
  const transcript = await buildTicketTranscript(channel);
  const transcriptFile = new AttachmentBuilder(transcript, { name: `transcript-${channel.id}.txt` });
  const logged = await sendTicketLog(channel.guild, {
    embeds: [new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle("🔒 Ticket encerrado")
      .addFields(
        { name: "Canal", value: `${channel.name} • \`${channel.id}\``, inline: false },
        { name: "Titular", value: `<@${meta.ownerId}>`, inline: true },
        { name: "Fechado por", value: `<@${actorId}>`, inline: true },
        { name: "Atendente", value: meta.claimedBy ? `<@${meta.claimedBy}>` : "Não assumido", inline: true },
      )
      .setTimestamp()],
    files: [transcriptFile],
    allowedMentions: { parse: [] },
  });

  void sendGeneralLog(channel.guild, {
    embeds: [new EmbedBuilder()
      .setColor(0xed4245)
      .setAuthor({ name: "GERAIS CITY • TICKET" })
      .setTitle("Ticket encerrado")
      .addFields(
        { name: "Titular", value: `<@${meta.ownerId}>`, inline: true },
        { name: "Fechado por", value: `<@${actorId}>`, inline: true },
        { name: "Categoria", value: meta.type, inline: true },
        { name: "Transcript", value: logged ? "Salvo em transcripts" : "Falha ao salvar — confira configuração", inline: false },
      )
      .setFooter({ text: `Ticket ${channel.id}` })
      .setTimestamp()],
    allowedMentions: { parse: [] },
  });

  const owner = await client.users.fetch(meta.ownerId).catch(() => null);
  if (owner) {
    await owner.send({
      embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("⭐ Como foi seu atendimento?").setDescription("Seu ticket no Gerais City RP foi encerrado. Se quiser, avalie o atendimento abaixo.")],
      components: [ticketRatingButtons(channel.guild.id, channel.id)],
    }).catch(() => undefined);
  }

  await channel.send({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("🔒 Atendimento encerrado").setDescription(`Fechado por <@${actorId}>. ${logged ? "O transcript foi salvo no canal de transcripts." : "Não consegui entregar o transcript; confira TRANSCRIPT_CHANNEL_ID."}\nEste canal será removido em alguns segundos.`)] }).catch(() => undefined);
  setTimeout(() => { void channel.delete(`Ticket Final encerrado por ${actorId}`).catch(() => undefined); }, 3000).unref();
}

function memberModal(action: "add" | "remove"): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(`ticket_member_modal:${action}`).setTitle(action === "add" ? "Adicionar pessoa ao ticket" : "Remover pessoa do ticket");
  const input = new TextInputBuilder().setCustomId("usuario").setLabel("ID ou menção do usuário").setPlaceholder("123456789012345678 ou @usuário").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(40);
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  return modal;
}

function purchaseTicketModal(): ModalBuilder {
  const modal = new ModalBuilder().setCustomId("ticket_purchase_modal").setTitle("Atendimento de Compras");
  const product = new TextInputBuilder().setCustomId("produto").setLabel("Produto ou serviço").setPlaceholder("Ex.: VIP, veículo, item...").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100);
  const robloxUser = new TextInputBuilder().setCustomId("roblox_usuario").setLabel("Seu usuário no Roblox").setPlaceholder("Nome de usuário no Roblox").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(40);
  const details = new TextInputBuilder().setCustomId("detalhes").setLabel("Detalhes da solicitação").setPlaceholder("Explique o que deseja comprar ou o problema com a compra.").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(900);
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(product),
    new ActionRowBuilder<TextInputBuilder>().addComponents(robloxUser),
    new ActionRowBuilder<TextInputBuilder>().addComponents(details),
  );
  return modal;
}

type PurchaseTicketData = { product: string; robloxUser: string; details: string };

async function createTicket(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  type: TicketType,
  purchaseData?: PurchaseTicketData,
) {
  if (!interaction.guild || !interaction.member) {
    await respond(interaction, {
      content: "Este botão só pode ser usado dentro de um servidor.",
      ephemeral: true,
    });
    return;
  }

  const staffRoleIds = moderationRoleIds(interaction.guild);
  const existing = existingTicket(interaction.guild.id, interaction.user.id, type);
  if (existing) {
    await repairTicketPermissions(
      existing as TextChannel,
      interaction.guild,
      interaction.user.id,
      staffRoleIds,
    );
    await ensureTicketRules(existing as TextChannel);
    const previousMeta = ticketMetaFromChannel(existing as TextChannel);
    if (previousMeta) {
      await Promise.all(previousMeta.addedUserIds.map((id) => (existing as TextChannel).permissionOverwrites.edit(id, ticketMemberAccess).catch(() => undefined)));
    }
    await respond(interaction, {
      content: `Você já possui um ticket aberto: <#${existing.id}>.`,
      ephemeral: true,
    });
    return;
  }

  const categoryById = config.ticketCategoryId
    ? await interaction.guild.channels.fetch(config.ticketCategoryId).catch(() => null)
    : null;
  const categoryByName = config.ticketCategoryName
    ? interaction.guild.channels.cache.find(
        (channel) =>
          channel.type === ChannelType.GuildCategory &&
          channel.name.toLowerCase() === config.ticketCategoryName!.toLowerCase(),
      )
    : null;
  const category = categoryById ?? categoryByName;
  const categoryIsValid =
    !category || category.type === ChannelType.GuildCategory;

  if (!categoryIsValid) {
    await respond(interaction, {
      content:
        "A categoria configurada não foi encontrada ou não é uma categoria válida. Confira TICKET_CATEGORY_ID ou TICKET_CATEGORY_NAME.",
      ephemeral: true,
    });
    return;
  }

  const permissionOverwrites = [
    {
      id: interaction.guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
      ],
    },
    {
      id: interaction.client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.AttachFiles,
      ],
    },
  ];

  for (const staffRoleId of staffRoleIds) {
    permissionOverwrites.push({
      id: staffRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ManageChannels,
      ],
    });
  }

  const channel = await interaction.guild.channels.create({
    name: channelNameFor(type, interaction.user.username),
    type: ChannelType.GuildText,
    parent: category?.id,
    topic: buildTicketTopic({ ownerId: interaction.user.id, type, addedUserIds: [] }),
    permissionOverwrites,
  });

  void recordTicketEvent({ guildId: interaction.guild.id, channelId: channel.id, ownerId: interaction.user.id, actorId: interaction.user.id, action: "opened", payload: { type } });
  void sendGeneralLog(interaction.guild, {
    embeds: [new EmbedBuilder()
      .setColor(type === "compras" ? 0x57f287 : 0x5865f2)
      .setAuthor({ name: "GERAIS CITY • TICKET" })
      .setTitle("Ticket aberto")
      .addFields(
        { name: "Usuário", value: `<@${interaction.user.id}>`, inline: true },
        { name: "Categoria", value: type, inline: true },
        { name: "Canal", value: `<#${channel.id}>`, inline: true },
      )
      .setTimestamp()],
    allowedMentions: { parse: [] },
  });

  const ticket = ticketTypes.find((item) => item.id === type)!;
  const welcomeEmbed = new EmbedBuilder()
    .setTitle(`${ticket.emoji} ${ticket.label}`)
    .setDescription(
      `Olá, <@${interaction.user.id}>. A equipe responderá assim que possível.\n\n` +
        "Descreva seu caso e envie as informações necessárias.",
    )
    .setColor(type === "denuncias" ? 0xed4245 : type === "compras" ? 0x57f287 : 0xFFD700); // Cor amarela #FFD700

  if (type === "compras" && purchaseData) {
    welcomeEmbed.addFields(
      { name: "Produto/serviço", value: purchaseData.product.slice(0, 1000), inline: false },
      { name: "Usuário Roblox", value: `\`${purchaseData.robloxUser.slice(0, 80)}\``, inline: true },
      { name: "Solicitação", value: purchaseData.details.slice(0, 1000), inline: false },
    );
  }

  await channel.send({
    content: [
      `<@${interaction.user.id}>`,
      ...staffRoleIds.map((roleId) => `<@&${roleId}>`),
    ].join(" "),
    embeds: [welcomeEmbed, buildRulesEmbed()],
    components: [ticketActionButtons()],
  });

  if (type === "denuncias") {
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("Verificação de provas")
          .setDescription(
            "Você possui provas concretas (prints, vídeos) suficientes para prosseguir com a denúncia?",
          )
          .setColor(0xfaa61a),
      ],
      components: [evidenceButtons()],
    });
  }

  await respond(interaction, {
    content: `Seu ticket foi criado: <#${channel.id}>.`,
    ephemeral: true,
  });
}

async function toggleRole(
  interaction: ButtonInteraction,
  roleId: string,
) {
  if (!interaction.guild || !interaction.member) {
    await respond(interaction, {
      content: "Este botão só pode ser usado dentro de um servidor.",
      ephemeral: true,
    });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const role = await interaction.guild.roles.fetch(roleId);

  if (!role) {
    await respond(interaction, {
      content: "Este cargo não foi encontrado ou foi removido.",
      ephemeral: true,
    });
    return;
  }

  if (!role.editable) {
    await respond(interaction, {
      content:
        `Não consigo gerenciar o cargo **${role.name}**. ` +
        "Coloque o cargo do bot acima dele na hierarquia do servidor.",
      ephemeral: true,
    });
    return;
  }
  // Painéis antigos e novos jamais podem entregar cargos de administração.
  if (isDangerousSelfRole(role)) {
    await respond(interaction, {
      content: "Este cargo possui permissões administrativas e não pode ser gerenciado por painel público.",
      ephemeral: true,
    });
    return;
  }

  if (member.roles.cache.has(role.id)) {
    await member.roles.remove(role);
    await respond(interaction, {
      ephemeral: true,
      embeds: [new EmbedBuilder()
        .setColor(0xfee75c)
        .setTitle("✨ Cargo atualizado")
        .setDescription(`O cargo ${role} foi **removido** do seu perfil com sucesso.`)
        .setFooter({ text: "Gerais City RP • Cargos automáticos" })],
    });
  } else {
    await member.roles.add(role);
    await respond(interaction, {
      ephemeral: true,
      embeds: [new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("✅ Cargo adicionado!")
        .setDescription(`O cargo ${role} foi adicionado ao seu perfil com sucesso.`)
        .setFooter({ text: "Gerais City RP • Cargos automáticos" })],
    });
  }
}

function roleIdsFromPanelMessage(message: Message): string[] {
  const rows = message.components as unknown as Array<{
    components?: Array<{ customId?: string }>;
  }>;

  return rows
    .flatMap((row) => row.components ?? [])
    .map((component) => component.customId)
    .filter((customId): customId is string =>
      Boolean(customId?.startsWith("role_toggle:")),
    )
    .map((customId) => {
      const parts = customId.split(":");
      return parts.length === 2 ? parts[1] : parts[2];
    })
    .filter((roleId): roleId is string => Boolean(roleId))
    .slice(0, 6);
}

async function handleInteraction(interaction: Interaction) {
  if (interaction.isChatInputCommand()) {
    // Nunca usar permissões do Discord como substituto para a conferência do ID.
    if (shield.shouldRestrictCommand(interaction.commandName) && !shield.isOwner(interaction.user.id)) {
      await interaction.reply({
        content: securityEnvironment.ownerId
          ? "⛔ Este comando é exclusivo do proprietário do Gerais City RP."
          : "Comandos administrativos bloqueados: configure SECURITY_OWNER_ID nos Secrets do Replit.",
        ephemeral: true,
      });
      return;
    }
    if (interaction.commandName === "anunciar") {
      if (!interaction.guild || !interaction.channelId) {
        await interaction.reply({ content: "Use /anunciar dentro de um canal do servidor.", ephemeral: true });
        return;
      }
      const targetChannel = await interaction.guild.channels.fetch(interaction.channelId).catch(() => null);
      if (!targetChannel || (targetChannel.type !== ChannelType.GuildText && targetChannel.type !== ChannelType.GuildAnnouncement)) {
        await interaction.reply({ content: "Use /anunciar em um canal de texto ou de anúncios.", ephemeral: true });
        return;
      }
      if (!(await ensureChannelAccess(interaction, targetChannel, true))) return;

      const key = announcementKey(interaction.guild.id, interaction.user.id);
      pendingAnnouncements.set(key, {
        guildId: interaction.guild.id,
        channelId: targetChannel.id,
        title: interaction.options.getString("titulo", true),
        message: interaction.options.getString("mensagem")?.trim() ?? "",
        color: colorFromOption(interaction.options.getString("cor")),
        roleId: interaction.options.getRole("mencao")?.id ?? null,
        createdAt: Date.now(),
      });
      setTimeout(() => {
        const current = pendingAnnouncements.get(key);
        if (current && Date.now() - current.createdAt >= 10 * 60_000) pendingAnnouncements.delete(key);
      }, 10 * 60_000).unref();

      await interaction.showModal(announcementMediaModal());
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    if (interaction.commandName === "ticket") {
      const channel = await fetchInteractionTextChannel(interaction);
      if (!channel || channel.type !== ChannelType.GuildText) {
        await respond(interaction, { content: "Use este comando dentro de um canal de ticket.", ephemeral: true });
        return;
      }
      const meta = ticketMetaFromChannel(channel);
      if (!meta) {
        await respond(interaction, { content: "Este canal não é um ticket reconhecido pelo sistema final.", ephemeral: true });
        return;
      }
      const sub = interaction.options.getSubcommand(true);
      if (sub === "assumir") {
        await respond(interaction, { content: await claimTicket(channel, interaction.user.id), ephemeral: true });
        return;
      }
      if (sub === "adicionar" || sub === "remover") {
        const user = interaction.options.getUser("usuario", true);
        const result = sub === "adicionar"
          ? await addTicketMember(channel, interaction.user.id, user.id)
          : await removeTicketMember(channel, interaction.user.id, user.id);
        await respond(interaction, { content: result, ephemeral: true });
        return;
      }
      if (sub === "renomear") {
        if (!isTicketStaff(channel.guild, interaction.user.id)) {
          await respond(interaction, { content: "Apenas a equipe pode renomear tickets.", ephemeral: true });
          return;
        }
        const name = interaction.options.getString("nome", true).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
        if (name.length < 2) {
          await respond(interaction, { content: "Escolha um nome válido para o canal.", ephemeral: true });
          return;
        }
        await channel.setName(name, `Ticket Final renomeado por ${interaction.user.id}`);
        void recordTicketEvent({ guildId: channel.guild.id, channelId: channel.id, ownerId: meta.ownerId, actorId: interaction.user.id, action: "rename", payload: { name } });
        await respond(interaction, { content: `Canal renomeado para **${name}**.`, ephemeral: true });
        return;
      }
      if (sub === "fechar") {
        if (interaction.user.id !== meta.ownerId && !isTicketStaff(channel.guild, interaction.user.id)) {
          await respond(interaction, { content: "Somente o titular ou a equipe pode fechar este ticket.", ephemeral: true });
          return;
        }
        await respond(interaction, { content: "Tem certeza que deseja encerrar este atendimento? O transcript será salvo antes da exclusão.", components: [ticketCloseConfirmButtons()], ephemeral: true });
        return;
      }
      if (sub === "info") {
        await respond(interaction, { embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("🎫 Informações do ticket").addFields(
          { name: "Titular", value: `<@${meta.ownerId}>`, inline: true },
          { name: "Atendente", value: meta.claimedBy ? `<@${meta.claimedBy}>` : "Ainda não assumido", inline: true },
          { name: "Pessoas adicionadas", value: meta.addedUserIds.length ? meta.addedUserIds.map((id) => `<@${id}>`).join(", ") : "Nenhuma", inline: false },
        )], ephemeral: true });
        return;
      }
    }

    if (interaction.commandName === "painel-tickets") {
      const selectedChannel = interaction.options.getChannel("canal", true);
      const targetChannel = await interaction.guild?.channels
        .fetch(selectedChannel.id)
        .catch(() => null);
      if (!targetChannel || !("send" in targetChannel)) {
        await respond(interaction, {
          content:
            "Não consegui acessar o canal escolhido. Verifique se o bot tem Ver Canal e Enviar Mensagens nele.",
          ephemeral: true,
        });
        return;
      }
      if (!(await ensureChannelAccess(interaction, targetChannel))) {
        return;
      }

      const panelImage = interaction.options.getAttachment("imagem");
      const panelThumbnail = interaction.options.getAttachment("thumbnail");
      const panelAttachments = [panelImage, panelThumbnail].filter((item): item is NonNullable<typeof item> => Boolean(item));
      if (panelAttachments.some((image) => !isAcceptedImage(image.name, image.contentType) || image.size > MAX_ANNOUNCEMENT_IMAGE_BYTES)) {
        await respond(interaction, { content: "Imagem e thumbnail precisam ser PNG/JPG/GIF/WebP e ter no máximo 8 MB cada.", ephemeral: true });
        return;
      }
      const files: AttachmentBuilder[] = [];
      let panelImageUrl: string | null = null;
      let panelThumbnailUrl: string | null = null;
      try {
        for (const image of panelAttachments) {
          const response = await fetch(image.url, { signal: AbortSignal.timeout(12_000) });
          if (!response.ok) throw new Error(`Não foi possível obter ${image.name}.`);
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.byteLength > MAX_ANNOUNCEMENT_IMAGE_BYTES) throw new Error(`${image.name} ultrapassou 8 MB.`);
          const baseName = announcementImageName(image.name, false);
          const name = image.id === panelThumbnail?.id ? `thumb_${baseName}` : `banner_${baseName}`;
          files.push(new AttachmentBuilder(bytes, { name }));
          if (image.id === panelThumbnail?.id) panelThumbnailUrl = `attachment://${name}`;
          else panelImageUrl = `attachment://${name}`;
        }
      } catch (error) {
        await respond(interaction, { content: error instanceof Error ? error.message : "Não consegui preparar a imagem do painel.", ephemeral: true });
        return;
      }

      await targetChannel.send({
        embeds: [
          buildTicketPanelEmbed({
            title: interaction.options.getString("titulo"),
            description: interaction.options.getString("descricao"),
            color: colorFromOption(interaction.options.getString("cor") ?? "FFD700"),
            footerImage: panelImageUrl ?? interaction.options.getString("imagem_rodape"),
            thumbnail: panelThumbnailUrl,
          }),
        ],
        files,
        components: [ticketPanelButtons()],
      });
      await respond(interaction, {
        content: "Painel de tickets publicado.",
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === "painel-admin") {
      if (!interaction.guild || !canUseAdminPanel(interaction)) {
        await respond(interaction, { content: "⛔ Este painel é exclusivo da administração autorizada.", ephemeral: true });
        return;
      }
      await respond(interaction, { ...(await buildAdminPanel(client, interaction.guild, "home", shield.panelState())), ephemeral: true });
      return;
    }

    if (interaction.commandName === "reaction-role") {
      const targetChannel = await fetchInteractionTextChannel(interaction);
      if (!targetChannel) {
        await respond(interaction, {
          content: "Use /reaction-role diretamente no canal de texto onde o painel deve ficar.",
          ephemeral: true,
        });
        return;
      }
      if (!(await ensureChannelAccess(interaction, targetChannel))) return;

      const roleIds = Array.from({ length: 6 }, (_, index) =>
        interaction.options.getRole(`cargo_${index + 1}`)?.id,
      ).filter((roleId): roleId is string => Boolean(roleId));

      const uniqueRoleIds = [...new Set(roleIds)];
      const roles = (
        await Promise.all(uniqueRoleIds.map((roleId) => interaction.guild!.roles.fetch(roleId)))
      ).filter((role): role is NonNullable<typeof role> => Boolean(role));

      if (roles.length !== uniqueRoleIds.length) {
        await respond(interaction, {
          content: "Um ou mais cargos selecionados não foram encontrados.",
          ephemeral: true,
        });
        return;
      }
      if (roles.some(isDangerousSelfRole)) {
        await respond(interaction, {
          content: "Por segurança, o painel de cargos não pode oferecer permissões administrativas ou de moderação.",
          ephemeral: true,
        });
        return;
      }
      const uneditable = roles.find((role) => !role.editable);
      if (uneditable) {
        await respond(interaction, {
          content: `Não consigo entregar o cargo **${uneditable.name}**. Coloque o cargo do bot acima dele na hierarquia.`,
          ephemeral: true,
        });
        return;
      }

      const panelEmbed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setAuthor({ name: "GERAIS CITY RP  •  CARGOS" })
        .setTitle("🎭 Escolha seus cargos")
        .setDescription(
          "Personalize seu perfil escolhendo os cargos abaixo.\n\n" +
          "Clique em um botão para **adicionar** o cargo. Se clicar novamente, ele será **removido** automaticamente.\n\n" +
          "**Cargos disponíveis**\n" + roles.map((role) => `✨ ${role}`).join("\n"),
        )
        .setFooter({ text: "Gerais City RP • Seus cargos, suas escolhas" })
        .setTimestamp();

      const components = rolePanelButtons(
        roles.map((role) => ({ id: role.id, label: role.name })),
      );
      await targetChannel.send({ embeds: [panelEmbed], components });
      await respond(interaction, {
        content: "✅ Painel padrão de cargos publicado neste canal.",
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === "divulgar") {
      const kind = interaction.options.getSubcommand(true) as MediaPromoKind;
      const link = interaction.options.getString("link", true);
      let info;
      try {
        info = await getMediaPromoInfo(link);
      } catch (error) {
        await respond(interaction, {
          content: error instanceof Error ? error.message : "Informe um link HTTPS válido.",
          ephemeral: true,
        });
        return;
      }

      // Publica no mesmo canal onde o moderador digitou o comando.
      // Não exige título, cor, imagem, menção ou canal extra.
      const guild = interaction.guild;
      const channelId = interaction.channelId;
      const targetChannel = guild && channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
      if (
        !targetChannel ||
        (targetChannel.type !== ChannelType.GuildText &&
          targetChannel.type !== ChannelType.GuildAnnouncement)
      ) {
        await respond(interaction, {
          content: "Use /divulgar em um canal de texto ou de anúncios do servidor.",
          ephemeral: true,
        });
        return;
      }
      if (!(await ensureChannelAccess(interaction, targetChannel))) return;

      const { embed, buttons } = buildMediaPromo(kind, info);
      await targetChannel.send({
        embeds: [embed],
        components: [buttons],
        allowedMentions: { parse: [] },
      });
      await respond(interaction, {
        content: kind === "live" ? "🔴 Divulgação da live publicada!" : "🎬 Divulgação do vídeo publicada!",
        ephemeral: true,
      });
      return;
    }



    return;
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId === "announcement_media_modal") {
      await interaction.deferReply({ ephemeral: true });
      if (!interaction.guild) {
        await interaction.editReply("Este anúncio só pode ser concluído dentro de um servidor.");
        return;
      }

      const key = announcementKey(interaction.guild.id, interaction.user.id);
      const pending = pendingAnnouncements.get(key);
      pendingAnnouncements.delete(key);
      if (!pending || Date.now() - pending.createdAt > 10 * 60_000) {
        await interaction.editReply("Este anúncio expirou. Execute `/anunciar` novamente.");
        return;
      }

      const targetChannel = await interaction.guild.channels.fetch(pending.channelId).catch(() => null);
      if (!targetChannel || (targetChannel.type !== ChannelType.GuildText && targetChannel.type !== ChannelType.GuildAnnouncement)) {
        await interaction.editReply("O canal original do anúncio não está mais disponível.");
        return;
      }

      const collection = interaction.fields.getUploadedFiles("anuncio_midias", false);
      const media = collection ? [...collection.values()] : [];
      if (media.length > MAX_ANNOUNCEMENT_MEDIA_ITEMS) {
        await interaction.editReply(`Selecione no máximo ${MAX_ANNOUNCEMENT_MEDIA_ITEMS} arquivos.`);
        return;
      }
      if (media.some((file) => !isAcceptedAnnouncementMedia(file.name, file.contentType))) {
        await interaction.editReply("Use somente imagens PNG/JPG/GIF/WebP ou vídeos MP4/MOV/WebM.");
        return;
      }
      if (media.some((file) => file.size > MAX_ANNOUNCEMENT_MEDIA_BYTES)) {
        await interaction.editReply("Cada foto ou vídeo pode ter no máximo 20 MB.");
        return;
      }

      const uploads: AttachmentBuilder[] = [];
      const uploadedNames: string[] = [];
      try {
        for (const [index, file] of media.entries()) {
          const response = await fetch(file.url, { signal: AbortSignal.timeout(20_000) });
          if (!response.ok) throw new Error(`Não foi possível obter ${file.name} (${response.status}).`);
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.byteLength > MAX_ANNOUNCEMENT_MEDIA_BYTES) throw new Error(`${file.name} ultrapassou 20 MB.`);
          const safeName = `${index + 1}_${announcementMediaName(file.name)}`;
          uploads.push(new AttachmentBuilder(bytes, { name: safeName }));
          uploadedNames.push(safeName);
        }
      } catch (error) {
        await interaction.editReply(error instanceof Error ? error.message : "Não consegui preparar uma das mídias.");
        return;
      }

      const roleMention = pending.roleId ? `<@&${pending.roleId}>\n\n` : "";
      const body = pending.message ? `\n${pending.message}` : "";
      const container = new ContainerBuilder()
        .setAccentColor(pending.color)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`${roleMention}## ${pending.title}${body}`.slice(0, 3900)),
        );

      if (uploadedNames.length) {
        const gallery = new MediaGalleryBuilder().addItems(
          ...uploadedNames.map((name) => new MediaGalleryItemBuilder().setURL(`attachment://${name}`)),
        );
        container.addMediaGalleryComponents(gallery);
      }

      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent("-# Gerais City RP • Comunicado oficial"),
      );

      await targetChannel.send({
        components: [container],
        files: uploads,
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [], roles: pending.roleId ? [pending.roleId] : [] },
      });

      await interaction.editReply(
        uploadedNames.length
          ? `✅ Anúncio publicado com **${uploadedNames.length} mídia(s)**. Texto em cima e galeria abaixo.`
          : "✅ Anúncio publicado.",
      );
      return;
    }

    if (interaction.customId === "ticket_purchase_modal") {
      await interaction.deferReply({ ephemeral: true });
      const purchaseData: PurchaseTicketData = {
        product: interaction.fields.getTextInputValue("produto").trim(),
        robloxUser: interaction.fields.getTextInputValue("roblox_usuario").trim(),
        details: interaction.fields.getTextInputValue("detalhes").trim(),
      };
      const key = `${interaction.guildId ?? "dm"}:${interaction.user.id}:compras`;
      if (openingTickets.has(key)) {
        await interaction.editReply("Seu ticket de compras já está sendo criado.");
        return;
      }
      openingTickets.add(key);
      try { await createTicket(interaction, "compras", purchaseData); }
      finally { openingTickets.delete(key); }
      return;
    }
    if (interaction.customId.startsWith("shield_cfg_")) {
      if (!interaction.guild) {
        await interaction.reply({ content: "Este controle só funciona dentro do servidor.", ephemeral: true });
        return;
      }
      await interaction.deferReply({ ephemeral: true });

      let result;
      if (interaction.customId === "shield_cfg_verification_publish") {
        const channelId = parseSnowflakeReference(interaction.fields.getTextInputValue("canal"));
        const roleId = parseSnowflakeReference(interaction.fields.getTextInputValue("cargo"));
        result = await shield.panelAction(interaction.guild, interaction.user.id, "verification_publish", {
          channelId: channelId ?? undefined,
          roleId: roleId ?? undefined,
        });
      } else {
        const value = interaction.fields.getTextInputValue("valor");
        const parsedId = parseSnowflakeReference(value);
        const actionByModal: Record<string, string> = {
          shield_cfg_bot_add: "bot_add",
          shield_cfg_bot_remove: "bot_remove",
          shield_cfg_team_add: "team_add",
          shield_cfg_team_remove: "team_remove",
          shield_cfg_log_channel: "log_channel",
          shield_cfg_incident_detail: "incident",
        };
        const action = actionByModal[interaction.customId];
        if (!action) {
          await interaction.editReply("Ação de configuração desconhecida.");
          return;
        }
        result = action === "incident"
          ? await shield.panelAction(interaction.guild, interaction.user.id, action, { incidentId: value.trim() })
          : action === "log_channel"
            ? await shield.panelAction(interaction.guild, interaction.user.id, action, { channelId: parsedId ?? undefined })
            : await shield.panelAction(interaction.guild, interaction.user.id, action, { targetId: parsedId ?? undefined });
      }

      await interaction.editReply({ content: result.content, embeds: result.embeds });
      return;
    }

    if (!interaction.customId.startsWith("ticket_member_modal:")) return;
    await interaction.deferReply({ ephemeral: true });
    const action = interaction.customId.split(":")[1];
    const channel = await fetchInteractionTextChannel(interaction);
    if (!channel || channel.type !== ChannelType.GuildText || !ticketMetaFromChannel(channel)) {
      await interaction.editReply("Este modal só pode ser usado dentro de um ticket válido.");
      return;
    }
    const userId = parseUserReference(interaction.fields.getTextInputValue("usuario"));
    if (!userId) {
      await interaction.editReply("Informe um ID numérico válido ou uma menção de usuário.");
      return;
    }
    const result = action === "add"
      ? await addTicketMember(channel, interaction.user.id, userId)
      : await removeTicketMember(channel, interaction.user.id, userId);
    await interaction.editReply(result);
    return;
  }

  if (!interaction.isButton()) return;

  if (interaction.customId === "verification_check") {
    await handleVerificationButton(interaction);
    return;
  }

  if (interaction.customId === "ticket_open:compras") {
    await interaction.showModal(purchaseTicketModal());
    return;
  }

  if (interaction.customId.startsWith("admin_security:")) {
    if (!interaction.guild || !canUseAdminPanel(interaction)) {
      await interaction.reply({ content: "⛔ Painel restrito à administração.", ephemeral: true }).catch(() => undefined);
      return;
    }
    if (!shield.isOwner(interaction.user.id)) {
      await interaction.reply({ content: "⛔ Os controles do Gerais Shield são exclusivos do proprietário configurado em SECURITY_OWNER_ID.", ephemeral: true });
      return;
    }

    const action = interaction.customId.split(":")[1] ?? "";
    if (action === "config") {
      await interaction.update(buildAdminSecurityConfigPanel(interaction.guild, shield.panelState()));
      return;
    }
    if (action === "back") {
      await interaction.update(await buildAdminPanel(client, interaction.guild, "security", shield.panelState()));
      return;
    }

    const modalByAction: Record<string, ModalBuilder> = {
      bot_add: securitySingleIdModal("shield_cfg_bot_add", "Permitir bot", "ID do bot", "Cole o ID da conta do bot"),
      bot_remove: securitySingleIdModal("shield_cfg_bot_remove", "Remover bot", "ID do bot", "Cole o ID da conta do bot"),
      team_add: securitySingleIdModal("shield_cfg_team_add", "Adicionar equipe", "ID do usuário", "Cole o ID do membro"),
      team_remove: securitySingleIdModal("shield_cfg_team_remove", "Remover equipe", "ID do usuário", "Cole o ID do membro"),
      log_channel: securitySingleIdModal("shield_cfg_log_channel", "Canal de segurança", "ID do canal privado", "Cole o ID do canal"),
      incident_detail: securitySingleIdModal("shield_cfg_incident_detail", "Abrir incidente", "ID do incidente", "Ex.: INC-2026-00428"),
    };
    const modal = modalByAction[action];
    if (modal) {
      await interaction.showModal(modal);
      return;
    }
    if (action === "verification_publish") {
      await interaction.showModal(securityVerificationModal());
      return;
    }

    if (action === "snapshot_restore") {
      const confirmation = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("admin_security:restore_confirm").setLabel("Sim, restaurar").setEmoji("♻️").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("admin_security:restore_cancel").setLabel("Cancelar").setStyle(ButtonStyle.Secondary),
      );
      await interaction.reply({
        content: "⚠️ **Confirmar restauração?** O Shield recriará cargos/canais ausentes usando o último snapshot.",
        components: [confirmation],
        ephemeral: true,
      });
      return;
    }
    if (action === "restore_cancel") {
      await interaction.update({ content: "Restauração cancelada.", components: [] });
      return;
    }
    if (action === "restore_confirm") {
      await interaction.deferReply({ ephemeral: true });
      const result = await shield.panelAction(interaction.guild, interaction.user.id, "snapshot_restore");
      await interaction.editReply({ content: result.content, embeds: result.embeds });
      return;
    }

    const directActions = new Set([
      "status", "toggle", "mode", "safe", "incidents", "snapshot_create", "snapshot_preview", "release", "test",
      "bot_list", "team_list", "verification_status", "verification_disable",
    ]);
    if (!directActions.has(action)) {
      await interaction.reply({ content: "Ação de segurança desconhecida.", ephemeral: true });
      return;
    }

    const result = await shield.panelAction(interaction.guild, interaction.user.id, action);
    const stateChanging = new Set(["toggle", "mode", "safe", "snapshot_create", "release", "test", "verification_disable"]);
    if (stateChanging.has(action)) {
      const onConfigPage = ["bot_list", "team_list", "verification_status", "verification_disable"].includes(action);
      if (onConfigPage) {
        await interaction.update(buildAdminSecurityConfigPanel(interaction.guild, shield.panelState()));
      } else {
        await interaction.update(await buildAdminPanel(client, interaction.guild, "security", shield.panelState()));
      }
      if (result.content || result.embeds?.length) {
        await interaction.followUp({ content: result.content, embeds: result.embeds, ephemeral: true });
      }
      return;
    }

    await interaction.reply({ content: result.content, embeds: result.embeds, ephemeral: true });
    return;
  }

  if (interaction.customId.startsWith("admin_panel:")) {
    if (!interaction.guild || !canUseAdminPanel(interaction)) {
      await interaction.reply({ content: "⛔ Painel restrito à administração.", ephemeral: true }).catch(() => undefined);
      return;
    }
    const [, rawSection] = interaction.customId.split(":");
    if (rawSection === "close") {
      await interaction.update({ content: "Painel administrativo fechado.", embeds: [], components: [] });
      return;
    }
    const section: AdminSection = rawSection === "roblox" || rawSection === "logs" || rawSection === "tickets" || rawSection === "security" ? rawSection : "home";
    await interaction.update(await buildAdminPanel(client, interaction.guild, section, shield.panelState()));
    return;
  }

  if (interaction.customId === "ticket_add" || interaction.customId === "ticket_remove") {
    const channel = await fetchInteractionTextChannel(interaction);
    if (!channel || channel.type !== ChannelType.GuildText) {
      await interaction.reply({ content: "Este botão só funciona dentro de um ticket.", ephemeral: true });
      return;
    }
    const meta = ticketMetaFromChannel(channel);
    if (!meta || !canManageTicketMembers(channel.guild, interaction.user.id, meta)) {
      await interaction.reply({ content: "Somente a equipe autorizada pode gerenciar pessoas deste ticket.", ephemeral: true });
      return;
    }
    await interaction.showModal(memberModal(interaction.customId === "ticket_add" ? "add" : "remove"));
    return;
  }

  if (interaction.customId.startsWith("ticket_rate:")) {
    const [, guildId, ticketId, rating] = interaction.customId.split(":");
    const guild = guildId ? client.guilds.cache.get(guildId) : null;
    if (guild && ticketId && rating) {
      const numericRating = Number(rating);
      if (Number.isInteger(numericRating) && numericRating >= 1 && numericRating <= 5) {
        void recordTicketRating({ guildId: guild.id, ticketId, userId: interaction.user.id, rating: numericRating });
      }
      await sendGeneralLog(guild, {
        embeds: [new EmbedBuilder().setColor(0xfee75c).setTitle("⭐ Avaliação de atendimento").setDescription(`<@${interaction.user.id}> avaliou o ticket \`${ticketId}\` com **${rating}/5**.`).setTimestamp()],
        allowedMentions: { parse: [] },
      });
    }
    await interaction.reply({ content: "Obrigado pela avaliação! ❤️", ephemeral: true }).catch(async () => {
      await interaction.reply({ content: "Obrigado pela avaliação! ❤️" }).catch(() => undefined);
    });
    return;
  }

  await interaction.deferReply({
    ephemeral: !interaction.customId.startsWith("denuncia_provas:"),
  });

  if (interaction.customId.startsWith("ticket_open:")) {
    const type = interaction.customId.split(":")[1] as TicketType;
    if (ticketTypes.some((ticket) => ticket.id === type)) {
      const key = `${interaction.guildId ?? "dm"}:${interaction.user.id}:${type}`;
      if (openingTickets.has(key)) {
        await respond(interaction, { content: "Seu ticket já está sendo criado. Confira a resposta anterior.", ephemeral: true });
        return;
      }
      openingTickets.add(key);
      try { await createTicket(interaction, type); }
      finally { openingTickets.delete(key); }
    }
    return;
  }

  if (interaction.customId === "ticket_claim") {
    const channel = await fetchInteractionTextChannel(interaction);
    const result = channel?.type === ChannelType.GuildText ? await claimTicket(channel, interaction.user.id) : "Este botão só funciona dentro de um ticket.";
    await interaction.editReply(result);
    return;
  }

  if (interaction.customId === "ticket_close") {
    const channel = await fetchInteractionTextChannel(interaction);
    if (!channel || channel.type !== ChannelType.GuildText) {
      await interaction.editReply("Este botão só funciona dentro de um ticket.");
      return;
    }
    const meta = ticketMetaFromChannel(channel);
    if (!meta || (interaction.user.id !== meta.ownerId && !isTicketStaff(channel.guild, interaction.user.id))) {
      await interaction.editReply("Somente o titular ou a equipe pode fechar este ticket.");
      return;
    }
    await interaction.editReply({ content: "Tem certeza? O transcript será salvo antes de remover o canal.", components: [ticketCloseConfirmButtons()] });
    return;
  }

  if (interaction.customId === "ticket_close_cancel") {
    await interaction.editReply({ content: "Fechamento cancelado.", components: [] });
    return;
  }

  if (interaction.customId === "ticket_close_confirm") {
    const channel = await fetchInteractionTextChannel(interaction);
    if (!channel || channel.type !== ChannelType.GuildText) {
      await interaction.editReply("Este botão só funciona dentro de um ticket.");
      return;
    }
    try {
      await interaction.editReply("Fechando o ticket e gerando o transcript...");
      await closeTicket(channel, interaction.user.id);
    } catch (error) {
      await interaction.editReply(error instanceof Error ? error.message : "Não foi possível fechar o ticket.");
    }
    return;
  }

  if (interaction.customId.startsWith("role_toggle:")) {
    const parts = interaction.customId.split(":");
    const roleId = parts.length === 2 ? parts[1] : parts[2];
    if (roleId) await toggleRole(interaction, roleId);
    return;
  }

  if (interaction.customId.startsWith("denuncia_provas:")) {
    const answer = interaction.customId.split(":")[1];
    if (answer === "nao") {
      await interaction.editReply({ content: "Denúncias sem provas concretas não podem ser analisadas. Adicione prints ou vídeos e tente novamente." });
    } else {
      await interaction.editReply({ content: "Obrigado. A equipe poderá analisar a denúncia com as provas enviadas." });
    }
  }

}

client.once(Events.ClientReady, async (readyClient) => {
  try {
    await shield.initialize();
    const rest = new REST({ version: "10" }).setToken(config.token);
    const applicationId = readyClient.user.id;
    const guildIds = config.guildId
      ? [config.guildId]
      : [...readyClient.guilds.cache.keys()];

    const result = await syncBotCommands({
      guildIds,
      commands: commandDefinitions,
      purgeLegacyGlobalCommands: config.purgeLegacyGlobalCommands,
      api: {
        replaceGuild: async (guildId, commands) => {
          await rest.put(Routes.applicationGuildCommands(applicationId, guildId), {
            body: commands,
          });
        },
        replaceGlobal: async (commands) => {
          await rest.put(Routes.applicationCommands(applicationId), {
            body: commands,
          });
        },
        listGlobal: async (): Promise<RegisteredGlobalCommand[]> => {
          const response = await rest.get(Routes.applicationCommands(applicationId));
          if (!Array.isArray(response)) {
            throw new Error("A API do Discord retornou uma lista global inválida.");
          }
          return response as RegisteredGlobalCommand[];
        },
        deleteGlobal: async (commandId) => {
          await rest.delete(Routes.applicationCommand(applicationId, commandId));
        },
      },
    });

    console.log(
      result.scope === "guild"
        ? `Bot conectado como ${readyClient.user.tag}. ${commandDefinitions.length} comandos sincronizados em ${result.guildCount} servidor(es). ` +
          (result.purgedAllGlobalCommands
            ? "Comandos globais antigos deste aplicativo apagados (limpeza total solicitada)."
            : `${result.deletedGlobalCount} versão(ões) global(is) duplicada(s) removida(s).`)
        : `Bot conectado como ${readyClient.user.tag}. ${commandDefinitions.length} comandos registrados globalmente: nenhum servidor conectado.`,
    );
  } catch (error) {
    console.error("Falha ao registrar/sincronizar comandos Discord:", error);
  }
});

// A proteção passiva é independente dos slash commands e continua ativa 24h
// enquanto o cliente Discord estiver conectado.
client.on(Events.GuildMemberAdd, (member) => {
  void shield.memberJoin(member).catch((error) => console.error("Gerais Shield Final/entrada:", error));
});
client.on(Events.GuildMemberRemove, (member) => {
  void shield.memberRemove(member).catch((error) => console.error("Gerais Shield Final/saída-kick:", error));
});
client.on(Events.MessageCreate, (message) => {
  void shield.message(message).catch((error) => console.error("Gerais Shield Final/mensagem:", error));
});
client.on(Events.ChannelUpdate, (before, after) => {
  if (before.isDMBased() || after.isDMBased()) return;
  void shield.channelUpdate(before, after).catch((error) => console.error("Gerais Shield Final/canal:", error));
});
client.on(Events.ChannelCreate, (channel) => {
  if (channel.isDMBased()) return;
  void shield.creationAction(channel.guild, AuditLogEvent.ChannelCreate, channel.id, "criação de canal", async () => channel.delete("Gerais Shield Final: criação em massa / anti-cópia"))
    .catch((error) => console.error("Gerais Shield Final/criação de canal:", error));
});
client.on(Events.ChannelDelete, (channel) => {
  if (channel.isDMBased()) return;
  void shield.destructiveAction(channel.guild, AuditLogEvent.ChannelDelete, channel.id, "exclusão de canal")
    .catch((error) => console.error("Gerais Shield Final/exclusão de canal:", error));
});
client.on(Events.GuildRoleCreate, (role) => {
  void shield.creationAction(role.guild, AuditLogEvent.RoleCreate, role.id, "criação de cargo", async () => role.delete("Gerais Shield Final: criação em massa / anti-cópia"))
    .catch((error) => console.error("Gerais Shield Final/criação de cargo:", error));
});
client.on(Events.GuildRoleDelete, (role) => {
  void shield.destructiveAction(role.guild, AuditLogEvent.RoleDelete, role.id, "exclusão de cargo")
    .catch((error) => console.error("Gerais Shield Final/exclusão de cargo:", error));
});
client.on(Events.GuildBanAdd, (ban) => {
  void shield.destructiveAction(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id, "banimento")
    .catch((error) => console.error("Gerais Shield Final/banimento:", error));
});
client.on(Events.GuildMemberUpdate, (before, after) => {
  void shield.memberUpdate(before, after).catch((error) => console.error("Gerais Shield Final/permissão de membro:", error));
});
client.on(Events.InviteCreate, (invite) => {
  void shield.inviteCreate(invite).catch((error) => console.error("Gerais Shield Final/convite:", error));
});
client.on(Events.GuildRoleUpdate, (before, after) => {
  void shield.roleUpdate(before, after).catch((error) => console.error("Gerais Shield Final/cargo:", error));
});
client.on(Events.GuildUpdate, (before, after) => {
  void shield.guildUpdate(before, after).catch((error) => console.error("Gerais Shield Final/servidor:", error));
});
client.on(Events.WebhooksUpdate, (channel) => {
  if (channel.type === ChannelType.GuildText) {
    void shield.webhookUpdate(channel).catch((error) => console.error("Gerais Shield Final/webhook:", error));
  }
});
client.on(Events.GuildEmojiCreate, (emoji) => {
  void shield.creationAction(emoji.guild, AuditLogEvent.EmojiCreate, emoji.id, "criação de emoji", async () => emoji.delete("Gerais Shield Final: criação em massa / anti-cópia"))
    .catch((error) => console.error("Gerais Shield Final/criação de emoji:", error));
});
client.on(Events.GuildEmojiDelete, (emoji) => {
  void shield.destructiveAction(emoji.guild, AuditLogEvent.EmojiDelete, emoji.id, "exclusão de emoji")
    .catch((error) => console.error("Gerais Shield Final/exclusão de emoji:", error));
});
client.on(Events.GuildStickerCreate, (sticker) => {
  if (!sticker.guild) return;
  void shield.creationAction(sticker.guild, AuditLogEvent.StickerCreate, sticker.id, "criação de sticker", async () => sticker.delete("Gerais Shield Final: criação em massa / anti-cópia"))
    .catch((error) => console.error("Gerais Shield Final/criação de sticker:", error));
});
client.on(Events.GuildStickerDelete, (sticker) => {
  if (!sticker.guild) return;
  void shield.destructiveAction(sticker.guild, AuditLogEvent.StickerDelete, sticker.id, "exclusão de sticker")
    .catch((error) => console.error("Gerais Shield Final/exclusão de sticker:", error));
});
client.on(Events.GuildIntegrationsUpdate, (guild) => {
  void shield.integrationsUpdate(guild).catch((error) => console.error("Gerais Shield Final/integração:", error));
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    await handleInteraction(interaction);
  } catch (error) {
    console.error("Falha ao processar interação:", error);
    const discordCode =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "number"
        ? error.code
        : undefined;
    const message = {
      content:
        discordCode === 50001
          ? "O Discord recusou o acesso do bot ao canal selecionado. Verifique as permissões específicas desse canal e da categoria."
          : "Não foi possível concluir esta ação. Verifique os logs do bot.",
      ephemeral: true,
    };
    if (interaction.isRepliable() && (interaction.replied || interaction.deferred)) {
      await interaction.followUp(message).catch(() => undefined);
    } else if (interaction.isRepliable()) {
      await interaction.reply(message).catch(() => undefined);
    }
  }
});

client.on("error", (error) => {
  console.error("Erro do cliente Discord:", error);
});
client.on("shardReady", (id) => {
  console.log(`[DISCORD] ✅ Shard ${id} conectado e pronto.`);
});

client.on("shardReconnecting", (id) => {
  console.log(`[DISCORD] 🔄 Shard ${id} reconectando...`);
});

client.on("shardDisconnect", (event, id) => {
  console.error(
    `[DISCORD] ❌ Shard ${id} desconectado. Código: ${event.code} | Motivo: ${event.reason || "sem motivo"}`
  );
});

client.on("shardError", (error, id) => {
  console.error(`[DISCORD] ❌ Erro no shard ${id}:`, error);
});

client.on("warn", (warning) => {
  console.warn("[DISCORD] ⚠️ Warning:", warning);
});
process.on("unhandledRejection", (error) => {
  console.error("Promise rejeitada sem tratamento:", error);
});

// Health monitor: expõe apenas sinais operacionais, sem IDs, secrets ou conteúdo de incidentes.
const app = express();
app.use(express.json({ limit: "128kb" }));
const PORT = Number(process.env.PORT ?? 3000);
const startedAt = Date.now();

registerVerificationOAuthRoutes(app, async (guildId, userId, emailVerified) =>
  completeOAuthVerification(client, guildId, userId, emailVerified),
);
registerRobloxBridgeRoutes(app, client);

async function respondHealth(_req: express.Request, res: express.Response) {
  const connected = client.isReady();
  const storage = await persistenceMode();
  res.status(connected ? 200 : 503).json({
    service: "Gerais City RP Bot",
    version: "FINAL-1.2",
    status: connected ? "online" : "discord_disconnected",
    connected,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    discordPingMs: connected ? client.ws.ping : null,
    persistence: storage,
    emailVerification: oauthVerificationConfigured() ? "oauth2" : "discord_native",
    robloxBridge: robloxBridgeConfigured() ? "configured" : "disabled",
    robloxEventsSinceBoot: getRobloxBridgeStats().received,
  });
}

app.get("/", respondHealth);
app.get("/health", respondHealth);

app.listen(PORT, "0.0.0.0", () => {
  console.log("[DISCORD] Verificando comunicação com a API...");

try {
  const response = await fetch("https://discord.com/api/v10/users/@me", {
    headers: {
      Authorization: `Bot ${config.token}`,
    },
  });

  console.log(`[DISCORD] REST /users/@me respondeu HTTP ${response.status}`);

  if (response.status === 401) {
    console.error("[DISCORD] ❌ Token recusado pela API do Discord.");
    process.exit(1);
  }

  if (!response.ok) {
    console.error(
      `[DISCORD] ⚠️ API respondeu com status inesperado: ${response.status}`
    );
  }
} catch (error) {
  console.error("[DISCORD] ❌ Falha ao alcançar discord.com:", error);
}

console.log("[DISCORD] Iniciando conexão com o Gateway...");

const gatewayTimeout = setTimeout(() => {
  console.error(
    `[DISCORD] ❌ TIMEOUT: Gateway não ficou pronto após 30 segundos. ` +
    `wsStatus=${client.ws.status} ready=${client.isReady()}`
  );
}, 30_000);

try {
  await client.login(config.token);

  clearTimeout(gatewayTimeout);

  console.log(
    `[DISCORD] client.login concluído. ready=${client.isReady()}`
  );
} catch (error) {
  clearTimeout(gatewayTimeout);

  console.error("[DISCORD] ❌ Falha ao conectar o bot ao Discord:", error);
  process.exit(1);
}
