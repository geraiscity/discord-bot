import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ANNOUNCEMENT_IMAGE_BYTES,
  MAX_ANNOUNCEMENT_MEDIA_BYTES,
  MAX_ANNOUNCEMENT_MEDIA_ITEMS,
  MAX_ANNOUNCEMENT_TOTAL_BYTES,
  announcementImageName,
  announcementMediaName,
  isAcceptedAnnouncementMedia,
  isAcceptedImage,
} from "../src/announcement-utils.ts";

test("fotos protegidas recebem prefixo correto; fotos normais não", () => {
  assert.equal(announcementImageName("nova viatura.png", true), "SPOILER_nova_viatura.png");
  assert.equal(announcementImageName("SPOILER_foto.jpg", true), "SPOILER_foto.jpg");
  assert.equal(announcementImageName("SPOILER_foto.jpg", false), "imagem_foto.jpg");
});

test("aceita apenas anexos de imagens comuns e respeita limites antigos de painéis", () => {
  assert.equal(isAcceptedImage("foto.png", "image/png"), true);
  assert.equal(isAcceptedImage("foto.webp", null), true);
  assert.equal(isAcceptedImage("script.js", "image/png"), false);
  assert.equal(isAcceptedImage("foto.svg", "image/svg+xml"), false);
  assert.equal(isAcceptedImage("foto.png", "application/octet-stream"), false);
  assert.equal(MAX_ANNOUNCEMENT_IMAGE_BYTES, 8 * 1024 * 1024);
  assert.equal(MAX_ANNOUNCEMENT_TOTAL_BYTES, 24 * 1024 * 1024);
});

test("anúncio novo aceita imagens e vídeos e limita a galeria", () => {
  assert.equal(isAcceptedAnnouncementMedia("foto.jpg", "image/jpeg"), true);
  assert.equal(isAcceptedAnnouncementMedia("animacao.gif", "image/gif"), true);
  assert.equal(isAcceptedAnnouncementMedia("trailer.mp4", "video/mp4"), true);
  assert.equal(isAcceptedAnnouncementMedia("clip.mov", "video/quicktime"), true);
  assert.equal(isAcceptedAnnouncementMedia("clip.webm", "video/webm"), true);
  assert.equal(isAcceptedAnnouncementMedia("arquivo.pdf", "application/pdf"), false);
  assert.equal(MAX_ANNOUNCEMENT_MEDIA_BYTES, 20 * 1024 * 1024);
  assert.equal(MAX_ANNOUNCEMENT_MEDIA_ITEMS, 10);
  assert.equal(announcementMediaName("Vídeo lançamento.mp4"), "anuncio_Vi_deo_lanc_amento.mp4");
});
