import { INTERNALIZATION_NEXT_BUTTONS, OPS_MENU_BUTTONS, TRIAGE_ACTION_BUTTONS } from "./labels.js";
import { renderInternalizationStart } from "./simulator.js";

type FetchFn = typeof fetch;

interface TelegramClientOptions {
  token: string;
  fetchFn?: FetchFn;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface TelegramMeResult {
  id: number;
  is_bot: boolean;
  username?: string;
}

interface TelegramUpdateResult {
  update_id: number;
  message?: {
    text?: string;
    chat: {
      id: number | string;
      title?: string;
      username?: string;
      type: string;
    };
  };
  channel_post?: {
    text?: string;
    chat: {
      id: number | string;
      title?: string;
      username?: string;
      type: string;
    };
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: {
      chat: {
        id: number | string;
        title?: string;
        username?: string;
        type: string;
      };
    };
  };
}

export interface TelegramMessagePayload {
  text: string;
  replyMarkup?: {
    inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
  };
}

export function requireTelegramToken(env: Record<string, string | undefined>): string {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN is required");
  }
  return token;
}

export class TelegramBotClient {
  private readonly fetchFn: FetchFn;

  constructor(private readonly options: TelegramClientOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async getMe() {
    const result = await this.call<TelegramMeResult>("getMe");
    return {
      id: result.id,
      isBot: result.is_bot,
      username: result.username,
    };
  }

  async getUpdates(offset?: number) {
    const updates = await this.call<TelegramUpdateResult[]>(
      "getUpdates",
      offset === undefined ? undefined : { offset },
    );
    return updates
      .map((update) => {
        if (update.callback_query) {
          const chat = update.callback_query.message?.chat;
          return {
            updateId: update.update_id,
            callbackQueryId: update.callback_query.id,
            callbackData: update.callback_query.data ?? null,
            chatId: chat ? String(chat.id) : null,
            chatTitle: chat?.title ?? chat?.username ?? null,
            chatType: chat?.type ?? null,
            text: null,
          };
        }

        const message = update.message ?? update.channel_post;
        if (!message) return null;
        return {
          updateId: update.update_id,
          callbackQueryId: null,
          callbackData: null,
          chatId: String(message.chat.id),
          chatTitle: message.chat.title ?? message.chat.username ?? null,
          chatType: message.chat.type,
          text: message.text ?? null,
        };
      })
      .filter((update): update is NonNullable<typeof update> => Boolean(update));
  }

  async sendMessage(chatId: string, payload: TelegramMessagePayload) {
    return this.call<{ message_id: number }>("sendMessage", {
      chat_id: chatId,
      text: payload.text,
      reply_markup: payload.replyMarkup,
    });
  }

  async answerCallbackQuery(callbackQueryId: string, text: string): Promise<void> {
    await this.call<true>("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text,
    });
  }

  private async call<T>(method: string, body?: unknown): Promise<T> {
    const response = await this.fetchFn(
      `https://api.telegram.org/bot${this.options.token}/${method}`,
      body
        ? {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }
        : undefined,
    );

    const json = (await response.json()) as TelegramApiResponse<T>;
    if (!json.ok || !json.result) {
      throw new Error(json.description ?? `Telegram API ${method} failed`);
    }
    return json.result;
  }
}

export function buildTelegramTriageMessage(unit: {
  unitId: string;
  expertHandle: string;
  originalText: string;
  canonicalStatus: string;
}): TelegramMessagePayload {
  const statusLabel =
    unit.canonicalStatus === "verified"
      ? "\uB05D\uB0A8"
      : unit.canonicalStatus === "pending"
        ? "\uAE30\uB2E4\uB9AC\uB294 \uC911"
        : unit.canonicalStatus === "quarantined"
          ? "\uBA48\uCDA4"
          : unit.canonicalStatus;

  return {
    text: [
      `\uAE00 #${unit.unitId}`,
      `\uC4F4 \uC0AC\uB78C: ${unit.expertHandle}`,
      `\uD655\uC778: ${statusLabel}`,
      "",
      "\uC77D\uC5B4\uBCFC \uAE00",
      unit.originalText,
    ].join("\n"),
    replyMarkup: {
      inline_keyboard: [
        [
          { text: TRIAGE_ACTION_BUTTONS[0], callback_data: `triage:${unit.unitId}:internalize` },
          { text: TRIAGE_ACTION_BUTTONS[1], callback_data: `triage:${unit.unitId}:skip` },
          { text: TRIAGE_ACTION_BUTTONS[2], callback_data: `triage:${unit.unitId}:hold` },
        ],
      ],
    },
  };
}

export function buildTelegramOpsMenuMessage(): TelegramMessagePayload {
  return {
    text: [
      "\uCCB4\uD654\uD560\uC9C0 \uBA3C\uC800 \uACE8\uB77C\uBCFC\uAC8C\uC694.",
      "\uC774 \uBD07\uC740 \uAE00\uC744 \uACE0\uB974\uB294 \uCCB4\uD654\uAD6C\uBD84 \uBD07\uC774\uC5D0\uC694.",
      "\uACF5\uBD80\uB294 \uCCB4\uD654 \uBD07\uC5D0\uC11C \uC774\uC5B4\uC9D1\uB2C8\uB2E4.",
    ].join("\n"),
    replyMarkup: {
      inline_keyboard: [
        [{ text: OPS_MENU_BUTTONS[0], callback_data: "ops:send_next_triage" }],
        [{ text: OPS_MENU_BUTTONS[1], callback_data: "ops:pending_cards" }],
        [{ text: OPS_MENU_BUTTONS[2], callback_data: "ops:status" }],
        [{ text: OPS_MENU_BUTTONS[3], callback_data: "ops:help" }],
      ],
    },
  };
}

export function buildTelegramInternalizationMessage(unit: {
  unitId: string;
  expertHandle: string;
  originalText: string;
}): TelegramMessagePayload {
  const start = renderInternalizationStart({
    unitId: unit.unitId,
    expertHandle: unit.expertHandle,
    originalText: unit.originalText,
    sourceStimulus: { status: "absent" },
    elitePosts: [unit.originalText],
    mediaItems: [],
  });

  return {
    text: start.text,
    replyMarkup: {
      inline_keyboard: [
        [
          {
            text: INTERNALIZATION_NEXT_BUTTONS[0],
            callback_data: `internalization:${unit.unitId}:hint`,
          },
          {
            text: INTERNALIZATION_NEXT_BUTTONS[1],
            callback_data: `internalization:${unit.unitId}:retry`,
          },
        ],
        [
          {
            text: INTERNALIZATION_NEXT_BUTTONS[2],
            callback_data: `internalization:${unit.unitId}:mastery_check`,
          },
          {
            text: INTERNALIZATION_NEXT_BUTTONS[3],
            callback_data: `internalization:${unit.unitId}:reschedule`,
          },
        ],
        [
          {
            text: INTERNALIZATION_NEXT_BUTTONS[4],
            callback_data: `internalization:${unit.unitId}:complete`,
          },
        ],
      ],
    },
  };
}
