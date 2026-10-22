import test from "node:test";
import assert from "node:assert/strict";

process.env.DISCORD_CLIENT_ID = "123456789012345678";
process.env.DISCORD_CLIENT_SECRET = "segredo-de-teste-com-tamanho-suficiente";
process.env.VERIFICATION_OAUTH_REDIRECT_URI = "https://bot.example.com/auth/discord/callback";
process.env.VERIFICATION_STATE_SECRET = "estado-super-secreto-com-mais-de-trinta-e-dois-caracteres";

const { createVerificationState, verifyVerificationState, buildOauthAuthorizationUrl, oauthVerificationConfigured } = await import("../src/verification-oauth.ts");

test("OAuth2 de verificação exige configuração completa", () => {
  assert.equal(oauthVerificationConfigured(), true);
});

test("state assinado valida usuário/servidor e expira", () => {
  const now = 1_800_000_000_000;
  const state = createVerificationState("111111111111111111", "222222222222222222", now);
  const decoded = verifyVerificationState(state, now + 60_000);
  assert.equal(decoded?.g, "111111111111111111");
  assert.equal(decoded?.u, "222222222222222222");
  assert.equal(verifyVerificationState(`${state}x`, now + 60_000), null);
  assert.equal(verifyVerificationState(state, now + 11 * 60_000), null);
});

test("URL usa authorization code e escopos identify + email", () => {
  const url = new URL(buildOauthAuthorizationUrl("111111111111111111", "222222222222222222"));
  assert.equal(url.origin, "https://discord.com");
  assert.equal(url.pathname, "/oauth2/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), "identify email");
  assert.ok(url.searchParams.get("state"));
});
