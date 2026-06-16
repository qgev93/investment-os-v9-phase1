import type { EdgeZonePortfolioCandidate } from "./btcusdtResearch.js";

export interface BtcusdcCoreGateBatchArgsOptions {
  cliPath: string;
  days: number;
  maxCandles: number;
  registryPath: string;
  cacheFile?: string;
  candidates: EdgeZonePortfolioCandidate[];
  batchSize: number;
}

function serializePortfolioCandidate(candidate: EdgeZonePortfolioCandidate): string {
  return [
    candidate.label ?? `${candidate.strategyId}:${candidate.zoneId}`,
    candidate.strategyId,
    candidate.zoneId,
    candidate.entryMode,
    String(candidate.targetR),
    String(candidate.maxHoldFiveMinuteBars),
  ].join("|");
}

function chunkCandidates(
  candidates: EdgeZonePortfolioCandidate[],
  batchSize: number,
): EdgeZonePortfolioCandidate[][] {
  const safeBatchSize = Math.max(1, Math.floor(batchSize));
  const chunks: EdgeZonePortfolioCandidate[][] = [];
  for (let index = 0; index < candidates.length; index += safeBatchSize) {
    chunks.push(candidates.slice(index, index + safeBatchSize));
  }
  return chunks;
}

export function buildBtcusdcCoreGateBatchArgs(
  options: BtcusdcCoreGateBatchArgsOptions,
): string[][] {
  const candidateBatches = chunkCandidates(options.candidates, options.batchSize);
  return candidateBatches.map((batch) => {
    const args = [
      options.cliPath,
      "trading:research-btcusdc-core-gate",
      "--days",
      String(options.days),
      "--max-candles",
      String(options.maxCandles),
      "--registry-path",
      options.registryPath,
      "--registry-out",
      options.registryPath,
      "--no-send",
      "--portfolio-candidates",
      batch.map(serializePortfolioCandidate).join(";"),
    ];
    if (options.cacheFile) {
      args.splice(args.length - 2, 0, "--cache-file", options.cacheFile);
    }
    return args;
  });
}
