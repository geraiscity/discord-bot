# Arquitetura V1.4
O ponto de entrada continua em src/index.ts; o diretório de trabalho da hospedagem não mudou. Os módulos foram separados por domínio: core, config, commands, security, audit, backups, diagnostics, performance, database, tickets, verification, roblox, panels e communication.
A implementação de interações e parte dos tickets ainda está em core/bootstrap.ts; a extração deve ser gradual, com testes.
Dados e nomes internos legados foram preservados para compatibilidade.
## Validação antes de produção
- npm install; npm run build; npm run typecheck; npm test.
- Usar um servidor Discord de teste e testar permissões, menus e entrega de logs. Validar que a manutenção expira sem reativar automação quando Safe Mode estiver ativo.
- Restaurar backup de teste duas vezes e confirmar que o mapeamento evita duplicatas. Um crash entre a criação e a gravação do mapa ainda pode requerer reconciliação manual. Snapshots não incluem mensagens ou vínculos de membros.
- Confirmar persistência de .data e PostgreSQL. Auditar retenção e acesso aos arquivos .data/audit. A fila é limitada; eventos podem ser descartados quando saturada; não há replay automático.
- Instalar o ModuleScript atualizado e testar eventos antes de exigir ROBLOX_BRIDGE_REQUIRE_V2=true. V2 usa chave compartilhada, timestamp e deduplicação em memória; não é assinatura criptográfica do payload.
- Validar métricas e desempenho real sob carga. Só então liberar produção.
