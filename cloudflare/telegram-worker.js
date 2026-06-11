const TRIAGE_MENU_BUTTONS = [
  [{ text: "시작", callback_data: "ops:auto_triage" }],
];

const BACK_TO_MENU = [[{ text: "시작", callback_data: "ops:auto_triage" }]];
const MAX_PENDING_APPROVAL_CARDS = 1;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function requireAdminRequest(request, env) {
  const expectedToken = env.ADMIN_TOKEN;
  const headerToken = request.headers.get("x-admin-token");
  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  if (expectedToken && (headerToken === expectedToken || bearerToken === expectedToken)) return null;
  return json({ ok: false, error: "Admin token required" }, 401);
}

function tokenFor(env, botRole) {
  return botRole === "internalization"
    ? env.INTERNALIZATION_BOT_TOKEN ?? env.TELEGRAM_BOT_TOKEN
    : env.TELEGRAM_BOT_TOKEN;
}

async function telegramWithToken(token, method, body) {
  if (!token) throw new Error(`Telegram token is required for ${method}`);
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.description || `Telegram ${method} failed`);
  return payload.result;
}

async function telegram(env, botRole, method, body) {
  return telegramWithToken(tokenFor(env, botRole), method, body);
}

async function answerCallback(env, botRole, callbackId, text) {
  try {
    const body = { callback_query_id: callbackId };
    if (text) body.text = text;
    await telegram(env, botRole, "answerCallbackQuery", body);
    return true;
  } catch {
    return false;
  }
}

function queueBackground(ctx, task, onError) {
  if (!ctx?.waitUntil) return false;
  ctx.waitUntil(task().catch(async (error) => {
    console.error("background task failed", error);
    if (onError) await onError(error);
  }));
  return true;
}

async function sendBackgroundFailureNotice(env, botRole, chatId, message) {
  try {
    await telegram(env, botRole, "sendMessage", {
      chat_id: chatId,
      text: message,
      reply_markup: { inline_keyboard: BACK_TO_MENU },
    });
  } catch (error) {
    console.error("failed to send background failure notice", error);
  }
}

function messageChunks(text, maxLength = 3600) {
  if (text.length <= maxLength) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    let cut = remaining.lastIndexOf("\n\n", maxLength);
    if (cut < maxLength * 0.5) cut = remaining.lastIndexOf("\n", maxLength);
    if (cut < maxLength * 0.5) cut = maxLength;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

async function clearClickedMessage(env, botRole, callback) {
  const chatId = String(callback.message.chat.id);
  const messageId = callback.message.message_id;
  try {
    await telegram(env, botRole, "deleteMessage", { chat_id: chatId, message_id: messageId });
  } catch {
    try {
      await telegram(env, botRole, "editMessageReplyMarkup", {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] },
      });
    } catch {}
  }
}

async function cleanupTrackedMessages(env, botRole, chatId) {
  try {
    const row = await env.PHASE1_DB.prepare(
      "SELECT message_ids FROM bot_message_cleanup WHERE bot_role = ? AND chat_id = ?",
    ).bind(botRole, String(chatId)).first();
    const messageIds = row?.message_ids ? JSON.parse(row.message_ids) : [];
    for (const messageId of messageIds) {
      try {
        await telegram(env, botRole, "deleteMessage", { chat_id: String(chatId), message_id: messageId });
      } catch {}
    }
    await env.PHASE1_DB.prepare(
      "DELETE FROM bot_message_cleanup WHERE bot_role = ? AND chat_id = ?",
    ).bind(botRole, String(chatId)).run();
  } catch {}
}

async function rememberTrackedMessages(env, botRole, chatId, messageIds) {
  if (!messageIds.length) return;
  try {
    await env.PHASE1_DB.prepare(
      [
        "INSERT OR REPLACE INTO bot_message_cleanup",
        "(bot_role, chat_id, message_ids, updated_at)",
        "VALUES (?, ?, ?, ?)",
      ].join(" "),
    ).bind(botRole, String(chatId), JSON.stringify(messageIds), new Date().toISOString()).run();
  } catch {}
}

async function rememberTrackedMessage(env, botRole, chatId, messageId) {
  await rememberTrackedMessages(env, botRole, chatId, [messageId]);
}

async function sendTrackedMessage(env, botRole, body, options = {}) {
  const chatId = String(body.chat_id);
  if (options.cleanupBefore) await cleanupTrackedMessages(env, botRole, chatId);
  const sent = await telegram(env, botRole, "sendMessage", body);
  if (options.remember) await rememberTrackedMessage(env, botRole, chatId, sent.message_id);
  return sent;
}

async function sendLongMessage(env, botRole, chatId, text, replyMarkup, options = {}) {
  if (options.cleanupBefore) await cleanupTrackedMessages(env, botRole, chatId);
  const chunks = messageChunks(text);
  let sent = null;
  const sentIds = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const suffix = chunks.length > 1 ? `\n\n(${index + 1}/${chunks.length})` : "";
    sent = await telegram(env, botRole, "sendMessage", {
      chat_id: chatId,
      text: `${chunks[index]}${suffix}`,
      ...(index === chunks.length - 1 && replyMarkup ? { reply_markup: replyMarkup } : {}),
    });
    sentIds.push(sent.message_id);
  }
  if (options.remember) await rememberTrackedMessages(env, botRole, chatId, sentIds);
  return sent;
}

function triageMenuMessage() {
  return {
    text: "체화구분을 시작합니다.",
    reply_markup: { inline_keyboard: TRIAGE_MENU_BUTTONS },
  };
}

function triageStartMessage() {
  return {
    text: "체화구분",
    reply_markup: { inline_keyboard: [[{ text: "시작", callback_data: "ops:auto_triage" }]] },
  };
}

function internalizationStartMessage() {
  return {
    text: [
      "체화 봇입니다.",
      "체화구분 봇에서 고른 맥락은 여기에 저장돼요.",
      "체화 시작을 누르면 그때 첫 맥락을 보여드릴게요.",
    ].join("\n"),
    reply_markup: { inline_keyboard: [[{ text: "체화 시작", callback_data: "i:active:s" }]] },
  };
}

function internalizationMainKeyboard(unitId) {
  if (!unitId) {
    return [[{ text: "체화 시작", callback_data: "i:active:s" }]];
  }
  return [
    [{ text: "원문 다시 보기", callback_data: `i:${unitId}:r` }],
    [{ text: "AI 힌트 받기", callback_data: `i:${unitId}:h` }],
    [{ text: "질문으로 점검", callback_data: `i:${unitId}:m` }],
    [{ text: "이 맥락 끝", callback_data: `i:${unitId}:c` }],
  ];
}

function internalizationHomeMessage() {
  return {
    text: [
      "여기는 체화 봇이에요.",
      "체화구분 봇에서 고른 맥락을 저장해두는 곳이에요.",
      "체화 시작을 누르면 저장된 맥락을 하나씩 보여드려요.",
    ].join("\n"),
    reply_markup: { inline_keyboard: internalizationMainKeyboard() },
  };
}

async function statusText(env) {
  const counts = await env.PHASE1_DB.prepare(
    [
      "SELECT",
      "(SELECT COUNT(*) FROM ledger_posts) AS ledger_posts,",
      "(SELECT COUNT(*) FROM rt_only_archive) AS rt_only_archived,",
      "(SELECT COUNT(*) FROM context_units) AS context_units,",
      "(SELECT COUNT(*) FROM context_units WHERE canonical_status = 'verified' AND rt_only_excluded = 0 AND triage_decision IS NULL) AS ready_units,",
      "(SELECT COUNT(*) FROM ai_cost_ledger) AS ai_calls",
    ].join(" "),
  ).first();

  return [
    "체화구분 봇 상태",
    "X 글을 가져와서, 체화할 글인지 먼저 고르는 곳이에요.",
    `모은 글: ${counts?.ledger_posts ?? 0}개`,
    `리트윗만 있던 글: ${counts?.rt_only_archived ?? 0}개`,
    `전체 글 묶음: ${counts?.context_units ?? 0}개`,
    `고를 수 있는 글: ${counts?.ready_units ?? 0}개`,
    `유료 기능 사용: ${counts?.ai_calls ?? 0}번`,
  ].join("\n");
}

async function nextTriageUnit(env) {
  return env.PHASE1_DB.prepare(
    [
      "SELECT unit_id, expert_handle, original_text, canonical_status",
      "FROM context_units",
      "WHERE rt_only_excluded = 0",
      "AND canonical_status = 'verified'",
      "AND triage_decision IS NULL",
      "ORDER BY completed_at ASC, unit_id ASC",
      "LIMIT 1",
    ].join(" "),
  ).first();
}

