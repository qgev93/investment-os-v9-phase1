import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolve(root, process.argv[2] ?? ".phase1/local-store.json");
const outputPath = resolve(root, process.argv[3] ?? ".phase1/d1-import.sql");

function sqlString(value) {
  if (value === undefined || value === null) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : String(fallback);
}

function sqlBool(value) {
  return value ? "1" : "0";
}

function statement(table, columns, values) {
  return `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${values.join(", ")});`;
}

if (!existsSync(inputPath)) {
  throw new Error(`Local store not found: ${inputPath}`);
}

const snapshot = JSON.parse(readFileSync(inputPath, "utf8"));
const lines = [];

for (const row of snapshot.ledger ?? []) {
  lines.push(statement(
    "ledger_posts",
    ["post_id", "expert_handle", "trust_layer", "fetched_via", "is_rt_only", "cost_usd"],
    [
      sqlString(row.postId),
      sqlString(row.expertHandle),
      sqlString(row.trustLayer),
      sqlString(row.fetchedVia),
      sqlBool(row.isRtOnly),
      sqlNumber(row.costUsd),
    ],
  ));
}

for (const row of snapshot.rtArchive ?? []) {
  lines.push(statement(
    "rt_only_archive",
    ["post_id", "expert_handle", "retweeted_post_id", "self_rt", "notes"],
    [
      sqlString(row.postId),
      sqlString(row.expertHandle),
      sqlString(row.retweetedPostId),
      sqlBool(row.selfRt),
      sqlString(row.notes),
    ],
  ));
}

for (const row of snapshot.contextUnits ?? []) {
  lines.push(statement(
    "context_units",
    [
      "unit_id",
      "expert_handle",
      "original_text",
      "completed_at",
      "canonical_status",
      "rt_only_excluded",
      "structural_basis_json",
      "triage_decision",
      "triage_sent_at",
      "triage_message_id",
      "internalization_state",
    ],
    [
      sqlString(row.unitId),
      sqlString(row.expertHandle),
      sqlString(row.originalText),
      sqlString(row.completedAt),
      sqlString(row.canonicalStatus),
      sqlBool(row.rtOnlyExcluded),
      sqlString(JSON.stringify(row.structuralBasis ?? [])),
      sqlString(row.triageDecision),
      sqlString(row.triageSentAt),
      row.triageMessageId === undefined ? "NULL" : sqlNumber(row.triageMessageId),
      sqlString(row.internalizationState),
    ],
  ));
}

for (const row of snapshot.chairmanAttempts ?? []) {
  lines.push(statement(
    "chairman_attempts",
    ["unit_id", "attempt_text", "attempted_at"],
    [sqlString(row.unitId), sqlString(row.attemptText), sqlString(row.attemptedAt)],
  ));
}

writeFileSync(outputPath, `${lines.join("\n")}\n`);
console.log(`Wrote ${outputPath}`);
