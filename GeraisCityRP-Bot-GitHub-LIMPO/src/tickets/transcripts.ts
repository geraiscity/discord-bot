import type {TextChannel,Message} from "discord.js";
export async function buildTicketTranscript(channel: TextChannel, maxMessages = 500): Promise<Buffer> {
  const messages: Message[] = [];
  let before: string | undefined;
  while (messages.length < maxMessages) {
    const page = await channel.messages.fetch({ limit: Math.min(100, maxMessages - messages.length), before }).catch(() => null);
    if (!page) throw new Error("Não consegui ler todo o histórico do ticket. Confira a permissão Ler Histórico de Mensagens. O ticket foi preservado.");
    if (!page.size) break;
    messages.push(...page.values());
    before = page.last()?.id;
    if (page.size < 100) break;
  }
  if (messages.length >= maxMessages && before) {
    const older = await channel.messages.fetch({ limit: 1, before }).catch(() => null);
    if (!older || older.size > 0) {
      throw new Error("O histórico excede o limite de exportação ou não pôde ser verificado. O ticket permanecerá aberto para evitar perda de mensagens.");
    }
  }
  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const lines = [
    `Transcript de Ticket`,
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