async function nextAutoTriageUnits(env, limit) {
  return env.PHASE1_DB.prepare(
    [
      "SELECT unit_id, expert_handle, original_text, completed_at, canonical_status",
      "FROM context_units",
      "WHERE rt_only_excluded = 0",
      "AND canonical_status = 'verified'",
      "AND triage_decision IS NULL",
      "ORDER BY completed_at ASC, unit_id ASC",
      "LIMIT ?",
    ].join(" "),
  ).bind(limit).all();
}

async function hasPendingApproval(env) {
  const row = await env.PHASE1_DB.prepare(
    "SELECT COUNT(*) AS count FROM context_units WHERE triage_decision = 'pendingApproval'",
  ).first();
  return Number(row?.count ?? 0) > 0;
}

async function oldestPendingApproval(env) {
  return env.PHASE1_DB.prepare(
    [
      "SELECT unit_id, expert_handle, original_text, completed_at,",
      "triage_grade, triage_score, triage_rationale_json, canonical_status, rt_only_excluded",
      "FROM context_units",
      "WHERE triage_decision = 'pendingApproval'",
      "ORDER BY completed_at ASC, unit_id ASC",
      "LIMIT 1",
    ].join(" "),
  ).first();
}

async function sendOldestPendingApproval(env, chatId) {
  const unit = await oldestPendingApproval(env);
  if (!unit) return false;
  const rationale = triageRationale(unit);
  await sendTriageReviewCard(env, chatId, unit, {
    grade: unit.triage_grade ?? rationale.grade ?? "B",
    totalScore: unit.triage_score ?? rationale.total_score ?? 0,
    scores: rationale.scores,
    reason: rationale.reason,
    extractedPrinciple: rationale.extracted_principle,
    noiseReason: rationale.noise_reason,
    modelGrade: rationale.model_grade,
    fallbackFrom: rationale.fallback_from,
    fallbackReason: rationale.fallback_reason,
  });
  return true;
}

async function getContextUnit(env, unitId) {
  if (unitId === "active") {
    return env.PHASE1_DB.prepare(
      [
        "SELECT saved.unit_id, saved.expert_handle, saved.original_text, saved.completed_at,",
        "unit.canonical_status, unit.rt_only_excluded, unit.triage_decision, unit.triage_grade, unit.triage_score, unit.triage_rationale_json, unit.internalization_state",
        "FROM internalized_context_units saved",
        "JOIN context_units unit ON unit.unit_id = saved.unit_id",
        "WHERE unit.triage_decision = '체화'",
        "AND unit.canonical_status = 'verified'",
        "AND unit.rt_only_excluded = 0",
        "AND COALESCE(unit.internalization_state, '') != 'completed'",
        "ORDER BY saved.selected_at ASC LIMIT 1",
      ].join(" "),
    ).first();
  }

  return env.PHASE1_DB.prepare(
    [
      "SELECT unit_id, expert_handle, original_text, completed_at, canonical_status,",
      "rt_only_excluded, triage_decision, triage_grade, triage_score, triage_rationale_json, internalization_state",
      "FROM context_units WHERE unit_id = ? LIMIT 1",
    ].join(" "),
  ).bind(unitId).first();
}

async function setInternalizationState(env, unitId, state) {
  await env.PHASE1_DB.prepare(
    "UPDATE context_units SET internalization_state = ? WHERE unit_id = ?",
  ).bind(state, unitId).run();
}

function displayDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.toISOString().slice(0, 16).replace("T", " ")} KST`;
}

function internalizationQueueKey(unit, grade) {
  const priority = grade === "B" ? "1" : "0";
  return `${priority}:${unit.completed_at}:${unit.unit_id}`;
}

async function saveInternalizedContextUnit(env, unit, grade = "A") {
  await env.PHASE1_DB.prepare(
    [
      "INSERT OR REPLACE INTO internalized_context_units",
      "(unit_id, expert_handle, original_text, completed_at, selected_at, source)",
      "VALUES (?, ?, ?, ?, ?, 'triage_bot')",
    ].join(" "),
  ).bind(
    unit.unit_id,
    unit.expert_handle,
    unit.original_text,
    unit.completed_at,
    internalizationQueueKey(unit, grade),
  ).run();
}

async function applyTriageDecision(env, unit, action, triageScore = null) {
  const decision = action === "internalize"
    ? "체화"
    : action === "pendingApproval"
      ? "pendingApproval"
      : "체화_안해도_됨";
  const grade = triageScore?.grade ?? null;
  const score = Number.isFinite(Number(triageScore?.totalScore)) ? Number(triageScore.totalScore) : null;
  const rationale = triageScore
    ? JSON.stringify({
      scores: triageScore.scores,
      grade: triageScore.grade,
      total_score: triageScore.totalScore,
      reason: triageScore.reason,
      extracted_principle: triageScore.extractedPrinciple,
      noise_reason: triageScore.noiseReason,
      model_grade: triageScore.modelGrade,
      fallback_from: triageScore.fallbackFrom,
      fallback_reason: triageScore.fallbackReason,
    })
    : null;
  await env.PHASE1_DB.prepare(
    [
      "UPDATE context_units SET",
      "triage_decision = ?,",
      "triage_grade = COALESCE(?, triage_grade),",
      "triage_score = COALESCE(?, triage_score),",
      "triage_rationale_json = COALESCE(?, triage_rationale_json)",
      "WHERE unit_id = ?",
    ].join(" "),
  ).bind(decision, grade, score, rationale, unit.unit_id).run();
  if (action === "internalize") {
    await saveInternalizedContextUnit(env, unit, grade ?? "A");
  }
  return decision;
}

function triageRationale(unit) {
  try {
    return unit.triage_rationale_json ? JSON.parse(unit.triage_rationale_json) : {};
  } catch {
    return {};
  }
}

async function sendTriageReviewCard(env, chatId, unit, judged) {
  const text = [
    `등급: ${judged.grade} / 점수: ${judged.totalScore}`,
    `쓴 사람: ${unit.expert_handle}`,
    displayDate(unit.completed_at) ?? "",
    "",
    "읽어볼 맥락",
    unit.original_text,
  ].join("\n");
  return sendLongMessage(env, "triage", chatId, text, {
    inline_keyboard: [
      [{ text: "체화봇으로 보내기", callback_data: `triage:approve:${unit.unit_id}` }],
      [{ text: "이번 건 넘기기", callback_data: `triage:reject:${unit.unit_id}` }],
    ],
  });
}

function triageMessage(unit) {
  return {
    text: [
      `글 #${unit.unit_id}`,
      `쓴 사람: ${unit.expert_handle}`,
      displayDate(unit.completed_at) ?? "",
      "이 맥락은 AI 자동 구분 대상입니다.",
      "",
      "읽어볼 글",
      unit.original_text,
    ].join("\n"),
    reply_markup: { inline_keyboard: TRIAGE_MENU_BUTTONS },
  };
}

function internalizationMessage(unit) {
  return {
    text: [
      "체화할 맥락입니다.",
      "먼저 글부터 보고, 내 말로 생각해보세요.",
      `쓴 사람: ${unit.expert_handle}`,
      displayDate(unit.completed_at) ?? "",
      `읽어볼 글: ${unit.original_text}`,
      "준비되면 이 맥락 체화 시작을 눌러 이어가세요.",
    ].join("\n"),
    reply_markup: { inline_keyboard: internalizationMainKeyboard(unit.unit_id) },
  };
}

async function sendTriageUnit(env, chatId, unit) {
  const payload = triageMessage(unit);
  const sent = await sendLongMessage(env, "triage", chatId, payload.text, payload.reply_markup, { cleanupBefore: true, remember: true });
  await env.PHASE1_DB.prepare(
    "UPDATE context_units SET triage_sent_at = ?, triage_message_id = ? WHERE unit_id = ?",
  ).bind(new Date().toISOString(), sent.message_id, unit.unit_id).run();
  return sent;
}

function parseScopedCallback(data, scope, allowedActions) {
  const [actualScope, unitId, action] = data.split(":");
  if (actualScope !== scope || !unitId || !allowedActions.includes(action)) return null;
  return { unitId, action };
}

function parseTriageCallback(data) {
  const [scope, second, third] = data.split(":");
  if (scope !== "triage" || !second || !third) return null;
  if (second === "approve" || second === "reject") {
    return { unitId: third, action: second };
  }
  return parseScopedCallback(data, "triage", ["internalize", "skip", "ai_judge", "approve", "reject"]);
}

