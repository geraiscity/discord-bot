# Gerais City RP — Final 1.3

## Comandos mais limpos

- `/seguranca` foi removido da lista de slash commands.
- As funções do Gerais Shield foram movidas para `/painel-admin` → **Segurança**.
- O painel de Segurança agora possui controles para status, ativar/desativar, alternar modo, Safe Mode, incidentes, snapshots, liberação de raid e teste de alertas.
- A tela **Configurações** do Security Center reúne allowlist de bots, equipe confiável, canal privado de logs, verificação, detalhe de incidente e restauração de snapshot.
- O sincronizador também remove versões antigas globais de `/seguranca` e `/spoiler`.

## `/anunciar` simplificado

O comando agora possui apenas:

- `titulo` — obrigatório
- `mensagem` — opcional
- `cor` — opcional
- `mencao` — opcional

Ao confirmar o comando, abre um único seletor **Fotos / vídeo**, que permite escolher até 10 arquivos de uma vez. O seletor aceita PNG, JPG, GIF, WebP, MP4, MOV e WebM.

O envio usa Components V2: título e mensagem ficam acima, e a galeria de fotos/vídeos fica abaixo. Isso corrige o layout antigo em que anexos podiam aparecer antes do texto.

## Correções preservadas

- Inclui a correção de `interaction.guild/channelId` que eliminou os erros TS2532/TS2769 da Final 1.2.
- Mantém Roblox Bridge, painel administrativo, tickets de compras, logs unificados, Shield, verificação e persistência da Final 1.2.
