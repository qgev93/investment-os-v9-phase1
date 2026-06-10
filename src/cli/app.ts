import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPhase1FileStore, createPhase1Store, ingestFixtureIntoStore, withFileStoreBatch, type Phase1Store } from "../db/index.js";
import { parseManualImportFile } from "../ingestion/manualImport.js";
import { ingestPostsIntoStore } from "../ingestion/storeIngestion.js";
import { ingestXApiContextUnitsIntoStore, parseXApiContextUnitFile } from "../ingestion/xApiContextUnits.js";
import {
  TelegramBotClient,
  type TelegramMessagePayload,
  buildTelegramInternalizationMessage,
  buildTelegramOpsMenuMessage,
  buildTelegramTriageMessage,
  requireTelegramToken,
} from "../telegram/client.js";
import { handleTelegramCallback } from "../telegram/callbacks.js";
import { handleTelegramTextAttempt } from "../telegram/internalization.js";
import { loadTelegramOffset, saveTelegramOffset } from "../telegram/pollState.js";
import { TRIAGE_ACTION_BUTTONS } from "../telegram/labels.js";
import {
  buildCostDecision,
  canEnterTriage,
  enqueueJitBatch,
  loadPhase1Config,
  type CanonicalStatus,
} from "../domain/index.js";

interface FixturePost {
  post_id: string;
  expert_handle: string;
  text: string;
  created_at: string;
  trust_layer: "canonical" | "gray" | "pending";
  is_rt_only: boolean;
  structural_basis: string[];
}

interface FixtureData {
  experts: string[];
  posts: FixturePost[];
}

export interface CommandResult {
  ok: boolean;
  data: unknown;
}

interface TelegramPollSummary {
  updatesSeen: number;
  callbacksHandled: number;
  textCommandsHandled: number;
  textAttemptsHandled: number;
  nextOffset?: number;
  results: unknown[];
}

const memoryStores = new Map<string, Phase1Store>();
const OPS_MENU_VERSION = "triage-internalization-split-v1";

interface TelegramMenuState {
  chatId: string;
  messageId: number;
  menuVersion: string;
  sentAt: string;
}

function projectRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