function parseInternalizationCallback(data) {
  const shortActions = {
    s: "start",
    r: "resume",
    h: "hint",
    t: "retry",
    m: "mastery_check",
    c: "complete",
    f: "finish_day",
  };
  const [scope, unitId, action] = data.split(":");
  if (scope === "i" && unitId && shortActions[action]) {
    return { unitId, action: shortActions[action] };
  }
  return parseScopedCallback(data, "internalization", ["start", "resume", "hint", "retry", "mastery_check", "complete", "finish_day"]);
}

function internalizationControlText(action, originalText) {
  if (action === "start") {
    return ["체화 봇을 시작합니다.", "아래 체화하기 버튼으로 현재 글을 이어가세요."].join("\n");
  }
  if (action === "finish_day") {
    return ["오늘 체화 끝", "오늘은 여기까지 할게요. 다음에 이어서 보면 됩니다."].join("\n");
  }
  if (action === "resume") {
    return [
      "체화하기",
      "AI 해석 없이 원문 맥락부터 봅니다.",
      "아래 맥락을 보고, 먼저 내 말로 정리해보세요.",
      "",
      "정리할 때 볼 질문",
      "1. 이 사람이 무엇에 반응했나요?",
      "2. 어떤 순서로 생각이 이어졌나요?",
      "3. 내가 따라 배울 판단 기준은 무엇인가요?",
      "",
      `원문 맥락:\n${originalText}`,
    ].join("\n");
  }
  if (action === "hint") {
    return [
      "체화 힌트",
      "1. 상황",
      "- 이 글이 어떤 문제를 다루는지 먼저 한 문장으로 잡아보세요.",
      "2. 생각 순서",
      "- 무엇을 먼저 봤는지",
      "- 무엇과 연결했는지",
      "- 어디서 조심했는지 순서대로 표시해보세요.",
      "3. 판단 기준",
      "- 다음에도 다시 쓸 수 있는 기준을 2개만 뽑아보세요.",
      "4. 반대로 틀릴 수 있는 경우",
      "- 이 생각이 안 맞는 조건을 하나 적어보세요.",
      "5. 내가 바로 써먹을 질문",
      "- 이 상황을 다시 보면 무엇부터 확인할까?",
      "- 어떤 신호가 나오면 생각을 바꿀까?",
      "- 이 글에서 버릴 말과 남길 기준은 무엇일까?",
      "",
      `원문:\n${originalText}`,
    ].join("\n");
  }
  if (action === "mastery_check") {
    return [
      "이해 확인",
      "1. 이 글을 내 말로 짧게 말할 수 있나요?",
      "2. 왜 그렇게 보는지 말할 수 있나요?",
      "3. 언제 틀릴 수 있는지도 떠올렸나요?",
      "4. 다음 비슷한 상황을 보면 알아볼 수 있나요?",
    ].join("\n");
  }
  if (action === "complete") {
    return ["좋아요. 완료!", "이 글은 다 본 것으로 표시했어요."].join("\n");
  }
  return ["오늘 체화 끝", "오늘은 여기까지 할게요. 다음에 이어서 보면 됩니다."].join("\n");
}

function numberEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil([...text].length / 2));
}

function estimateKrw(provider, inputTokens, outputTokens, env) {
  const krwPerUsd = numberEnv(env.KRW_PER_USD, 1500);
  const model = provider === "anthropic" ? env.AI_MODEL_JUDGE : env.AI_MODEL_PRIMARY;
  const isHaiku45 = provider === "anthropic" && String(model ?? "").includes("haiku-4-5");
  const inputUsd = provider === "anthropic" ? (isHaiku45 ? 1 : 3) : 0.14;
  const outputUsd = provider === "anthropic" ? (isHaiku45 ? 5 : 15) : 0.28;
  return Math.ceil(((inputTokens / 1_000_000) * inputUsd + (outputTokens / 1_000_000) * outputUsd) * krwPerUsd);
}

async function currentAiSpend(env) {
  const row = await env.PHASE1_DB.prepare(
    [
      "SELECT",
      "COALESCE(SUM(CASE WHEN datetime(created_at) >= datetime('now', '-1 day') THEN estimated_krw ELSE 0 END), 0) AS daily_krw,",
      "COALESCE(SUM(CASE WHEN datetime(created_at) >= datetime('now', '-30 day') THEN estimated_krw ELSE 0 END), 0) AS monthly_krw",
      "FROM ai_cost_ledger",
    ].join(" "),
  ).first();
  return {
    dailyKrw: Number(row?.daily_krw ?? 0),
    monthlyKrw: Number(row?.monthly_krw ?? 0),
  };
}

async function canSpend(env, estimatedKrw) {
  const dailyLimit = numberEnv(env.AI_DAILY_LIMIT_KRW, 3000);
  const monthlyLimit = numberEnv(env.AI_MONTHLY_LIMIT_KRW, 30000);
  const spend = await currentAiSpend(env);
  return {
    ok: spend.dailyKrw + estimatedKrw <= dailyLimit && spend.monthlyKrw + estimatedKrw <= monthlyLimit,
    dailyLimit,
    monthlyLimit,
    ...spend,
  };
}

async function recordAiCost(env, input) {
  await env.PHASE1_DB.prepare(
    [
      "INSERT INTO ai_cost_ledger",
      "(provider, model, reason, input_tokens, output_tokens, estimated_krw)",
      "VALUES (?, ?, ?, ?, ?, ?)",
    ].join(" "),
  ).bind(input.provider, input.model, input.reason, input.inputTokens, input.outputTokens, input.estimatedKrw).run();
}

function aiSystemPrompt() {
  return [
    "너는 투자 글을 체화하도록 돕는 한국어 코치다.",
    "12살도 이해할 수 있게 쉽고 친숙하게 말한다.",
    "종목 추천, 매수/매도 지시, 수익 보장 표현은 하지 않는다.",
    "원문 밖의 사실을 지어내지 않는다.",
  ].join("\n");
}

function aiUserPrompt(action, originalText) {
  if (action === "hint") {
    return [
      "아래 글을 보고 체화용 힌트를 만들어줘.",
      "목표는 요약이 아니라, 다음 투자 판단에 다시 써먹을 생각법을 뽑는 것이다.",
      "요약으로 끝내지 말고, 글쓴이가 어떤 상황에서 어떤 순서로 판단했는지 보여줘.",
      "종목 추천, 매수/매도 지시, 수익 보장 표현은 하지 마.",
      "원문에 없는 사실은 만들지 마.",
      "",
      "형식은 반드시 아래처럼 써.",
      "체화 힌트",
      "1. 상황",
      "- 글쓴이가 보고 있던 문제나 장면을 1~2문장으로.",
      "2. 생각 순서",
      "- 먼저 본 것",
      "- 그다음 연결한 것",
      "- 마지막에 조심한 것",
      "3. 판단 기준",
      "- 다음에 비슷한 상황에서 쓸 수 있는 기준 2~3개.",
      "4. 반대로 틀릴 수 있는 경우",
      "- 이 생각이 안 맞을 수 있는 조건 1~2개.",
      "5. 내가 바로 써먹을 질문",
      "- 지금 내가 스스로 물어볼 질문 3개.",
      "",
      "원문:",
      originalText,
    ].join("\n");
  }
  if (action === "mastery_check") {
    return [
      "아래 글을 바탕으로 생각 점검 질문을 만들어줘.",
      "목표는 한 가지 정답을 맞히는 시험이 아니다.",
      "내가 여러 방향으로 생각해보고, 글쓴이의 판단을 내 판단으로 바꿔보게 만드는 것이다.",
      "답을 바로 주지 말고 질문만 줘.",
      "종목 추천, 매수/매도 지시, 수익 보장 표현은 하지 마.",
      "원문에 없는 사실은 만들지 마.",
      "",
      "형식은 반드시 아래처럼 써.",
      "생각 점검",
      "1. 먼저 내 말로 보기",
      "- 이 사람이 보고 있던 상황을 네 말로 말하면?",
      "- 여기서 제일 중요한 판단 기준은 뭐라고 보이나?",
      "2. 찬성해서 보기",
      "- 이 관점이 맞다면 어떤 신호가 같이 보여야 하나?",
      "- 이 생각을 다음 투자 판단에 쓰려면 무엇을 먼저 확인해야 하나?",
      "3. 반대로 보기",
      "- 이 관점이 틀릴 수 있는 경우는?",
      "- 글쓴이가 놓쳤을 수 있는 위험은?",
      "4. 조건을 바꿔보기",
      "- 시장 분위기, 시간, 가격 위치가 달라지면 판단이 어떻게 바뀌나?",
      "- 어떤 조건이 바뀌면 이 생각을 버려야 하나?",
      "5. 내 판단에 적용하기",
      "- 지금 내가 보는 종목이나 상황에 대입하면 무엇을 확인할까?",
      "- 내가 바로 행동하지 않고 기다려야 할 이유는?",
      "",
      "원문:",
      originalText,
    ].join("\n");
  }
  return ["아래 글을 내 말로 이해할 수 있게 첫 질문을 만들어줘.", "", originalText].join("\n");
}

