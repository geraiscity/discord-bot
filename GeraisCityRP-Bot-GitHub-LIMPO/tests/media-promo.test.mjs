import test from "node:test";
import assert from "node:assert/strict";
import {
  getMediaPromoInfo,
  mediaPromoCopy,
  parseMediaLink,
  platformAndHandle,
  safeCreatorName,
  youtubeVideoId,
} from "../src/media-promo-utils.ts";

test("aceita somente links HTTPS públicos e rejeita entradas inválidas", () => {
  assert.equal(parseMediaLink("https://youtu.be/aqz-KE-bpKQ").hostname, "youtu.be");
  for (const bad of ["http://youtube.com/watch?v=aqz-KE-bpKQ", "file:///etc/passwd", "javascript:alert(1)", "https://localhost/live", "https://user:pass@youtube.com", "texto sem link", "  ", "https://site-falso.example/video"]) {
    assert.throws(() => parseMediaLink(bad), /link|HTTPS|segurança|YouTube/i);
  }
});

test("reconhece links de live, watch, shorts e youtu.be", () => {
  const id = "aqz-KE-bpKQ";
  for (const link of [
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/live/${id}`,
    `https://youtu.be/${id}?t=30`,
    `https://youtube.com/shorts/${id}`,
  ]) {
    assert.equal(youtubeVideoId(new URL(link)), id);
  }
  assert.equal(youtubeVideoId(new URL("https://www.youtube.com/@canal/live")), null);
});

test("identifica Twitch, Kick e perfis públicos pelo link", () => {
  assert.deepEqual(platformAndHandle(new URL("https://www.twitch.tv/gamer_mg")), { platform: "Twitch", handle: "gamer_mg" });
  assert.deepEqual(platformAndHandle(new URL("https://kick.com/geraisrp")), { platform: "Kick", handle: "geraisrp" });
  assert.deepEqual(platformAndHandle(new URL("https://www.youtube.com/@criadorMG/live")), { platform: "YouTube", handle: "criadorMG" });
  assert.deepEqual(platformAndHandle(new URL("https://www.tiktok.com/@minasroleplay/video/123")), { platform: "TikTok", handle: "minasroleplay" });
});

test("busca autor do vídeo no oEmbed do YouTube e usa miniatura", async () => {
  let calledUrl;
  const fakeFetch = async (url) => {
    calledUrl = url;
    return { ok: true, json: async () => ({ author_name: "Canal Gerais RP" }) };
  };
  const info = await getMediaPromoInfo("https://youtu.be/aqz-KE-bpKQ", fakeFetch);
  assert.match(calledUrl, /^https:\/\/www\.youtube\.com\/oembed\?/);
  assert.deepEqual(info, {
    url: "https://youtu.be/aqz-KE-bpKQ",
    platform: "YouTube",
    creatorName: "Canal Gerais RP",
    thumbnailUrl: "https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg",
  });
});

test("continua funcionando offline e não consulta links fora do YouTube", async () => {
  let calls = 0;
  const fakeFetch = async () => { calls++; throw new Error("Sem rede"); };
  const youtube = await getMediaPromoInfo("https://youtube.com/watch?v=aqz-KE-bpKQ", fakeFetch);
  assert.equal(youtube.creatorName, null);
  assert.equal(calls, 1);
  const twitch = await getMediaPromoInfo("https://twitch.tv/StreamerMG", fakeFetch);
  assert.equal(twitch.creatorName, "StreamerMG");
  assert.equal(calls, 1);
});

test("escapa marcações e desativa @menções em nomes públicos", () => {
  assert.equal(safeCreatorName("  @everyone **teste** \n"), "@\u200beveryone \\*\\*teste\\*\\*");
  assert.equal(safeCreatorName(" \n  "), null);
});

test("modelos live e vídeo têm títulos, textos e botões diferentes", () => {
  const live = mediaPromoCopy("live", "Criador MG");
  const video = mediaPromoCopy("video", "Criador MG");
  assert.equal(live.title, "🔴 LIVE NO AR!");
  assert.equal(video.title, "🎬 VÍDEO NOVO NO AR!");
  assert.match(live.description, /Criador MG está AO VIVO/);
  assert.match(video.description, /Tem vídeo novo de Criador MG/);
  assert.match(live.buttonLabel, /live/i);
  assert.match(video.buttonLabel, /vídeo/i);
  assert.match(mediaPromoCopy("live", null).description, /TEM LIVE/);
  assert.match(mediaPromoCopy("video", null).description, /VÍDEO NOVO/);
});