function loadFixture(): FixtureData {
  const path = resolve(projectRoot(), "fixtures/korean-sample-run.json");
  return JSON.parse(readFileSync(path, "utf8")) as FixtureData;
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function getStore(env: Record<string, string | undefined>): Phase1Store {
  if (env.DATABASE_URL) {
    return createPhase1Store(env);
  }

  const key = env.PHASE1_MEMORY_STORE_KEY ?? env.PHASE1_STORE_PATH ?? "default";
  const existing = memoryStores.get(key);
  if (existing) return existing;

  const store = createPhase1FileStore(env);
  memoryStores.set(key, store);
  return store;
}

function canonicalStatusFor(post: FixturePost): CanonicalStatus {
  if (post.trust_layer === "canonical") return "verified";
  if (post.trust_layer === "gray") return "pending";
  return "pending";
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function telegramMenuStatePath(env: Record<string, string | undefined>): string {
  return env.TELEGRAM_MENU_STATE_PATH ?? resolve(".phase1/telegram-menu-state.json");
}

function readTelegramMenuState(path: string): TelegramMenuState | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as TelegramMenuState;
}

function writeTelegramMenuState(path: string, state: TelegramMenuState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

async function buildOpsStatus(store: Phase1Store) {
  const contextUnits = await store.listContextUnits();
  const triageDecisions: Record<string, number> = {};
  const internalizationStates: Record<string, number> = {};
  let chairmanAttempts = 0;

  for (const unit of contextUnits) {
    if (unit.triageDecision) {
      triageDecisions[unit.triageDecision] = (triageDecisions[unit.triageDecision] ?? 0) + 1;
    }
    if (unit.internalizationState) {
      internalizationStates[unit.internalizationState] =
        (internalizationStates[unit.internalizationState] ?? 0) + 1;
    }
    chairmanAttempts += (await store.listChairmanAttempts(unit.unitId)).length;
  }

  const activeInternalizationUnit = await store.findActiveInternalizationUnit();

  return {
    store: store.kind,
    ledgerPosts: await store.countLedgerPosts(),
    rtOnlyArchived: await store.countRtOnlyArchive(),
    contextUnits: contextUnits.length,
    verifiedUnits: contextUnits.filter((unit) => unit.canonicalStatus === "verified").length,
    pendingUnits: contextUnits.filter((unit) => unit.canonicalStatus === "pending").length,
    triageDecisions,
    internalizationStates,
    triageSentAwaitingDecision: contextUnits.filter(
      (unit) => unit.triageSentAt && !unit.triageDecision,
    ).length,
    triageSentAwaitingDecisionUnitIds: contextUnits
      .filter((unit) => unit.triageSentAt && !unit.triageDecision)
      .map((unit) => unit.unitId),
    activeInternalizationUnitId: activeInternalizationUnit?.unitId ?? null,
    activeInternalizationState: activeInternalizationUnit?.internalizationState ?? null,
    nextUnsentTriageUnitId: (await store.nextTriageUnit())?.unitId ?? null,
    chairmanAttempts,
    paidCalls: 0,
  };
}

function formatOpsStatus(status: Awaited<ReturnType<typeof buildOpsStatus>>): string {
  return [
    "체화구분 봇 상태",
    "X 글을 가져와서, 체화할 글인지 먼저 고르는 곳이에요.",
    "체화 봇은 고른 글을 넘겨받아 따로 공부를 도와줘요.",
    `저장 위치: ${status.store === "memory" ? "내 컴퓨터" : "외부 DB"}`,
    `모은 글: ${status.ledgerPosts}`,
    `리트윗만 있던 글: ${status.rtOnlyArchived}`,
    `전체 글 묶음: ${status.contextUnits}`,
    `고를 수 있는 글: ${status.verifiedUnits}`,
    `확인이 더 필요한 글: ${status.pendingUnits}`,
    `아직 안 고른 글: ${status.triageSentAwaitingDecision}`,
    `안 고른 글 번호: ${status.triageSentAwaitingDecisionUnitIds.join(", ") || "없음"}`,
    `체화 봇에 넘긴 글: ${status.activeInternalizationUnitId ?? "없음"}`,
    `체화 진행: ${formatInternalizationState(status.activeInternalizationState)}`,
    `다음에 고를 글: ${status.nextUnsentTriageUnitId ?? "없음"}`,
    `내가 써본 답: ${status.chairmanAttempts}`,
    `유료 기능 사용: ${status.paidCalls}번`,
  ].join("\n");
}

function formatInternalizationState(state: string | null): string {
  if (state === "in_progress") return "\uD559\uC2B5 \uC911";
  if (state === "hint_requested") return "\uD78C\uD2B8 \uBCF4\uB294 \uC911";
  if (state === "retry_requested") return "\uB2E4\uC2DC \uD574\uBCF4\uB294 \uC911";
  if (state === "mastery_check_requested") return "\uC774\uD574\uD588\uB294\uC9C0 \uD655\uC778 \uC911";
  if (state === "rescheduled") return "\uB098\uC911\uC5D0 \uB2E4\uC2DC \uBCFC \uC608\uC815";
  return "\uC5C6\uC74C";
}

function formatPendingCards(units: Awaited<ReturnType<Phase1Store["listContextUnits"]>>): string {
  if (units.length === 0) {
    return "\uB300\uAE30 \uCE74\uB4DC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.";
  }

  return [
    "\uB300\uAE30 \uCE74\uB4DC",
    "\uC544\uC9C1 \uD559\uC2B5 \uCE74\uB4DC\uB85C \uBCF4\uB0B4\uAE30 \uC804\uC5D0 \uD655\uC778\uC774 \uD544\uC694\uD55C \uCE74\uB4DC\uC785\uB2C8\uB2E4.",
    "\uD14C\uC2A4\uD2B8 \uBC84\uC804\uC774\uB77C \uC790\uB3D9 \uD655\uC778\uC740 \uAEBC\uC838 \uC788\uC2B5\uB2C8\uB2E4.",
    "",
    ...units.map((unit, index) =>
      [
        `${index + 1}. ${unit.unitId} / ${unit.expertHandle}`,
        `\uC6D0\uBB38: ${unit.originalText}`,
      ].join("\n"),
    ),
  ].join("\n");
}

function withBackToMenuButton(text: string): TelegramMessagePayload {
  return {
    text,
    replyMarkup: {
      inline_keyboard: [
        [{ text: "\uBA54\uB274\uB85C \uB3CC\uC544\uAC00\uAE30", callback_data: "ops:menu" }],
      ],
    },
  };
}

async function handleOpsCallback(input: {
  store: Phase1Store;
  client: TelegramBotClient;
  callbackQueryId: string;
  chatId: string;
  data: string;
}) {
  if (input.data === "ops:menu") {
    await input.client.sendMessage(input.chatId, buildTelegramOpsMenuMessage());
    await input.client.answerCallbackQuery(input.callbackQueryId, "\uBA54\uB274\uB97C \uB2E4\uC2DC \uBCF4\uB0C8\uC2B5\uB2C8\uB2E4");
    return { handled: true as const, action: "menu" as const, menuSent: true };
  }

  if (input.data === "ops:status") {
    await input.client.sendMessage(
      input.chatId,
      withBackToMenuButton(formatOpsStatus(await buildOpsStatus(input.store))),
    );
    await input.client.answerCallbackQuery(input.callbackQueryId, "\uC0C1\uD0DC\uB97C \uBCF4\uB0C8\uC2B5\uB2C8\uB2E4");
    return { handled: true as const, action: "status" as const, statusSent: true };
  }

  if (input.data === "ops:send_next_triage") {
    const unit = await input.store.nextTriageUnit();
    if (!unit) {
      await input.client.sendMessage(
        input.chatId,
        withBackToMenuButton("\uC9C0\uAE08 \uBCF4\uB0BC \uCE74\uB4DC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4."),
      );
      await input.client.answerCallbackQuery(input.callbackQueryId, "\uBCF4\uB0BC \uCE74\uB4DC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4");
      return {
        handled: true as const,
        action: "send_next_triage" as const,
        sent: false,
        reason: "no_triage_unit" as const,
        requiresPaidModel: false,
      };
    }

    const sent = await input.client.sendMessage(
      input.chatId,
      buildTelegramTriageMessage({
        unitId: unit.unitId,
        expertHandle: unit.expertHandle,
        originalText: unit.originalText,
        canonicalStatus: unit.canonicalStatus,
      }),
    );
    await input.store.markTriageSent(unit.unitId, new Date().toISOString(), sent.message_id);
    await input.client.answerCallbackQuery(input.callbackQueryId, "\uCE74\uB4DC\uB97C \uBCF4\uB0C8\uC2B5\uB2C8\uB2E4");
    return {
      handled: true as const,
      action: "send_next_triage" as const,
      sent: true,
      unitId: unit.unitId,
      messageId: sent.message_id,
      requiresPaidModel: false,
    };
  }

  if (input.data === "ops:resume_learning") {
    const unit = await input.store.findActiveInternalizationUnit();
    if (!unit) {
      await input.client.sendMessage(
        input.chatId,
        withBackToMenuButton("\uC9C0\uAE08 \uC774\uC5B4\uAC08 \uD559\uC2B5 \uCE74\uB4DC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4."),
      );
      await input.client.answerCallbackQuery(input.callbackQueryId, "\uC774\uC5B4\uAC08 \uCE74\uB4DC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4");
      return {
        handled: true as const,
        action: "resume_learning" as const,
        sent: false,
        reason: "no_active_learning" as const,
        requiresPaidModel: false,
      };
    }

    const sent = await input.client.sendMessage(
      input.chatId,
      buildTelegramInternalizationMessage({
        unitId: unit.unitId,
        expertHandle: unit.expertHandle,
        originalText: unit.originalText,
      }),
    );
    await input.client.answerCallbackQuery(input.callbackQueryId, "\uD559\uC2B5 \uCE74\uB4DC\uB97C \uB2E4\uC2DC \uBCF4\uB0C8\uC2B5\uB2C8\uB2E4");
    return {
      handled: true as const,
      action: "resume_learning" as const,
      sent: true,
      unitId: unit.unitId,
      messageId: sent.message_id,
      requiresPaidModel: false,
    };
  }

  if (input.data === "ops:pending_cards") {
    const units = (await input.store.listContextUnits()).filter(
      (unit) => unit.canonicalStatus === "pending" && !unit.rtOnlyExcluded,
    );

    await input.client.sendMessage(input.chatId, withBackToMenuButton(formatPendingCards(units)));
    await input.client.answerCallbackQuery(
      input.callbackQueryId,
      units.length > 0
        ? "\uB300\uAE30 \uCE74\uB4DC\uB97C \uBCF4\uB0C8\uC2B5\uB2C8\uB2E4"
        : "\uB300\uAE30 \uCE74\uB4DC\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4",
    );
    return {
      handled: true as const,
      action: "pending_cards" as const,
      count: units.length,
      requiresPaidModel: false,
    };
  }

  if (input.data === "ops:help") {
    await input.client.sendMessage(
      input.chatId,
      withBackToMenuButton([
        "버튼 설명",
        "구분할 글 받기: 체화할지 고를 글을 하나 받아요.",
        "보류 글 보기: 아직 고르기 애매해서 미뤄둔 글을 봐요.",
        "구분봇 상태: 몇 개를 모았고, 몇 개를 골랐는지 봐요.",
        "체화할래요를 누르면 체화 봇으로 넘어가요.",
        "체화구분 봇에서는 유료 AI를 쓰지 않아요.",
      ].join("\n")),
    );
    await input.client.answerCallbackQuery(input.callbackQueryId, "버튼 설명을 보냈어요");
    return { handled: true as const, action: "help" as const, helpSent: true };
  }

  return { handled: false as const };
}

async function handleTelegramTextCommand(input: {
  store: Phase1Store;
  client: TelegramBotClient;
  chatId: string;
  text: string;
}) {
  const command = input.text.trim().split(/\s+/)[0]?.toLowerCase();
  if (!command?.startsWith("/")) {
    return { handled: false as const, reason: "not_command" as const };
  }

  if (command === "/status") {
    await input.client.sendMessage(input.chatId, {
      text: formatOpsStatus(await buildOpsStatus(input.store)),
    });
    return {
      handled: true as const,
      command: "status" as const,
      statusSent: true,
      requiresPaidModel: false,
    };
  }

  await input.client.sendMessage(input.chatId, {
    text: "\uBA85\uB839\uC5B4\uB97C \uC9C1\uC811 \uCE58\uC9C0 \uC54A\uC544\uB3C4 \uB3FC\uC694. \uBA54\uB274 \uBC84\uD2BC\uC744 \uB20C\uB7EC\uC8FC\uC138\uC694.",
  });
  return {
    handled: true as const,
    command: "unknown" as const,
    supportedCommandsSent: true,
    requiresPaidModel: false,
  };
}

async function pollTelegramOnce(input: {
  store: Phase1Store;
  client: TelegramBotClient;
  offsetPath: string;
  internalizationChatId?: string;
  internalizationClient?: TelegramBotClient;
}): Promise<TelegramPollSummary> {
  const updates = await input.client.getUpdates(loadTelegramOffset(input.offsetPath));
  const results = [];
  let callbacksHandled = 0;
  let textCommandsHandled = 0;
  let textAttemptsHandled = 0;

  for (const update of updates) {
    if (update.callbackQueryId && update.callbackData && update.chatId) {
      const opsResult = await handleOpsCallback({
        store: input.store,
        client: input.client,
        callbackQueryId: update.callbackQueryId,
        chatId: update.chatId,
        data: update.callbackData,
      });
      if (opsResult.handled) {
        results.push(opsResult);
        callbacksHandled += 1;
        continue;
      }

      const result = await handleTelegramCallback({
        store: input.store,
        client: input.client,
        callbackQueryId: update.callbackQueryId,
        chatId: update.chatId,
        data: update.callbackData,
        internalizationChatId: input.internalizationChatId,
        internalizationClient: input.internalizationClient,
      });
      results.push(result);
      if (result.handled) callbacksHandled += 1;
      continue;
    }

    if (update.text && update.chatId) {
      const commandResult = await handleTelegramTextCommand({
        store: input.store,
        client: input.client,
        chatId: update.chatId,
        text: update.text,
      });
      if (commandResult.handled) {
        results.push(commandResult);
        textCommandsHandled += 1;
        continue;
      }

      const result = await handleTelegramTextAttempt({
        store: input.store,
        client: input.client,
        chatId: update.chatId,
        text: update.text,
      });
      results.push(result);
      if (result.handled) textAttemptsHandled += 1;
    }
  }

  const maxUpdateId = updates.reduce(
    (max, update) => Math.max(max, update.updateId),
    -1,
  );
  if (maxUpdateId >= 0) {
    saveTelegramOffset(input.offsetPath, maxUpdateId + 1);
  }

  return {
    updatesSeen: updates.length,
    callbacksHandled,
    textCommandsHandled,
    textAttemptsHandled,
    nextOffset: maxUpdateId >= 0 ? maxUpdateId + 1 : loadTelegramOffset(input.offsetPath),
    results,
  };
}

export async function runPhase1Command(
  args: string[],
  env: Record<string, string | undefined> = process.env,
): Promise<CommandResult> {
  const command = args[0];
  const config = loadPhase1Config(env);

  if (command === "config:check") {
    return {
      ok: true,
      data: {
        eliteHandles: config.eliteHandles,
        allowPaidProviders: config.allowPaidProviders,
        mode: config.allowPaidProviders ? "paid_enabled" : "local_or_free_tier",
      },
    };
  }

  if (command === "ingest:historical" || command === "ingest:daily") {
    const source = flagValue(args, "--source") ?? "fixtures";
    if (source !== "fixtures" && source !== "manual" && source !== "xapi") {
      throw new Error(`Only fixtures, manual, and xapi sources are enabled without provider credentials: ${source}`);
    }

    if (hasFlag(args, "--persist")) {
      const store = getStore(env);
      if (source === "xapi") {
        const filePath = flagValue(args, "--file") ?? flagValue(args, "--context-units");
        const contextTreesPath = flagValue(args, "--context-trees");
        const enrichedPostsPath = flagValue(args, "--raw-posts-enriched") ?? flagValue(args, "--enriched-posts");
        if (!filePath) {
          throw new Error("X API import requires --file or --context-units");
        }
        const persisted = await withFileStoreBatch(
          store,
          () => ingestXApiContextUnitsIntoStore(store, filePath, { contextTreesPath, enrichedPostsPath }),
        );
        return {
          ok: true,
          data: {
            store: store.kind,
            ...persisted,
          },
        };
      }

      if (source === "manual") {
        const filePath = flagValue(args, "--file");
        if (!filePath) {
          throw new Error("Manual import requires --file");
        }
        const persisted = await ingestPostsIntoStore(
          store,
          parseManualImportFile(filePath),
          "manual",
        );
        return {
          ok: true,
          data: {
            source,
            store: store.kind,
            ...persisted,
          },
        };
      }

      const persisted = await ingestFixtureIntoStore(store);
      return {
        ok: true,
        data: {
          store: store.kind,
          ...persisted,
        },
      };
    }

    if (source === "xapi") {
      const filePath = flagValue(args, "--file") ?? flagValue(args, "--context-units");
      if (!filePath) {
        throw new Error("X API import requires --file or --context-units");
      }
      const units = parseXApiContextUnitFile(filePath);
      const posts = units.flatMap((unit) => unit.posts ?? []);
      return {
        ok: true,
        data: {
          source,
          dryRun: hasFlag(args, "--dry-run"),
          postsFetched: posts.length,
          rtOnlyArchived: posts.filter((post) => post.retweeted_tweet && !post.text?.trim()).length,
          pendingCandidates: 0,
          canonicalCandidates: units.length,
          paidCalls: 0,
        },
      };
    }

    const fixture = loadFixture();
    const rtOnlyArchived = fixture.posts.filter((post) => post.is_rt_only).length;
    const pendingCandidates = fixture.posts.filter(
      (post) => !post.is_rt_only && post.trust_layer !== "canonical",
    ).length;
    const canonicalCandidates = fixture.posts.filter(
      (post) => !post.is_rt_only && post.trust_layer === "canonical",
    ).length;

    return {
      ok: true,
      data: {
        source,
        dryRun: hasFlag(args, "--dry-run"),
        postsFetched: fixture.posts.length,
        rtOnlyArchived,
        pendingCandidates,
        canonicalCandidates,
        paidCalls: 0,
      },
    };
  }

  if (command === "jit:enqueue") {
    const limit = Number(flagValue(args, "--limit") ?? "100");
    if (hasFlag(args, "--persist")) {
      const store = getStore(env);
      const queued = await store.enqueueJitUnits(limit);
      return {
        ok: true,
        data: {
          store: store.kind,
          queued: queued.map((item) => item.unitId),
          paidCalls: 0,
        },
      };
    }

    const fixture = loadFixture();
    const batch = enqueueJitBatch(
      fixture.posts
        .filter((post) => !post.is_rt_only)
        .map((post) => ({
          unitId: post.post_id,
          completedAt: post.created_at,
          canonicalStatus: canonicalStatusFor(post),
          rtOnlyExcluded: post.is_rt_only,
        })),
      limit,
    );

    return {
      ok: true,
      data: {
        queued: batch.map((item) => item.unitId),
        paidCalls: 0,
      },
    };
  }

  if (command === "triage:next") {
    if (hasFlag(args, "--persist")) {
      const store = getStore(env);
      const post = await store.nextTriageUnit();

      return {
        ok: true,
        data: post
          ? {
              store: store.kind,
              unitId: post.unitId,
              expertHandle: post.expertHandle,
              originalText: post.originalText,
              structuralBasis: post.structuralBasis,
              canonicalStatus: post.canonicalStatus,
              aiSummary: null,
              aiRecommendation: null,
              buttons: TRIAGE_ACTION_BUTTONS,
            }
          : null,
      };
    }

    const fixture = loadFixture();
    const post = fixture.posts.find((candidate) =>
      canEnterTriage({
        canonicalStatus: canonicalStatusFor(candidate),
        rtOnlyExcluded: candidate.is_rt_only,
      }),
    );

    if (!post) {
      return { ok: true, data: null };
    }

    return {
      ok: true,
      data: {
        unitId: post.post_id,
        expertHandle: post.expert_handle,
        originalText: post.text,
        structuralBasis: post.structural_basis,
        canonicalStatus: "verified",
        aiSummary: null,
        aiRecommendation: null,
        buttons: TRIAGE_ACTION_BUTTONS,
      },
    };
  }

  if (command === "cost:status") {
    const spentKrw = Number(flagValue(args, "--spent-krw") ?? "0");
    return {
      ok: true,
      data: buildCostDecision({
        spentKrw,
        softAlertKrw: config.costSoftAlertKrw,
        hardStopKrw: config.costHardStopKrw,
      }),
    };
  }

  if (command === "ops:status") {
    return {
      ok: true,
      data: await buildOpsStatus(getStore(env)),
    };
  }

  if (command === "telegram:get-me") {
    const client = new TelegramBotClient({ token: requireTelegramToken(env) });
    return {
      ok: true,
      data: await client.getMe(),
    };
  }

  if (command === "telegram:updates") {
    const client = new TelegramBotClient({ token: requireTelegramToken(env) });
    return {
      ok: true,
      data: await client.getUpdates(),
    };
  }

  if (command === "telegram:poll-once") {
    const store = getStore(env);
    const client = new TelegramBotClient({ token: requireTelegramToken(env) });
    const internalizationClient = env.INTERNALIZATION_BOT_TOKEN
      ? new TelegramBotClient({ token: env.INTERNALIZATION_BOT_TOKEN })
      : undefined;
    const offsetPath = env.TELEGRAM_OFFSET_PATH ?? resolve(".phase1/telegram-offset.json");

    return {
      ok: true,
      data: await pollTelegramOnce({
        store,
        client,
        offsetPath,
        internalizationChatId: env.INTERNALIZATION_CHAT_ID,
        internalizationClient,
      }),
    };
  }

  if (command === "telegram:poll-loop") {
    const store = getStore(env);
    const client = new TelegramBotClient({ token: requireTelegramToken(env) });
    const internalizationClient = env.INTERNALIZATION_BOT_TOKEN
      ? new TelegramBotClient({ token: env.INTERNALIZATION_BOT_TOKEN })
      : undefined;
    const offsetPath = env.TELEGRAM_OFFSET_PATH ?? resolve(".phase1/telegram-offset.json");
    const intervalMs = Number(flagValue(args, "--interval-ms") ?? env.TELEGRAM_POLL_INTERVAL_MS ?? "3000");
    const maxIterationsFlag = flagValue(args, "--max-iterations");
    const maxIterations = maxIterationsFlag ? Number(maxIterationsFlag) : Number.POSITIVE_INFINITY;
    const aggregate = {
      mode: "local_polling",
      iterations: 0,
      updatesSeen: 0,
      callbacksHandled: 0,
      textCommandsHandled: 0,
      textAttemptsHandled: 0,
      paidCalls: 0,
    };

    while (aggregate.iterations < maxIterations) {
      const summary = await pollTelegramOnce({
        store,
        client,
        offsetPath,
        internalizationChatId: env.INTERNALIZATION_CHAT_ID,
        internalizationClient,
      });
      aggregate.iterations += 1;
      aggregate.updatesSeen += summary.updatesSeen;
      aggregate.callbacksHandled += summary.callbacksHandled;
      aggregate.textCommandsHandled += summary.textCommandsHandled;
      aggregate.textAttemptsHandled += summary.textAttemptsHandled;

      if (aggregate.iterations < maxIterations) {
        await delay(intervalMs);
      }
    }

    return {
      ok: true,
      data: aggregate,
    };
  }

  if (command === "telegram:send-triage") {
    const chatId = flagValue(args, "--chat-id") ?? env.TRIAGE_CHAT_ID;
    if (!chatId) {
      throw new Error("telegram:send-triage requires --chat-id or TRIAGE_CHAT_ID");
    }

    const store = getStore(env);
    const post = await store.nextTriageUnit();
    if (!post) {
      return { ok: true, data: { sent: false, reason: "no_triage_unit" } };
    }
    if (post.triageSentAt && !hasFlag(args, "--force")) {
      return {
        ok: true,
        data: {
          sent: false,
          reason: "triage_already_sent",
          unitId: post.unitId,
          messageId: post.triageMessageId,
          paidCalls: 0,
        },
      };
    }

    const client = new TelegramBotClient({ token: env.INTERNALIZATION_BOT_TOKEN?.trim() || requireTelegramToken(env) });
    const sent = await client.sendMessage(
      chatId,
      buildTelegramTriageMessage({
        unitId: post.unitId,
        expertHandle: post.expertHandle,
        originalText: post.originalText,
        canonicalStatus: post.canonicalStatus,
      }),
    );
    await store.markTriageSent(post.unitId, new Date().toISOString(), sent.message_id);

    return {
      ok: true,
      data: {
        sent: true,
        messageId: sent.message_id,
        unitId: post.unitId,
      },
    };
  }

  if (command === "telegram:send-menu") {
    const chatId = flagValue(args, "--chat-id") ?? env.TRIAGE_CHAT_ID;
    if (!chatId) {
      throw new Error("telegram:send-menu requires --chat-id or TRIAGE_CHAT_ID");
    }

    const statePath = telegramMenuStatePath(env);
    const previous = readTelegramMenuState(statePath);
    if (
      previous?.chatId === chatId &&
      previous.menuVersion === OPS_MENU_VERSION &&
      !hasFlag(args, "--force")
    ) {
      return {
        ok: true,
        data: {
          sent: false,
          reason: "menu_already_sent",
          messageId: previous.messageId,
          paidCalls: 0,
        },
      };
    }

    const client = new TelegramBotClient({ token: requireTelegramToken(env) });
    const sent = await client.sendMessage(chatId, buildTelegramOpsMenuMessage());
    writeTelegramMenuState(statePath, {
      chatId,
      messageId: sent.message_id,
      menuVersion: OPS_MENU_VERSION,
      sentAt: new Date().toISOString(),
    });

    return {
      ok: true,
      data: {
        sent: true,
        messageId: sent.message_id,
        paidCalls: 0,
      },
    };
  }

  if (command === "telegram:mark-triage-sent") {
    const unitId = flagValue(args, "--unit-id");
    const messageId = Number(flagValue(args, "--message-id"));
    if (!unitId || !Number.isFinite(messageId)) {
      throw new Error("telegram:mark-triage-sent requires --unit-id and --message-id");
    }

    const store = getStore(env);
    const unit = await store.getContextUnit(unitId);
    if (!unit) {
      return { ok: true, data: { marked: false, reason: "unit_not_found", unitId } };
    }

    await store.markTriageSent(unitId, new Date().toISOString(), messageId);
    return {
      ok: true,
      data: {
        marked: true,
        unitId,
        messageId,
        paidCalls: 0,
      },
    };
  }

  if (command === "telegram:send-internalization") {
    const chatId = flagValue(args, "--chat-id") ?? env.INTERNALIZATION_CHAT_ID ?? env.TRIAGE_CHAT_ID;
    if (!chatId) {
      throw new Error("telegram:send-internalization requires --chat-id, INTERNALIZATION_CHAT_ID, or TRIAGE_CHAT_ID");
    }

    const store = getStore(env);
    const unitId = flagValue(args, "--unit-id");
    const unit = unitId ? await store.getContextUnit(unitId) : await store.findActiveInternalizationUnit();
    if (!unit) {
      return { ok: true, data: { sent: false, reason: "no_internalization_unit" } };
    }

    await store.setTriageDecision(unit.unitId, "\uCCB4\uD654");
    await store.setInternalizationState(unit.unitId, "in_progress");

    const client = new TelegramBotClient({ token: requireTelegramToken(env) });
    const sent = await client.sendMessage(
      chatId,
      buildTelegramInternalizationMessage({
        unitId: unit.unitId,
        expertHandle: unit.expertHandle,
        originalText: unit.originalText,
      }),
    );

    return {
      ok: true,
      data: {
        sent: true,
        messageId: sent.message_id,
        unitId: unit.unitId,
        paidCalls: 0,
      },
    };
  }

  throw new Error(`Unknown command: ${command}`);
}
