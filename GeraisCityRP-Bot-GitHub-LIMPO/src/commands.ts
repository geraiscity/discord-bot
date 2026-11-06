import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("painel")
    .setDescription("Publica os painéis oficiais do servidor.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("ticket")
        .setDescription("Publica a central de atendimento com orientações e botão para abrir ticket.")
        .addChannelOption((option) =>
          option
            .setName("canal")
            .setDescription("Canal onde o painel será publicado. Se vazio, usa o canal atual.")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false),
        ),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels.toString()),

  new SlashCommandBuilder()
    .setName("avaliacao")
    .setDescription("Gerencia os perfis públicos de avaliação da equipe.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("perfil")
        .setDescription("Publica um perfil de avaliação para um atendente no canal atual.")
        .addUserOption((option) =>
          option.setName("atendente").setDescription("Membro da equipe que receberá avaliações.").setRequired(true),
        ),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString()),

  new SlashCommandBuilder()
    .setName("painel-admin")
    .setDescription("Abre o Gerais Control Center privado.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild.toString()),

  new SlashCommandBuilder()
    .setName("reaction-role")
    .setDescription("Publica o painel padrão de cargos no canal atual.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles.toString())
    .addRoleOption((option) => option.setName("cargo_1").setDescription("Primeiro cargo do painel.").setRequired(true))
    .addRoleOption((option) => option.setName("cargo_2").setDescription("Segundo cargo do painel.").setRequired(false))
    .addRoleOption((option) => option.setName("cargo_3").setDescription("Terceiro cargo do painel.").setRequired(false))
    .addRoleOption((option) => option.setName("cargo_4").setDescription("Quarto cargo do painel.").setRequired(false))
    .addRoleOption((option) => option.setName("cargo_5").setDescription("Quinto cargo do painel.").setRequired(false))
    .addRoleOption((option) => option.setName("cargo_6").setDescription("Sexto cargo do painel.").setRequired(false)),

  new SlashCommandBuilder()
    .setName("anunciar")
    .setDescription("Cria um anúncio e abre um seletor único para fotos ou vídeo.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages.toString())
    .addStringOption((option) => option.setName("titulo").setDescription("Título do anúncio.").setMaxLength(200).setRequired(true))
    .addStringOption((option) => option.setName("mensagem").setDescription("Mensagem opcional do anúncio.").setMaxLength(3500).setRequired(false))
    .addStringOption((option) => option.setName("cor").setDescription("Cor hexadecimal opcional, por exemplo #FFD700.").setRequired(false))
    .addRoleOption((option) => option.setName("mencao").setDescription("Cargo a mencionar (opcional; nunca menciona @everyone).").setRequired(false)),

  new SlashCommandBuilder()
    .setName("divulgar")
    .setDescription("Publica vídeos e lives com layout vermelho pronto.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages.toString())
    .addSubcommand((subcommand) =>
      subcommand
        .setName("video")
        .setDescription("Divulga um vídeo novo; informe somente o link.")
        .addStringOption((option) => option.setName("link").setDescription("Link HTTPS do vídeo.").setMinLength(12).setMaxLength(1800).setRequired(true)),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("live")
        .setDescription("Divulga uma transmissão ao vivo; informe somente o link.")
        .addStringOption((option) => option.setName("link").setDescription("Link HTTPS da transmissão.").setMinLength(12).setMaxLength(1800).setRequired(true)),
    ),
].map((command) => command.toJSON());
