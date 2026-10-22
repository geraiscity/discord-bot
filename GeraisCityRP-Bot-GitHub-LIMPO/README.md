# Gerais City RP Bot

Versão limpa/standalone do bot Discord do Gerais City RP, preparada para GitHub e hospedagem fora do Replit.

## Estrutura

- `src/` — código-fonte do bot
- `tests/` — testes automatizados
- `ROBLOX-BRIDGE-SERVER.lua` — bridge Roblox → Discord
- `.env.example` — lista de variáveis necessárias, sem valores secretos

## Instalação

```bash
npm install
```

## Iniciar

```bash
npm start
```

## Testes

```bash
npm test
```

## Build opcional

```bash
npm run build
```

> Não envie `.env`, `.data/`, tokens do Discord, chaves do Roblox ou outros Secrets para o GitHub.