function aiAnswerFeedbackPrompt(originalText, userAnswer) {
  return [
    "아래 원문 맥락과 사용자 답변을 보고 짧게 대꾸해줘.",
    "정답 채점처럼 말하지 말고, 사용자가 더 생각을 이어가게 해.",
    "투자 조언, 종목 추천, 매수/매도 지시, 수익 보장 표현은 하지 마.",
    "원문에 없는 사실을 새로 만들지 마.",
    "",
    "형식은 반드시 아래처럼 써.",
    "답변 피드백",
    "1. 좋은 점",
    "- 사용자가 잘 잡은 생각 1~2개.",
    "2. 더 생각해볼 점",
    "- 놓치기 쉬운 반대 조건이나 확인할 점 1~2개.",
    "3. 다시 물어볼 질문",
    "- 사용자가 바로 이어서 답할 수 있는 질문 2개.",
    "",
    "원문 맥락:",
    originalText,
    "",
    "사용자 답변:",
    userAnswer,
  ].join("\n");
}

async function callDeepSeek(env, action, originalText) {
  const messages = [
    { role: "system", content: aiSystemPrompt() },
    { role: "user", content: aiUserPrompt(action, originalText) },
  ];
  const models = [...new Set([env.AI_MODEL_PRIMARY || "deepseek-v4-flash", "deepseek-chat"])];
  const errors = [];
  for (const model of models) {
    try {
      const response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({ model, messages, max_tokens: action === "hint" || action === "mastery_check" ? 700 : 500, temperature: 0.25 }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || `DeepSeek API failed with ${model}`);
      const text = payload?.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error(`DeepSeek returned empty text with ${model}`);
      return {
        provider: "deepseek",
        model,
        text,
        inputTokens: Number(payload?.usage?.prompt_tokens ?? estimateTokens(JSON.stringify(messages))),
        outputTokens: Number(payload?.usage?.completion_tokens ?? estimateTokens(text)),
      };
    } catch (error) {
      errors.push(`${model}: ${error.message}`);
    }
  }
  throw new Error(errors.join(" / "));
}

async function callDeepSeekPrompt(env, reason, prompt, maxTokens = 500) {
  const messages = [
    { role: "system", content: aiSystemPrompt() },
    { role: "user", content: prompt },
  ];
  const models = [...new Set([env.AI_MODEL_PRIMARY || "deepseek-v4-flash", "deepseek-chat"])];
  const errors = [];
  for (const model of models) {
    try {
      const response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.25 }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || `DeepSeek ${reason} failed with ${model}`);
      const text = payload?.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error(`DeepSeek returned empty text with ${model}`);
      return {
        provider: "deepseek",
        model,
        text,
        inputTokens: Number(payload?.usage?.prompt_tokens ?? estimateTokens(JSON.stringify(messages))),
        outputTokens: Number(payload?.usage?.completion_tokens ?? estimateTokens(text)),
      };
    } catch (error) {
      errors.push(`${model}: ${error.message}`);
    }
  }
  throw new Error(errors.join(" / "));
}

function triageJudgePrompt(originalText) {
  return [
    "너는 Investment OS v9 Phase 1의 체화구분 채점자다.",
    "전체 맥락을 먼저 읽고 구조를 파악한다. 인용글, 인용글의 원문, 답글, 시간순 흐름, 제3자 발언을 모두 합쳐 하나의 맥락으로 본다.",
    "부분 문장이나 마지막 글 하나만 보지 말고, 맥락 단위로 하나의 결정을 내린다.",
    "Phase 1 목표: Elite 3 글에서 투자 고수의 사고방식, 판단 기준, 시장을 읽는 관점, 리스크 인식, 포지션/타이밍 감각, 실행 원칙을 뽑아 체화한다.",
    "최종 체화/넘김 결정은 시스템이 점수 합계로 한다. 너는 아래 기준표에 맞춰 점수와 근거만 채운다.",
    "엄격 모드다. 좋아 보이는 말이 아니라 다음 투자 판단에 재사용 가능한 기준이 있을 때만 높은 점수를 준다.",
    "채점 기준:",
    "- thinking: 사고방식/판단 기준/시장 해석/리스크 인식이 있으면 0~3점",
    "- reusability: 다음 비슷한 상황에 다시 쓸 수 있으면 0~3점",
    "- context_completeness: 인용/답글/시간순 맥락이 충분히 완성되어 있으면 0~2점",
    "- rarity: 흔한 말이 아니라 고수의 선호나 원칙이 선명하면 0~1점",
    "- noise_penalty: 단순 뉴스, 잡담, 감상, 홍보, 정보 나열이면 0~-3점",
    "등급 기준은 참고만 하라. 시스템이 합계로 다시 확정한다.",
    "- A: 7점 이상, 무조건 체화",
    "- B: 5~6점, 하루 10개 제한 안에서 체화",
    "- C: 3~4점, 저장만 하고 체화봇에는 보내지 않음",
    "- D: 2점 이하, 넘김",
    "A/B 등급만 체화봇으로 보낸다. C/D는 체화봇으로 보내지 않는다.",
    "반드시 JSON 한 줄로만 답하라.",
    '형식: {"scores":{"thinking":0,"reusability":0,"context_completeness":0,"rarity":0,"noise_penalty":0},"grade":"A 또는 B 또는 C 또는 D","reason":"짧은 한국어 이유","extracted_principle":"뽑을 수 있는 사고 원칙. 없으면 빈 문자열","noise_reason":"감점 이유. 없으면 빈 문자열"}',
    "",
    originalText,
  ].join("\n");
}

