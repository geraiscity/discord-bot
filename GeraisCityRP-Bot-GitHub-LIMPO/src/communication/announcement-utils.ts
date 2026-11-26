/** Funções puras para anúncios e imagens de painéis. */
export const MAX_ANNOUNCEMENT_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_ANNOUNCEMENT_TOTAL_BYTES = 24 * 1024 * 1024;
export const MAX_ANNOUNCEMENT_MEDIA_BYTES = 20 * 1024 * 1024;
export const MAX_ANNOUNCEMENT_MEDIA_ITEMS = 10;

/** O prefixo SPOILER_ faz o Discord borrar o anexo até o clique. */
export function announcementImageName(name: string, spoiler: boolean): string {
  const normalized = name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "_");
  const basename = normalized.slice(-90).replace(/^\.+/, "") || "imagem.png";
  return spoiler ? `SPOILER_${basename.replace(/^SPOILER_/i, "")}` : `imagem_${basename.replace(/^SPOILER_/i, "")}`;
}

export function announcementMediaName(name: string): string {
  const normalized = name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "_");
  const basename = normalized.slice(-90).replace(/^\.+/, "") || "midia.bin";
  return `anuncio_${basename.replace(/^SPOILER_/i, "")}`;
}

export function isAcceptedImage(name: string, mime: string | null): boolean {
  const validExtension = /\.(?:png|jpe?g|gif|webp)$/i.test(name);
  return validExtension && (!mime || /^image\/(?:png|jpe?g|gif|webp)$/i.test(mime));
}

export function isAcceptedAnnouncementMedia(name: string, mime: string | null): boolean {
  const validExtension = /\.(?:png|jpe?g|gif|webp|mp4|mov|webm)$/i.test(name);
  if (!validExtension) return false;
  if (!mime) return true;
  return /^(?:image\/(?:png|jpe?g|gif|webp)|video\/(?:mp4|quicktime|webm))$/i.test(mime);
}
