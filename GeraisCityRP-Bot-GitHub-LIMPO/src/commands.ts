import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Gerencia o ticket atual.")
    .addSubcommand((sub) =>
      sub
        .setName("adicionar")
        .setDescription("Adiciona uma pessoa ao ticket.")
        .addUserOption((option) => option.setName("usuario").setDescription("Pessoa que poderá visualizar o ticket").setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remover")
        .setDescription("Remove uma pessoa adicionada do ticket.")
        .addUserOption((option) => option.setName("usuario").setDescription("Pessoa que perderá acesso").setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName("assumir").setDescription("Assume o atendimento como membro da equipe."))
    .addSubcommand((sub) =>
      sub
        .setName("renomear")
        .setDescription("Renomeia o canal do ticket.")
        .addStringOption((option) => option.setName("nome").setDescription("Novo nome").setMinLength(2).setMaxLength(70).setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName("fechar").setDescription("Solicita o fechamento do ticket."))
    .addSubcommand((sub) => sub.setName("info").setDescription("Mostra titular, pessoas adicionadas e atendente.")),

  new SlashCommandBuilder()
    .setName("painel-tickets")
    .setDescription("Publica o painel para abertura de tickets.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels.toString())
    .addChannelOption((option) => option.setName("canal").setDescription("Canal onde o painel será publicado.").addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addStringOption((option) => option.setName("titulo").setDescription("Título do embed.").setRequired(false))
    .addStringOption((option) => option.setName("descricao").setDescription("Descrição do embed.").setRequired(false))
    .addStringOption((option) => option.setName("cor").setDescription("Cor hexadecimal, por exemplo #FFD700.").setRequired(false))
    .addAttachmentOption((option) => option.setName("imagem").setDescription("Banner/imagem grande do painel.").setRequired(false))
    .addAttachmentOption((option) => option.setName("thumbnail").setDescription("Imagem pequena no canto do painel.").setRequired(false))
    .addStringOption((option) => option.setName("imagem_rodape").setDescription("URL antiga de imagem (opcional; prefira upload em imagem).").setRequired(false)),

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