function clampScore(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function gradeFromTriageScore(totalScore) {
  if (totalScore >= 7) return "A";
  if (totalScore >= 5) return "B";
  if (totalScore >= 3) return "C";
  return "D";
}

function parseTriageJudgeText(text) {
  const trimmed = String(text ?? "").trim();
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI 채점 결과가 JSON이 아님");
  const parsed = JSON.parse(match[0]);
  const scores = {
    thinking: clampScore(parsed.scores?.thinking, 0, 3),
    reusability: clampScore(parsed.scores?.reusability, 0, 3),
    context_completeness: clampScore(parsed.scores?.context_completeness, 0, 2),
    rarity: clampScore(parsed.scores?.rarity, 0, 1),
    noise_penalty: clampScore(parsed.scores?.noise_penalty, -3, 0),
  };
  const totalScore = Object.values(scores).reduce((sum, value) => sum + value, 0);
  const grade = gradeFromTriageScore(totalScore);
  const decision = grade === "A" || grade === "B" ? "internalize" : "skip";
  return {
    decision,
    grade,
    modelGrade: ["A", "B", "C", "D"].includes(parsed.grade) ? parsed.grade : null,
    totalScore,
    scores,
    reason: String(parsed.reason ?? "").slice(0, 200),
    extractedPrinciple: String(parsed.extracted_principle ?? "").slice(0, 300),
    noiseReason: String(parsed.noise_reason ?? "").slice(0, 300),
  };
}

async function judgeTriageWithDeepSeek(env, originalText) {
  if (!env.DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY가 없음");
  const system = "너는 투자 학습용 맥락을 고정 기준표로 채점하는 분류기다. 전체 맥락을 파악한 뒤 JSON 외 다른 말은 하지 않는다.";
  const user = triageJudgePrompt(originalText);
  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  const models = [...new Set([env.AI_MODEL_PRIMARY || "deepseek-v4-flash", "deepseek-chat"])];
  const estimatedInput = estimateTokens(JSON.stringify(messages));
  const estimatedOutput = 320;
  const estimatedKrw = estimateKrw("deepseek", estimatedInput, estimatedOutput, env);
  const spend = await canSpend(env, estimatedKrw);
  if (!spend.ok) throw new Error(`AI ?? ??: 24?? ${spend.dailyKrw}/${spend.dailyLimit}?`);

  const errors = [];
  for (const model of models) {
    try {
      const response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({ model, messages, max_tokens: 320, temperature: 0.1 }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || `DeepSeek triage judge failed with ${model}`);
      const outputText = payload?.choices?.[0]?.message?.content?.trim();
      if (!outputText) throw new Error(`DeepSeek 판단 결과가 비어 있음: ${model}`);
      const judged = parseTriageJudgeText(outputText);
      const inputTokens = Number(payload?.usage?.prompt_tokens ?? estimatedInput);
      const outputTokens = Number(payload?.usage?.completion_tokens ?? estimateTokens(outputText));
      const actualKrw = estimateKrw("deepseek", inputTokens, outputTokens, env);
      await recordAiCost(env, {
        provider: "deepseek",
        model,
        reason: `triage:auto_score:${judged.grade}:${judged.decision}`,
        inputTokens,
        outputTokens,
        estimatedKrw: actualKrw,
      });
      return { ...judged, model, estimatedKrw: actualKrw };
    } catch (error) {
      errors.push(`${model}: ${error.message}`);
    }
  }
  throw new Error(errors.join(" / "));
}

async function judgeTriageWithClaude(env, originalText) {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY가 없음");
  const model = env.AI_MODEL_JUDGE || "claude-sonnet-4-6";
  const prompt = `${triageJudgePrompt(originalText)}\n\nJSON 한 줄만 답하라.`;
  const estimatedInput = estimateTokens(prompt);
  const estimatedOutput = 320;
  const estimatedKrw = estimateKrw("anthropic", estimatedInput, estimatedOutput, env);
  const spend = await canSpend(env, estimatedKrw);
  if (!spend.ok) throw new Error(`AI 한도 초과: 24시간 ${spend.dailyKrw}/${spend.dailyLimit}원`);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 420,
      temperature: 0.1,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    const errorType = payload?.error?.type ? ` (${payload.error.type})` : "";
    throw new Error(`${payload?.error?.message || `Claude triage judge failed with ${model}`}${errorType}`);
  }
  const outputText = payload?.content?.map((part) => part.text).filter(Boolean).join("\n").trim();
  if (!outputText) throw new Error(`Claude 판단 결과가 비어 있음: ${model}`);
  const judged = parseTriageJudgeText(outputText);
  const inputTokens = Number(payload?.usage?.input_tokens ?? estimatedInput);
  const outputTokens = Number(payload?.usage?.output_tokens ?? estimateTokens(outputText));
  const actualKrw = estimateKrw("anthropic", inputTokens, outputTokens, env);
  await recordAiCost(env, {
    provider: "anthropic",
    model,
    reason: `triage:auto_score:anthropic:${model}:${judged.grade}:${judged.decision}`,
    inputTokens,
    outputTokens,
    estimatedKrw: actualKrw,
  });
  return { ...judged, model, estimatedKrw: actualKrw };
}

async function judgeTriageWithAi(env, originalText) {
  if (env.AI_PROVIDER_JUDGE === "anthropic") {
    try {
      return await judgeTriageWithClaude(env, originalText);
    } catch (error) {
      if (env.DEEPSEEK_API_KEY) {
        const judged = await judgeTriageWithDeepSeek(env, originalText);
        return {
          ...judged,
          fallbackFrom: "anthropic",
          fallbackReason: error.message,
        };
      }
      throw error;
    }
  }
  return judgeTriageWithDeepSeek(env, originalText);
}

function autoTriageLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 5;
  return Math.max(1, Math.min(20, Math.floor(parsed)));
}

async function autoTriageBatch(env, requestedLimit = 5) {
  const limit = autoTriageLimit(requestedLimit);
  if (await hasPendingApproval(env)) {
    const remaining = await env.PHASE1_DB.prepare(
      "SELECT COUNT(*) AS count FROM context_units WHERE rt_only_excluded = 0 AND canonical_status = 'verified' AND triage_decision IS NULL",
    ).first();
    return {
      action: "autoTriageBatch",
      requestedLimit: limit,
      processed: 0,
      internalized: 0,
      pendingApproval: 0,
      skipped: 0,
      failed: 0,
      grades: { A: 0, B: 0, C: 0, D: 0 },
      remaining: Number(remaining?.count ?? 0),
      pausedForPendingApproval: true,
      results: [],
    };
  }
  const query = await nextAutoTriageUnits(env, limit);
  const units = query.results ?? [];
  const results = [];
  let internalized = 0;
  let skipped = 0;
  let failed = 0;
  let pendingApproval = 0;
  const grades = { A: 0, B: 0, C: 0, D: 0 };

  for (const unit of units) {
    try {
      const judged = await judgeTriageWithAi(env, unit.original_text);
      const needsApproval = judged.decision === "internalize";
      const decision = await applyTriageDecision(env, unit, needsApproval ? "pendingApproval" : "skip", judged);
      if (needsApproval) {
        pendingApproval += 1;
        if (env.TRIAGE_CHAT_ID) {
          await sendTriageReviewCard(env, String(env.TRIAGE_CHAT_ID), unit, judged);
        }
        if (pendingApproval >= MAX_PENDING_APPROVAL_CARDS) break;
      }
      if (judged.decision === "skip") skipped += 1;
      grades[judged.grade] = (grades[judged.grade] ?? 0) + 1;
      results.push({
        unitId: unit.unit_id,
        expertHandle: unit.expert_handle,
        decision,
        aiDecision: judged.decision,
        grade: judged.grade,
        score: judged.totalScore,
        scores: judged.scores,
        reason: judged.reason,
        extractedPrinciple: judged.extractedPrinciple,
        noiseReason: judged.noiseReason,
        fallbackFrom: judged.fallbackFrom,
        fallbackReason: judged.fallbackReason,
        estimatedKrw: judged.estimatedKrw,
        model: judged.model,
      });
    } catch (error) {
      failed += 1;
      results.push({
        unitId: unit.unit_id,
        expertHandle: unit.expert_handle,
        error: error.message,
      });
      break;
    }
  }

  const remaining = await env.PHASE1_DB.prepare(
    "SELECT COUNT(*) AS count FROM context_units WHERE rt_only_excluded = 0 AND canonical_status = 'verified' AND triage_decision IS NULL",
  ).first();

  return {
    action: "autoTriageBatch",
    requestedLimit: limit,
    processed: pendingApproval + skipped,
    internalized,
    pendingApproval,
    skipped,
    failed,
    grades,
    remaining: Number(remaining?.count ?? 0),
    results,
  };
}

function autoTriageSummary(data) {
  return [
    "AI 자동 구분 결과",
    `처리: ${data.processed}개`,
    `2차 확인 대기: ${data.pendingApproval ?? 0}개`,
    `체화봇으로 넘김: ${data.internalized}개`,
    `넘김: ${data.skipped}개`,
    `등급: A ${data.grades?.A ?? 0}개 / B ${data.grades?.B ?? 0}개 / C ${data.grades?.C ?? 0}개 / D ${data.grades?.D ?? 0}개`,
    `실패: ${data.failed}개`,
    `남은 맥락: ${data.remaining}개`,
    data.failed ? `실패 이유: ${data.results.find((row) => row.error)?.error ?? "알 수 없음"}` : null,
  ].filter(Boolean).join("\n");
}

async function runOneTriageStep(env, chatId) {
  const result = await autoTriageBatch(env, env.AUTO_TRIAGE_SCAN_LIMIT ?? 20);
  if (result.pausedForPendingApproval) {
    await sendOldestPendingApproval(env, chatId);
    return result;
  }
  if (result.failed > 0) {
    return result;
  }
  if (result.pendingApproval > 0) return result;
  return result;
}

async function runTriageUntilReviewCard(env, chatId, maxRounds = 6) {
  let lastResult = null;
  for (let round = 0; round < maxRounds; round += 1) {
    lastResult = await runOneTriageStep(env, chatId);
    if (lastResult.pausedForPendingApproval || lastResult.pendingApproval > 0) return lastResult;
    if (lastResult.failed > 0 || lastResult.processed === 0) return lastResult;
  }
  return lastResult;
}

async function callClaude(env, action, originalText) {
  const model = env.AI_MODEL_JUDGE || "claude-sonnet-4-6";
  const prompt = `${aiSystemPrompt()}\n\n${aiUserPrompt(action, originalText)}`;
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 500,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || "Claude API failed");
  const text = payload?.content?.map((part) => part.text).filter(Boolean).join("\n").trim();
  if (!text) throw new Error("Claude returned empty text");
  return {
    provider: "anthropic",
    model,
    text,
    inputTokens: Number(payload?.usage?.input_tokens ?? estimateTokens(prompt)),
    outputTokens: Number(payload?.usage?.output_tokens ?? estimateTokens(text)),
  };
}

