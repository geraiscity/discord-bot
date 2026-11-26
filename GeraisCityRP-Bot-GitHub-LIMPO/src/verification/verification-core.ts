export interface VerificationSignals {
  accountAgeMs: number;
  minAccountDays: number;
  isBot: boolean;
  pending: boolean;
  requireScreening: boolean;
  requireNativeDiscordVerification: boolean;
  nativeDiscordVerificationEnabled: boolean;
}

export interface VerificationDecisionCore {
  ok: boolean;
  reason: string;
  accountAgeDays: number;
}

const DAY = 86_400_000;

export function evaluateVerificationSignals(input: VerificationSignals): VerificationDecisionCore {
  const accountAgeDays = Math.floor(Math.max(0, input.accountAgeMs) / DAY);
  if (input.isBot) {
    return { ok: false, reason: "Contas de bot não podem usar a verificação de membros.", accountAgeDays };
  }
  if (accountAgeDays < input.minAccountDays) {
    return {
      ok: false,
      reason: `Sua conta tem aproximadamente **${accountAgeDays} dia(s)**. O mínimo é **${input.minAccountDays} dias**.`,
      accountAgeDays,
    };
  }
  if (input.requireScreening && input.pending) {
    return {
      ok: false,
      reason: "Conclua primeiro a triagem/regras de entrada exibidas pelo Discord e tente novamente.",
      accountAgeDays,
    };
  }
  if (input.requireNativeDiscordVerification && !input.nativeDiscordVerificationEnabled) {
    return {
      ok: false,
      reason: "A verificação nativa do Discord não está ativa neste servidor. Avise a administração.",
      accountAgeDays,
    };
  }
  return { ok: true, reason: "Requisitos automáticos atendidos.", accountAgeDays };
}
