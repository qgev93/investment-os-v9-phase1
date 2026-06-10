interface CostInput {
  spentKrw: number;
  softAlertKrw?: number;
  hardStopKrw?: number;
}

export function buildCostDecision(input: CostInput) {
  const softAlertKrw = input.softAlertKrw ?? 300_000;
  const hardStopKrw = input.hardStopKrw ?? 500_000;

  if (input.spentKrw >= hardStopKrw) {
    return {
      state: "hard_stop" as const,
      allowOfflineBatch: false,
      allowNewPaidVerification: false,
      allowNewDeepSession: false,
    };
  }

  if (input.spentKrw >= softAlertKrw) {
    return {
      state: "soft_alert" as const,
      allowOfflineBatch: false,
      allowNewPaidVerification: true,
      allowNewDeepSession: true,
    };
  }

  return {
    state: "ok" as const,
    allowOfflineBatch: true,
    allowNewPaidVerification: true,
    allowNewDeepSession: true,
  };
}