async function buildAiInternalizationText(env, action, originalText) {
  if (action === "start" || action === "resume" || action === "finish_day" || action === "complete") {
    return { text: internalizationControlText(action, originalText), requiresPaidModel: false };
  }
  const provider = "deepseek";
  const hasKey = Boolean(env.DEEPSEEK_API_KEY);
  if (!hasKey) {
    return {
      text: `${internalizationControlText(action, originalText)}\n\nAI 키가 아직 없어서 기본 도움말로 보냈어요.`,
      requiresPaidModel: false,
    };
  }
  const estimatedInput = estimateTokens(originalText) + 250;
  const estimatedOutput = action === "hint" || action === "mastery_check" ? 700 : 500;
  const estimatedKrw = estimateKrw(provider, estimatedInput, estimatedOutput, env);
  const spend = await canSpend(env, estimatedKrw);
  if (!spend.ok) {
    return {
      text: [
        "오늘은 유료 AI 한도에 닿았어요.",
        `하루 한도: ${spend.dailyLimit}원`,
        `최근 24시간 사용: ${spend.dailyKrw}원`,
        "",
        internalizationControlText(action, originalText),
      ].join("\n"),
      requiresPaidModel: false,
    };
  }
  try {
    const result = await callDeepSeek(env, action, originalText);
    const actualKrw = estimateKrw(result.provider, result.inputTokens, result.outputTokens, env);
    await recordAiCost(env, {
      provider: result.provider,
      model: result.model,
      reason: `internalization:${action}`,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      estimatedKrw: actualKrw,
    });
    return {
      text: `${result.text}\n\n사용 AI: ${result.provider === "anthropic" ? "Claude" : "DeepSeek"} / 약 ${actualKrw}원`,
      requiresPaidModel: true,
    };
  } catch (error) {
    return {
      text: ["AI 호출이 잠깐 실패했어요. 기본 도움말로 대신 보냅니다.", `이유: ${error.message}`, "", internalizationControlText(action, originalText)].join("\n"),
      requiresPaidModel: false,
    };
  }
}

function answerFeedbackFallback(userAnswer) {
  return [
    "답변 피드백",
    "1. 좋은 점",
    "- 네 답변을 기준으로 원문을 그냥 읽고 넘기지 않고, 직접 판단으로 바꾸려는 흐름은 잡혔어요.",
    "2. 더 생각해볼 점",
    "- 이 생각이 맞으려면 어떤 조건이 필요할지 하나 더 적어보세요.",
    "- 반대로 이 생각이 틀릴 수 있는 상황도 같이 적어보세요.",
    "3. 다시 물어볼 질문",
    "- 이 맥락에서 다음 투자 판단에 다시 쓸 수 있는 기준은 뭔가요?",
    "- 지금 답변에서 확인이 필요한 사실과 내 해석을 나누면 어떻게 되나요?",
    "",
    "사용자 답변:",
    userAnswer,
  ].join("\n");
}

async function buildAnswerFeedbackText(env, unit, userAnswer) {
  const provider = "deepseek";
  if (!env.DEEPSEEK_API_KEY) {
    return {
      text: `${answerFeedbackFallback(userAnswer)}\n\nAI 연결이 아직 없어서 기본 피드백으로 답했어요.`,
      requiresPaidModel: false,
    };
  }
  const prompt = aiAnswerFeedbackPrompt(unit.original_text, userAnswer);
  const estimatedInput = estimateTokens(prompt) + 120;
  const estimatedOutput = 500;
  const estimatedKrw = estimateKrw(provider, estimatedInput, estimatedOutput, env);
  const spend = await canSpend(env, estimatedKrw);
  if (!spend.ok) {
    return {
      text: [
        "오늘 유료 AI 한도에 가까워서 기본 피드백으로 답할게요.",
        `하루 한도: ${spend.dailyLimit}원`,
        `최근 24시간 사용: ${spend.dailyKrw}원`,
        "",
        answerFeedbackFallback(userAnswer),
      ].join("\n"),
      requiresPaidModel: false,
    };
  }
  try {
    const result = await callDeepSeekPrompt(env, "answer_feedback", prompt, 500);
    const actualKrw = estimateKrw(result.provider, result.inputTokens, result.outputTokens, env);
    await recordAiCost(env, {
      provider: result.provider,
      model: result.model,
      reason: "internalization:answer_feedback",
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      estimatedKrw: actualKrw,
    });
    return {
      text: `${result.text}\n\n사용 AI: DeepSeek / 약 ${actualKrw}원`,
      requiresPaidModel: true,
    };
  } catch (error) {
    return {
      text: ["AI 호출에 실패해서 기본 피드백으로 답할게요.", `이유: ${error.message}`, "", answerFeedbackFallback(userAnswer)].join("\n"),
      requiresPaidModel: false,
    };
  }
}

async function handleTriage(env, callback, ctx) {
  const chatId = String(callback.message.chat.id);
  const parsed = parseTriageCallback(callback.data);
  if (!parsed) return { handled: false };
  await answerCallback(
    env,
    "triage",
    callback.id,
  );
  const unit = await getContextUnit(env, parsed.unitId);
  if (!unit) {
    await clearClickedMessage(env, "internalization", callback);
    await telegram(env, "internalization", "sendMessage", {
      chat_id: chatId,
      text: "아직 체화할 맥락이 없어요. 체화구분 봇에서 이 맥락 체화를 먼저 눌러주세요.",
      reply_markup: { inline_keyboard: internalizationMainKeyboard() },
    });
    return { handled: true, action: parsed.action, unitId: parsed.unitId, found: false };
  }
  let aiJudge = null;
  if (parsed.action === "approve" || parsed.action === "reject") {
    const rationale = triageRationale(unit);
    const triageScore = {
      grade: unit.triage_grade ?? rationale.grade,
      totalScore: unit.triage_score ?? rationale.total_score,
      scores: rationale.scores,
      reason: rationale.reason,
      extractedPrinciple: rationale.extracted_principle,
      noiseReason: rationale.noise_reason,
      modelGrade: rationale.model_grade,
      fallbackFrom: rationale.fallback_from,
      fallbackReason: rationale.fallback_reason,
    };
    const action = parsed.action;
    const runApproval = async () => {
      const decision = await applyTriageDecision(
        env,
        unit,
        action === "approve" ? "internalize" : "skip",
        triageScore,
      );
      await clearClickedMessage(env, "triage", callback);
      const sentPending = await sendOldestPendingApproval(env, chatId);
      if (sentPending) {
        return {
          decision,
          nextResult: {
            action: "sendOldestPendingApproval",
            pendingApproval: 1,
            reusedPendingApproval: true,
          },
        };
      }
      const nextResult = await runTriageUntilReviewCard(env, chatId);
      return { decision, nextResult };
    };
    if (queueBackground(ctx, runApproval, (error) => sendBackgroundFailureNotice(
      env,
      "triage",
      chatId,
      `다음 맥락을 준비하다가 멈췄습니다.\n이유: ${error.message}\n\n시작을 누르면 다시 이어갑니다.`,
    ))) {
      return {
        handled: true,
        action,
        unitId: parsed.unitId,
        queued: true,
        savedForInternalization: action === "approve",
      };
    }
    const { decision, nextResult } = await runApproval();
    return {
      handled: true,
      action,
      unitId: parsed.unitId,
      decision,
      savedForInternalization: action === "approve",
      nextResult,
    };
  }
  if (parsed.action === "ai_judge") {
    try {
      aiJudge = await judgeTriageWithAi(env, unit.original_text);
      parsed.action = aiJudge.decision;
    } catch (error) {
      await telegram(env, "triage", "sendMessage", {
        chat_id: chatId,
        text: `AI 채점 실패\n${error.message}`,
        reply_markup: { inline_keyboard: BACK_TO_MENU },
      });
      return { handled: true, action: "ai_judge", unitId: parsed.unitId, aiJudgeFailed: true, error: error.message };
    }
  }
  const decision = await applyTriageDecision(env, unit, parsed.action);
  await clearClickedMessage(env, "triage", callback);
  const nextUnit = await nextTriageUnit(env);
  if (nextUnit) {
    await sendTriageUnit(env, chatId, nextUnit);
  } else {
    await telegram(env, "triage", "sendMessage", {
      chat_id: chatId,
      text: "오늘 볼 수 있는 구분 글은 다 봤어요.",
      reply_markup: { inline_keyboard: TRIAGE_MENU_BUTTONS },
    });
  }
  return { handled: true, action: parsed.action, unitId: parsed.unitId, decision, savedForInternalization: parsed.action === "internalize", aiJudge, requiresPaidModel: Boolean(aiJudge) };
}

