/**
 * Validação e identificação para /divulgar.
 * Não exige API key: apenas links públicos do YouTube têm metadados consultados.
 * Nenhuma URL informada pelo usuário é acessada diretamente pelo bot.
 */
export type MediaPromoKind = "live" | "video";

export type MediaPromoInfo = {
  url: string;
  platform: string;
  creatorName: string | null;
  thumbnailUrl: string | null;
};

export function parseMediaLink(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 1800 || /\s/.test(trimmed)) {
    throw new Error("Cole um único link HTTPS válido, com até 1800 caracteres.");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("O link precisa começar com https:// e conter um endereço válido.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !url.hostname.includes(".") ||
    url.hostname === "localhost"
  ) {
    throw new Error("Use um link público HTTPS, como https://www.youtube.com/watch?v=...");
  }
  const host = url.hostname.toLowerCase();
  const allowedDomains = ["youtube.com", "youtube-nocookie.com", "youtu.be", "twitch.tv", "kick.com", "tiktok.com", "instagram.com"];
  if (!allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    throw new Error("Por segurança, /divulgar aceita apenas YouTube, Twitch, Kick, TikTok e Instagram.");
  }
  return url;
}

function isHost(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function readableHandle(value: string | undefined): string | null {
  if (!value) return null;
  const decoded = decodeURIComponent(value).replace(/^@/, "").trim();
  return decoded && decoded.length <= 75 ? decoded : null;
}

export function youtubeVideoId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  let candidate: string | undefined;
  if (host === "youtu.be" || isHost(host, "youtu.be")) {
    candidate = url.pathname.split("/").filter(Boolean)[0];
  } else if (isHost(host, "youtube.com") || isHost(host, "youtube-nocookie.com")) {
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments[0] === "watch") candidate = url.searchParams.get("v") ?? undefined;
    if (["live", "shorts", "embed"].includes(segments[0])) candidate = segments[1];
  }
  return candidate && /^[a-zA-Z0-9_-]{11}$/.test(candidate) ? candidate : null;
}

export function platformAndHandle(url: URL): {
  platform: string;
  handle: string | null;
} {
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  if (isHost(host, "youtube.com") || isHost(host, "youtu.be") || isHost(host, "youtube-nocookie.com")) {
    const channelHandle = segments.find((segment) => segment.startsWith("@"));
    return { platform: "YouTube", handle: readableHandle(channelHandle) };
  }
  if (isHost(host, "twitch.tv")) {
    return { platform: "Twitch", handle: segments[0] && !["videos", "directory", "downloads"].includes(segments[0]) ? readableHandle(segments[0]) : null };
  }
  if (isHost(host, "kick.com")) {
    return { platform: "Kick", handle: readableHandle(segments[0]) };
  }
  if (isHost(host, "tiktok.com")) {
    return { platform: "TikTok", handle: readableHandle(segments.find((segment) => segment.startsWith("@"))) };
  }
  if (isHost(host, "instagram.com")) {
    return { platform: "Instagram", handle: segments[0] && !["reel", "reels", "p", "stories"].includes(segments[0]) ? readableHandle(segments[0]) : null };
  }
  return { platform: host.replace(/^www\./, ""), handle: null };
}

export function safeCreatorName(input: string): string | null {
  const condensed = input.replace(/[\r\n\t]+/g, " ").trim().slice(0, 75);
  if (!condensed) return null;
  // Evita formatação inesperada e menções, inclusive em dados externos do oEmbed.
  return condensed.replace(/([\\`*_{}\[\]()<>|~])/g, "\\$1").replace(/@/g, "@\u200b");
}

/**
 * Usa o domínio fixo de oEmbed do YouTube: não faz fetch de URLs enviadas por membros.
 * Se o vídeo estiver indisponível/privado, cai no apelido do link ou texto genérico.
 */
export async function getMediaPromoInfo(
  link: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MediaPromoInfo> {
  const url = parseMediaLink(link);
  const { platform, handle } = platformAndHandle(url);
  const videoId = youtubeVideoId(url);
  let creatorName = handle;

  if (platform === "YouTube" && videoId) {
    const publicVideo = `https://www.youtube.com/watch?v=${videoId}`;
    const oembedUrl = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(publicVideo)}`;
    try {
      const response = await fetchImpl(oembedUrl, { signal: AbortSignal.timeout(4000) });
      if (response.ok) {
        const data: unknown = await response.json();
        if (data && typeof data === "object" && "author_name" in data && typeof data.author_name === "string") {
          creatorName = data.author_name;
        }
      }
    } catch {
      // Internet indisponível, vídeo privado ou oEmbed bloqueado: ainda publica.
    }
  }

  return {
    url: url.href,
    platform,
    creatorName: creatorName ? safeCreatorName(creatorName) : null,
    thumbnailUrl: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null,
  };
}

export function mediaPromoCopy(kind: MediaPromoKind, creatorName: string | null): {
  title: string;
  description: string;
  buttonLabel: string;
  footer: string;
} {
  if (kind === "live") {
    const opening = creatorName
      ? `📡 **${creatorName} está AO VIVO!**`
      : "📡 **TEM LIVE ROLANDO AGORA!**";
    return {
      title: "🔴 LIVE NO AR!",
      description: `${opening}\n\nA transmissão já começou! Chega mais para acompanhar cada momento, trocar aquela resenha e fortalecer nosso criador de conteúdo. ❤️\n\n**Não fica de fora dessa!** É só clicar no botão abaixo e aproveitar. 👇`,
      buttonLabel: "▶ Assistir à live",
      footer: "Gerais City RP • Transmissão ao vivo",
    };
  }

  const opening = creatorName
    ? `🍿 **Tem vídeo novo de ${creatorName}!**`
    : "🍿 **ACABOU DE SAIR VÍDEO NOVO!**";
  return {
    title: "🎬 VÍDEO NOVO NO AR!",
    description: `${opening}\n\nConteúdo fresquinho para você conferir! Dá o play, deixa seu like e fortalece o canal. Cada apoio faz a diferença! ❤️\n\n**Bora assistir?** O vídeo está a um clique de distância. 👇`,
    buttonLabel: "▶ Assistir ao vídeo",
    footer: "Gerais City RP • Conteúdo novo",
  };
}
