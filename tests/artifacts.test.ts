import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function exists(path: string): boolean {
  return existsSync(new URL(`../${path}`, import.meta.url));
}

describe("Phase 1 implementation artifacts", () => {
  it("defines the v3 plus v3A4 database tables and hard gates", () => {
    const sql = read("db/migrations/001_phase1_schema.sql");

    for (const table of [
      "context_units",
      "daily_ingestion_jobs",
      "internalization_sessions",
      "model_call_logs",
      "x_resource_ledger",
      "rt_only_archive",
      "pattern_signatures",
      "jit_verification_queue",
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }

    expect(sql).toContain("canonical_status IN ('pending','verified','quarantined')");
    expect(sql).toContain("auto_skip_allowed BOOLEAN NOT NULL DEFAULT FALSE");
    expect(sql).toContain("trust_layer IN ('canonical','gray','quarantined','pending')");
  });

  it("ships Korean fixture data for all three Elite handles", () => {
    const fixture = JSON.parse(read("fixtures/korean-sample-run.json")) as {
      experts: string[];
      posts: Array<{ expert_handle: string; post_id: string }>;
    };

    expect(fixture.experts).toEqual([
      "@min_anko38",
      "@LNCV34",
      "@Alisvolatprop12",
    ]);
    expect(new Set(fixture.posts.map((post) => post.expert_handle))).toEqual(
      new Set(fixture.experts),
    );
  });

  it("exports n8n workflows with paid provider steps disabled by default", () => {
    const workflows = [
      JSON.parse(read("n8n/workflows/historical_setup.json")),
      JSON.parse(read("n8n/workflows/daily_ingestion.json")),
      JSON.parse(read("n8n/workflows/triage_supply_loop.json")),
    ] as Array<{ nodes: Array<{ name: string; disabled?: boolean }> }>;

    for (const workflow of workflows) {
      const paidNodes = workflow.nodes.filter((node) => node.name.includes("PAID"));
      expect(paidNodes.length).toBeGreaterThan(0);
      expect(paidNodes.every((node) => node.disabled === true)).toBe(true);
    }
  });

  it("configures n8n local API calls to persist by default", () => {
    const workflowText = [
      read("n8n/workflows/historical_setup.json"),
      read("n8n/workflows/daily_ingestion.json"),
      read("n8n/workflows/triage_supply_loop.json"),
    ].join("\n");

    expect(workflowText).not.toContain("\\\"dryRun\\\":true");
    expect(workflowText).toContain("http://127.0.0.1:4319/ingest/historical");
    expect(workflowText).toContain("http://127.0.0.1:4319/jit/enqueue");
    expect(workflowText).toContain("\"specifyBody\": \"json\"");
  });

  it("ships a Cloudflare Worker webhook scaffold for phone-only operation", () => {
    const wrangler = read("wrangler.toml");
    const worker = read("cloudflare/telegram-worker.js");
    const d1Schema = read("db/d1/001_phase1_schema.sql");

    expect(wrangler).toContain("main = \"cloudflare/telegram-worker.js\"");
    expect(wrangler).toContain("binding = \"PHASE1_DB\"");
    expect(worker).toContain("TELEGRAM_BOT_TOKEN");
    expect(worker).toContain("PHASE1_DB");
    expect(worker).toContain("callback_query");
    expect(worker).toContain("/telegram/register-webhook");
    expect(worker).toContain("/telegram/send-menu");
    expect(worker).toContain("setWebhook");
    expect(worker).toContain("TRIAGE_CHAT_ID");
    expect(worker).toContain("triage:");
    expect(worker).toContain("internalization:");
    expect(worker).toContain("setInternalizationState");
    expect(d1Schema).toContain("CREATE TABLE IF NOT EXISTS ledger_posts");
    expect(d1Schema).toContain("CREATE TABLE IF NOT EXISTS context_units");
    expect(d1Schema).toContain("CREATE TABLE IF NOT EXISTS ai_cost_ledger");
  });

  it("asks DeepSeek to judge the whole triage context, not isolated lines", () => {
    const worker = read("cloudflare/telegram-worker.js");

    expect(worker).toContain("triageJudgePrompt");
    expect(worker).toContain("parseTriageJudgeText");
    expect(worker).toContain("scores");
    expect(worker).toContain("extracted_principle");
  });

  it("uses strict score-based triage grades before deciding internalization", () => {
    const worker = read("cloudflare/telegram-worker.js");
    const d1Schema = read("db/d1/001_phase1_schema.sql");

    for (const scoreKey of [
      "thinking",
      "reusability",
      "context_completeness",
      "rarity",
      "noise_penalty",
    ]) {
      expect(worker).toContain(scoreKey);
    }

    expect(worker).toContain("gradeFromTriageScore");
    expect(worker).toContain("judgeTriageWithDeepSeek");
    expect(worker).toContain("deepseek-v4-flash");
    expect(worker).toContain("A/B");
    expect(worker).toContain("triage_rationale_json");
    expect(worker).toContain("triage_grade");
    expect(worker).toContain("triage_score");
    expect(d1Schema).toContain("triage_rationale_json TEXT");
    expect(d1Schema).toContain("triage_grade TEXT");
    expect(d1Schema).toContain("triage_score INTEGER");
  });

  it("requires human approval before AI-selected units enter the internalization bot", () => {
    const worker = read("cloudflare/telegram-worker.js");

    expect(worker).toContain("sendTriageReviewCard");
    expect(worker).toContain("triage:approve");
    expect(worker).toContain("triage:reject");
    expect(worker).toContain("pendingApproval");
    expect(worker).toContain("resendQueuedForApproval");
    expect(worker).toContain("/telegram/resend-queued-for-approval");
    expect(worker).toContain("resendPendingApproval");
    expect(worker).toContain("/telegram/resend-pending-approval");
    expect(worker).not.toContain("\"AI 이유\"");
    expect(worker).not.toContain("\"뽑힌 원칙\"");
    expect(worker).not.toContain("AI 자동 구분으로 체화봇에");
  });

  it("cleans stale Telegram bot messages before showing the next screen", () => {
    const worker = read("cloudflare/telegram-worker.js");
    const d1Schema = read("db/migrations/001_phase1_schema.sql");

    expect(worker).toContain("cleanupTrackedMessages");
    expect(worker).toContain("rememberTrackedMessage");
    expect(worker).toContain("sendTrackedMessage");
    expect(worker).toContain("cleanupBefore");
    expect(d1Schema).toContain("bot_message_cleanup");
  });

  it("sends only one triage approval card at a time", () => {
    const worker = read("cloudflare/telegram-worker.js");
    const wrangler = read("wrangler.toml");

    expect(worker).toContain("MAX_PENDING_APPROVAL_CARDS");
    expect(worker).toContain("pendingApproval >= MAX_PENDING_APPROVAL_CARDS");
    expect(worker).toContain("hasPendingApproval");
    expect(worker).toContain("runOneTriageStep");
    expect(worker).toContain("callback_data: \"ops:auto_triage\"");
    expect(worker).not.toContain("ops:status");
    expect(worker).not.toContain("ops:help");
    expect(worker).toContain("sendOldestPendingApproval");
    expect(worker).toContain("AUTO_TRIAGE_SCAN_LIMIT");
    expect(wrangler).toContain('AUTO_TRIAGE_BATCH_LIMIT = "10"');
    expect(wrangler).toContain('AUTO_TRIAGE_SCAN_LIMIT = "10"');
  });

  it("does not block Telegram button callbacks while DeepSeek triage runs", () => {
    const worker = read("cloudflare/telegram-worker.js");

    expect(worker).toContain("handleOps(env, callback, ctx)");
    expect(worker).toContain("ctx?.waitUntil");
    expect(worker).toContain("runTriageUntilReviewCard");
    expect(worker).toContain("runTriageUntilReviewCard(env, chatId)");
    expect(worker).not.toContain("sendBackgroundFailureFallback");
    expect(worker).not.toContain('text: "다음"');
    expect(worker).toContain("handleWebhook(request, env, botRole, ctx)");
    expect(worker).toContain("handleWebhook(request, env, \"triage\", ctx)");
  });

  it("automates triage instead of showing manual internalize/skip buttons", () => {
    const worker = read("cloudflare/telegram-worker.js");

    expect(worker).not.toContain('{ text: "이 맥락 체화",');
    expect(worker).not.toContain('{ text: "이 맥락 넘김",');
    expect(worker).toContain("runOneTriageStep");
    expect(worker).toContain("autoTriageBatch");
    expect(worker).toContain("/telegram/auto-triage");
    expect(worker).toContain("async scheduled");
    expect(read("wrangler.toml")).toContain("AUTO_TRIAGE_BATCH_LIMIT");
  });

  it("asks AI hints to extract reusable investment thinking, not shallow summaries", () => {
    const worker = read("cloudflare/telegram-worker.js");

    expect(worker).toContain("체화 힌트");
    expect(worker).toContain("상황");
    expect(worker).toContain("생각 순서");
    expect(worker).toContain("판단 기준");
    expect(worker).toContain("반대로 틀릴 수 있는 경우");
    expect(worker).toContain("내가 바로 써먹을 질문");
    expect(worker).toContain("요약으로 끝내지 말고");
  });

  it("continues to the next internalization unit after completing one", () => {
    const worker = read("cloudflare/telegram-worker.js");

    expect(worker).toContain('parsed.action === "complete"');
    expect(worker).toContain('const nextUnit = await getContextUnit(env, "active")');
    expect(worker).toContain("internalizationMessage(nextUnit)");
    expect(worker).toContain("nextUnitId: nextUnit.unit_id");
  });

  it("keeps the original context visible when requesting AI help", () => {
    const worker = read("cloudflare/telegram-worker.js");

    expect(worker).toContain('const provider = "deepseek"');
    expect(worker).not.toContain('action === "mastery_check" ? "anthropic" : "deepseek"');
    expect(worker).toContain('const keepCurrentMessage = parsed.action === "hint" || parsed.action === "mastery_check"');
    expect(worker).toContain("if (!keepCurrentMessage) await clearClickedMessage");
    expect(worker).toContain("cleanupBefore: !keepCurrentMessage");
    expect(worker).toContain("remember: !keepCurrentMessage");
  });

  it("asks mastery checks as multi-angle thinking prompts", () => {
    const worker = read("cloudflare/telegram-worker.js");

    expect(worker).toContain("mastery_check");
    expect(worker).toContain('parsed.action === "hint" || parsed.action === "mastery_check"');
    expect(worker).toContain("buildAiInternalizationText");
  });

  it("replies to typed internalization answers against the active context", () => {
    const worker = read("cloudflare/telegram-worker.js");

    expect(worker).toContain("handleInternalizationText");
    expect(worker).toContain("answer_feedback");
    expect(worker).toContain("aiAnswerFeedbackPrompt");
    expect(worker).toContain("buildAnswerFeedbackText");
    expect(worker).toContain("answerFeedbackFallback");
    expect(worker).toContain("internalization:answer_feedback");
    expect(worker).toContain('botRole === "internalization" && update.message?.text');
    expect(worker).toContain('getContextUnit(env, "active")');
  });

  it("ships a local JSON to D1 SQL export script", () => {
    const script = read("scripts/export-local-store-to-d1-sql.mjs");

    expect(script).toContain("local-store.json");
    expect(script).toContain("INSERT OR REPLACE INTO ${table}");
    expect(script).toContain("\"ledger_posts\"");
    expect(script).toContain("\"context_units\"");
    expect(script).toContain("structural_basis_json");
  });

  it("ships PC-off X collection automation without committing API secrets", () => {
    const workflow = read(".github/workflows/xapi-daily.yml");
    const collect = read("scripts/xapi/collect.py");
    const enrich = read("scripts/xapi/enrich.py");
    const fixNotFound = read("scripts/xapi/fix_not_found.py");
    const docs = read("scripts/xapi/README.md");
    const gitignore = read(".gitignore");

    expect(exists("scripts/xapi/rebuild_trees.py")).toBe(true);
    expect(exists("scripts/xapi/requirements.txt")).toBe(true);
    expect(workflow).toContain("schedule:");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("GETXAPI_KEY: ${{ secrets.GETXAPI_KEY }}");
    expect(workflow).toContain("CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}");
    expect(workflow).toContain("WORKER_ADMIN_TOKEN: ${{ secrets.WORKER_ADMIN_TOKEN }}");
    expect(workflow).toContain("PHASE1_STORE_PATH=automation/xapi-data/local-store.json");
    expect(workflow).toContain("wrangler d1 execute investment-os-v9-phase1 --remote");
    expect(workflow).toContain("/telegram/auto-triage");
    expect(workflow).toContain("x-admin-token: $WORKER_ADMIN_TOKEN");
    expect(workflow).toContain('--data \'{"limit":10}\'');
    expect(collect).toContain('os.environ.get("GETXAPI_KEY")');
    expect(enrich).toContain('os.environ.get("GETXAPI_KEY")');
    expect(fixNotFound).toContain('os.environ.get("GETXAPI_KEY")');
    expect(`${collect}\n${enrich}\n${fixNotFound}`).not.toContain("get-x-api-");
    expect(gitignore).toContain("automation/xapi-data/");
    expect(docs).toContain("GETXAPI_KEY");
    expect(docs).toContain("GitHub Secrets");
  });

  it("uses Claude for first-pass triage with DeepSeek fallback", () => {
    const worker = read("cloudflare/telegram-worker.js");
    const wrangler = read("wrangler.toml");
    const readme = read("README.md");

    expect(worker).toContain("judgeTriageWithClaude");
    expect(worker).toContain("fallbackFrom: \"anthropic\"");
    expect(worker).toContain("judgeTriageWithDeepSeek");
    expect(wrangler).toContain('AI_PROVIDER_PRIMARY = "deepseek"');
    expect(wrangler).toContain('AI_MODEL_PRIMARY = "deepseek-v4-flash"');
    expect(wrangler).toContain('AI_PROVIDER_JUDGE = "anthropic"');
    expect(wrangler).toContain('AI_MODEL_JUDGE = "claude-haiku-4-5-20251001"');
    expect(wrangler).toContain('AUTO_TRIAGE_BATCH_LIMIT = "10"');
    expect(wrangler).toContain('AUTO_TRIAGE_SCAN_LIMIT = "10"');
    expect(readme).toContain("Claude Haiku 4.5");
    expect(readme).toContain("DeepSeek fallback");
  });

  it("protects public Worker operations with an admin token", () => {
    const worker = read("cloudflare/telegram-worker.js");
    const wrangler = read("wrangler.toml");
    const envExample = read(".env.example");

    expect(worker).toContain("function requireAdminRequest");
    expect(worker).toContain("env.ADMIN_TOKEN");
    expect(worker).toContain('request.headers.get("x-admin-token")');
    expect(worker).toContain('request.headers.get("authorization")');
    expect(worker).toContain("Admin token required");
    for (const path of [
      "/telegram/register-webhook",
      "/telegram/send-menu",
      "/telegram/send-internalization-home",
      "/telegram/send-internalization-active",
      "/telegram/send-next-triage",
      "/telegram/auto-triage",
      "/telegram/resend-queued-for-approval",
      "/telegram/resend-pending-approval",
    ]) {
      expect(worker).toContain("requireAdminRequest(request, env)");
      expect(worker).toContain(`url.pathname === "${path}"`);
    }
    expect(wrangler).not.toContain("TRIAGE_CHAT_ID = \"1650645259\"");
    expect(wrangler).not.toContain("INTERNALIZATION_CHAT_ID = \"1650645259\"");
    expect(envExample).not.toContain("TRIAGE_CHAT_ID=1650645259");
  });
});