async function handleInternalization(env, callback) {
  const chatId = String(callback.message.chat.id);
  const parsed = parseInternalizationCallback(callback.data);
  if (!parsed) return { handled: false };
  await answerCallback(
    env,
    "internalization",
    callback.id,
  );
  const unit = await getContextUnit(env, parsed.unitId);
  if (!unit) {
    await clearClickedMessage(env, "internalization", callback);
    await telegram(env, "internalization", "sendMessage", {
      chat_id: chatId,
      text: "체화할 맥락이 없습니다.",
      reply_markup: { inline_keyboard: internalizationMainKeyboard() },
    });
    return { handled: true, action: parsed.action, unitId: parsed.unitId, found: false };
  }
  const stateByAction = {
    start: "in_progress",
    resume: "in_progress",
    finish_day: "in_progress",
    hint: "hint_requested",
    retry: "retry_requested",
    mastery_check: "mastery_check_requested",
    complete: "completed",
  };
  const state = stateByAction[parsed.action];
  const keepCurrentMessage = parsed.action === "hint" || parsed.action === "mastery_check";
  await setInternalizationState(env, unit.unit_id, state);
  if (!keepCurrentMessage) await clearClickedMessage(env, "internalization", callback);
  if (parsed.action === "complete") {
    const nextUnit = await getContextUnit(env, "active");
    if (nextUnit) {
      await setInternalizationState(env, nextUnit.unit_id, "in_progress");
      const payload = internalizationMessage(nextUnit);
      await sendLongMessage(env, "internalization", chatId, payload.text, payload.reply_markup, { cleanupBefore: true, remember: true });
      return {
        handled: true,
        action: parsed.action,
        unitId: unit.unit_id,
        internalizationState: state,
        nextUnitId: nextUnit.unit_id,
        requiresPaidModel: false,
      };
    }
    await sendTrackedMessage(env, "internalization", {
      chat_id: chatId,
      text: "오늘 체화할 맥락이 없습니다.",
      reply_markup: { inline_keyboard: internalizationMainKeyboard() },
    }, { cleanupBefore: true, remember: true });
    return { handled: true, action: parsed.action, unitId: unit.unit_id, internalizationState: state, nextUnitId: null, requiresPaidModel: false };
  }
  if (parsed.action === "start") {
    const payload = internalizationMessage(unit);
    await sendLongMessage(env, "internalization", chatId, payload.text, payload.reply_markup, { cleanupBefore: true, remember: true });
    return { handled: true, action: parsed.action, unitId: unit.unit_id, internalizationState: state, requiresPaidModel: false };
  }
  const aiText = await buildAiInternalizationText(env, parsed.action, unit.original_text);
  await sendLongMessage(
    env,
    "internalization",
    chatId,
    aiText.text,
    { inline_keyboard: internalizationMainKeyboard(unit.unit_id) },
    { cleanupBefore: !keepCurrentMessage, remember: !keepCurrentMessage },
  );
  return { handled: true, action: parsed.action, unitId: unit.unit_id, internalizationState: state, requiresPaidModel: aiText.requiresPaidModel };
}

async function handleInternalizationText(env, message) {
  const chatId = String(message.chat.id);
  const text = String(message.text ?? "").trim();
  if (!text || text.startsWith("/")) return { handled: false };
  const unit = await getContextUnit(env, "active");
  if (!unit) {
    await sendTrackedMessage(env, "internalization", {
      chat_id: chatId,
      text: "체화할 맥락이 없습니다.",
      reply_markup: { inline_keyboard: internalizationMainKeyboard() },
    }, { cleanupBefore: false, remember: false });
    return { handled: true, action: "answer_feedback", found: false };
  }
  await setInternalizationState(env, unit.unit_id, "answer_feedback_requested");
  const aiText = await buildAnswerFeedbackText(env, unit, text);
  await sendLongMessage(
    env,
    "internalization",
    chatId,
    aiText.text,
    { inline_keyboard: internalizationMainKeyboard(unit.unit_id) },
    { cleanupBefore: false, remember: false },
  );
  return {
    handled: true,
    action: "answer_feedback",
    unitId: unit.unit_id,
    requiresPaidModel: aiText.requiresPaidModel,
  };
}

async function handleOps(env, callback, ctx) {
  const chatId = String(callback.message.chat.id);
  const data = callback.data;
  if (data === "ops:auto_triage") {
    await answerCallback(env, "triage", callback.id);
    const runAutoTriage = async () => {
      await clearClickedMessage(env, "triage", callback);
      return runTriageUntilReviewCard(env, chatId);
    };
    if (queueBackground(ctx, runAutoTriage, (error) => sendBackgroundFailureNotice(
      env,
      "triage",
      chatId,
      `체화구분을 준비하다가 멈췄습니다.\n이유: ${error.message}\n\n시작을 누르면 다시 이어갑니다.`,
    ))) {
      return { handled: true, action: "auto_triage_queued" };
    }
    const result = await runAutoTriage();
    return { handled: true, ...result };
  }
  return { handled: false };
}

async function handleWebhook(request, env, botRole, ctx) {
  if (!env.TELEGRAM_BOT_TOKEN) return json({ ok: false, error: "TELEGRAM_BOT_TOKEN is required" }, 500);
  const update = await request.json();
  if (update.message?.text === "/start") {
    const chatId = String(update.message.chat.id);
    const payload = botRole === "internalization" ? internalizationStartMessage() : triageStartMessage();
    await sendTrackedMessage(env, botRole, { chat_id: chatId, ...payload }, { cleanupBefore: true, remember: true });
    return json({ ok: true, data: { handled: true, action: botRole === "internalization" ? "internalization_home" : "menu" } });
  }
  if (botRole === "internalization" && update.message?.text) {
    const result = await handleInternalizationText(env, update.message);
    if (result.handled) return json({ ok: true, data: result });
  }
  if (update.callback_query?.id && update.callback_query?.data && update.callback_query?.message?.chat?.id) {
    let result = { handled: false };
    if (botRole === "triage") {
      result = await handleOps(env, update.callback_query, ctx);
      if (!result.handled) result = await handleTriage(env, update.callback_query, ctx);
    } else {
      result = await handleInternalization(env, update.callback_query);
    }
    if (!result.handled) {
      await telegram(env, botRole, "answerCallbackQuery", {
        callback_query_id: update.callback_query.id,
        text: botRole === "internalization" ? "체화 봇 버튼만 눌러주세요" : "아직 못 해요",
      });
    }
    return json({ ok: true, data: result });
  }
  return json({ ok: true, data: { handled: false } });
}

async function setWebhookFor(request, env, botRole) {
  const token = tokenFor(env, botRole);
  if (!token) return { ok: false, error: `${botRole} token is required` };
  const path = botRole === "internalization" ? "/telegram/webhook/internalization" : "/telegram/webhook/triage";
  const webhookUrl = new URL(path, request.url).toString();
  const result = await telegramWithToken(token, "setWebhook", { url: webhookUrl, allowed_updates: ["message", "callback_query"] });
  await telegramWithToken(token, "deleteMyCommands", {});
  return { ok: true, botRole, webhookUrl, result };
}

async function registerWebhook(request, env) {
  const triage = await setWebhookFor(request, env, "triage");
  const internalization = env.INTERNALIZATION_BOT_TOKEN
    ? await setWebhookFor(request, env, "internalization")
    : { ok: false, botRole: "internalization", skipped: true, reason: "INTERNALIZATION_BOT_TOKEN is not set" };
  return json({ ok: Boolean(triage.ok), data: { action: "setWebhook", triage, internalization } }, triage.ok ? 200 : 500);
}

async function sendMenu(env) {
  if (!env.TELEGRAM_BOT_TOKEN) return json({ ok: false, error: "TELEGRAM_BOT_TOKEN is required" }, 500);
  if (!env.TRIAGE_CHAT_ID) return json({ ok: false, error: "TRIAGE_CHAT_ID is required" }, 500);
  const sent = await sendTrackedMessage(env, "triage", { chat_id: String(env.TRIAGE_CHAT_ID), ...triageStartMessage() }, { cleanupBefore: true, remember: true });
  return json({ ok: true, data: { action: "sendMenu", chatId: String(env.TRIAGE_CHAT_ID), messageId: sent.message_id } });
}

async function sendInternalizationHome(env) {
  const token = tokenFor(env, "internalization");
  if (!token) return json({ ok: false, error: "INTERNALIZATION_BOT_TOKEN is required" }, 500);
  if (!env.INTERNALIZATION_CHAT_ID) return json({ ok: false, error: "INTERNALIZATION_CHAT_ID is required" }, 500);
  const sent = await sendTrackedMessage(env, "internalization", { chat_id: String(env.INTERNALIZATION_CHAT_ID), ...internalizationStartMessage() }, { cleanupBefore: true, remember: true });
  return json({ ok: true, data: { action: "sendInternalizationHome", chatId: String(env.INTERNALIZATION_CHAT_ID), messageId: sent.message_id } });
}

