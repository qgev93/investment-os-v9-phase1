import type { Phase1Config } from "./types.js";

const PAID_PROVIDERS = new Set(["x_ppu", "apify_paid", "openai_paid", "anthropic_paid"]);

export function rejectPaidProvider(config: Phase1Config, provider: string): void {
  if (!config.allowPaidProviders && PAID_PROVIDERS.has(provider)) {
    throw new Error(`Paid provider ${provider} is disabled`);
  }
}