async function sendInternalizationActive(env) {
  try {
    const token = tokenFor(env, "internalization");
    if (!token) return json({ ok: false, error: "INTERNALIZATION_BOT_TOKEN is required" }, 500);
    if (!env.INTERNALIZATION_CHAT_ID) return json({ ok: false, error: "INTERNALIZATION_CHAT_ID is required" }, 500);
    const unit = await getContextUnit(env, "active");
    if (!unit) return json({ ok: true, data: { action: "sendInternalizationActive", sent: false, found: false } });
    await setInternalizationState(env, unit.unit_id, "in_progress");
    const payload = internalizationMessage(unit);
    const sent = await sendLongMessage(env, "internalization", String(env.INTERNALIZATION_CHAT_ID), payload.text, payload.reply_markup, { cleanupBefore: true, remember: true });
    return json({
      ok: true,
      data: {
        action: "sendInternalizationActive",
        sent: true,
        unitId: unit.unit_id,
        messageId: sent.message_id,
      },
    });
  } catch (error) {
    return json({
      ok: false,
      error: error.message,
    }, 500);
  }
}

async function sendNextTriage(env) {
  if (!env.TELEGRAM_BOT_TOKEN) return json({ ok: false, error: "TELEGRAM_BOT_TOKEN is required" }, 500);
  if (!env.TRIAGE_CHAT_ID) return json({ ok: false, error: "TRIAGE_CHAT_ID is required" }, 500);
  const unit = await nextTriageUnit(env);
  if (!unit) return json({ ok: true, data: { action: "sendNextTriage", sent: false } });
  const sent = await sendTriageUnit(env, String(env.TRIAGE_CHAT_ID), unit);
  return json({ ok: true, data: { action: "sendNextTriage", sent: true, unitId: unit.unit_id, messageId: sent.message_id } });
}

async function autoTriageRequest(request, env) {
  const url = new URL(request.url);
  let body = {};
  try {
    body = request.headers.get("content-type")?.includes("application/json")
      ? await request.json()
      : {};
  } catch {
    body = {};
  }
  const result = await autoTriageBatch(env, body.limit ?? url.searchParams.get("limit") ?? env.AUTO_TRIAGE_BATCH_LIMIT ?? 5);
  return json({ ok: result.failed === 0, data: result }, result.failed === 0 ? 200 : 500);
}

async function resendQueuedForApproval(env) {
  if (!env.TELEGRAM_BOT_TOKEN) return json({ ok: false, error: "TELEGRAM_BOT_TOKEN is required" }, 500);
  if (!env.TRIAGE_CHAT_ID) return json({ ok: false, error: "TRIAGE_CHAT_ID is required" }, 500);
  const query = await env.PHASE1_DB.prepare(
    [
      "SELECT saved.unit_id, saved.expert_handle, saved.original_text, saved.completed_at,",
      "unit.triage_grade, unit.triage_score, unit.triage_rationale_json, unit.canonical_status, unit.rt_only_excluded",
      "FROM internalized_context_units saved",
      "JOIN context_units unit ON unit.unit_id = saved.unit_id",
      "WHERE unit.triage_decision = '체화'",
      "AND unit.triage_grade IN ('A', 'B')",
      "ORDER BY saved.selected_at ASC",
    ].join(" "),
  ).all();
  const units = query.results ?? [];
  let sent = 0;
  for (const unit of units) {
    const rationale = triageRationale(unit);
    const judged = {
      grade: unit.triage_grade ?? rationale.grade ?? "B",
      totalScore: unit.triage_score ?? rationale.total_score ?? 0,
      scores: rationale.scores,
      reason: rationale.reason,
      extractedPrinciple: rationale.extracted_principle,
      noiseReason: rationale.noise_reason,
      modelGrade: rationale.model_grade,
      fallbackFrom: rationale.fallback_from,
      fallbackReason: rationale.fallback_reason,
    };
    await env.PHASE1_DB.prepare("DELETE FROM internalized_context_units WHERE unit_id = ?").bind(unit.unit_id).run();
    await applyTriageDecision(env, unit, "pendingApproval", judged);
    await sendTriageReviewCard(env, String(env.TRIAGE_CHAT_ID), unit, judged);
    sent += 1;
  }
  return json({ ok: true, data: { action: "resendQueuedForApproval", sent } });
}

async function resendPendingApproval(env) {
  if (!env.TELEGRAM_BOT_TOKEN) return json({ ok: false, error: "TELEGRAM_BOT_TOKEN is required" }, 500);
  if (!env.TRIAGE_CHAT_ID) return json({ ok: false, error: "TRIAGE_CHAT_ID is required" }, 500);
  const query = await env.PHASE1_DB.prepare(
    [
      "SELECT unit_id, expert_handle, original_text, completed_at,",
      "triage_grade, triage_score, triage_rationale_json, canonical_status, rt_only_excluded",
      "FROM context_units",
      "WHERE triage_decision = 'pendingApproval'",
      "AND triage_grade IN ('A', 'B')",
      "ORDER BY completed_at ASC, unit_id ASC",
    ].join(" "),
  ).all();
  const units = query.results ?? [];
  let sent = 0;
  for (const unit of units) {
    const rationale = triageRationale(unit);
    await sendTriageReviewCard(env, String(env.TRIAGE_CHAT_ID), unit, {
      grade: unit.triage_grade ?? rationale.grade ?? "B",
      totalScore: unit.triage_score ?? rationale.total_score ?? 0,
      scores: rationale.scores,
      reason: rationale.reason,
      extractedPrinciple: rationale.extracted_principle,
      noiseReason: rationale.noise_reason,
      modelGrade: rationale.model_grade,
      fallbackFrom: rationale.fallback_from,
      fallbackReason: rationale.fallback_reason,
    });
    sent += 1;
  }
  return json({ ok: true, data: { action: "resendPendingApproval", sent } });
}

export default {
  async scheduled(_event, env, ctx) {
    if (env.AUTO_TRIAGE_ENABLED === "true") {
      ctx.waitUntil(autoTriageBatch(env, env.AUTO_TRIAGE_BATCH_LIMIT ?? 10));
    }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, data: { service: "investment-os-v9-phase1", store: "cloudflare_d1" } });
    }
    if (request.method === "POST" && url.pathname === "/telegram/webhook") return handleWebhook(request, env, "triage", ctx);
    if (request.method === "POST" && url.pathname === "/telegram/webhook/triage") return handleWebhook(request, env, "triage", ctx);
    if (request.method === "POST" && url.pathname === "/telegram/webhook/internalization") return handleWebhook(request, env, "internalization", ctx);
    if (request.method === "POST" && url.pathname === "/telegram/register-webhook") {
      const adminError = requireAdminRequest(request, env);
      if (adminError) return adminError;
      return registerWebhook(request, env);
    }
    if (request.method === "POST" && url.pathname === "/telegram/register-webhooks") {
      const adminError = requireAdminRequest(request, env);
      if (adminError) return adminError;
      return registerWebhook(request, env);
    }
    if (request.method === "POST" && url.pathname === "/telegram/send-menu") {
      const adminError = requireAdminRequest(request, env);
      if (adminError) return adminError;
      return sendMenu(env);
    }
    if (request.method === "POST" && url.pathname === "/telegram/send-internalization-home") {
      const adminError = requireAdminRequest(request, env);
      if (adminError) return adminError;
      return sendInternalizationHome(env);
    }
    if (request.method === "POST" && url.pathname === "/telegram/send-internalization-active") {
      const adminError = requireAdminRequest(request, env);
      if (adminError) return adminError;
      return sendInternalizationActive(env);
    }
    if (request.method === "POST" && url.pathname === "/telegram/send-next-triage") {
      const adminError = requireAdminRequest(request, env);
      if (adminError) return adminError;
      return sendNextTriage(env);
    }
    if (request.method === "POST" && url.pathname === "/telegram/auto-triage") {
      const adminError = requireAdminRequest(request, env);
      if (adminError) return adminError;
      return autoTriageRequest(request, env);
    }
    if (request.method === "POST" && url.pathname === "/telegram/resend-queued-for-approval") {
      const adminError = requireAdminRequest(request, env);
      if (adminError) return adminError;
      return resendQueuedForApproval(env);
    }
    if (request.method === "POST" && url.pathname === "/telegram/resend-pending-approval") {
      const adminError = requireAdminRequest(request, env);
      if (adminError) return adminError;
      return resendPendingApproval(env);
    }
    return json({ ok: false, error: "Not found" }, 404);
  },
};
