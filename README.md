# Investment OS v9 Phase 1

Phase 1 scaffold for Chairman-first Elite 3 internalization.

Authority order:

1. `Investment_OS_v9_Phase1_Implementation_Ready_Master_Specification_v3.md`
2. `IMPLEMENTATION_SUPPLEMENT_v3A4_JIT_RT_ARCHIVE_REINFORCEMENT.md` for cost, ingestion, RT-only, JIT verification, and repeated-pattern handling

## Free-by-default policy

Paid paths are disabled unless explicitly enabled:

```env
ALLOW_PAID_PROVIDERS=false
```

Blocked by default:

- X PPU paid verification
- paid Apify discovery
- paid LLM coaching or verification
- full paid historical backfill

Enabled by default:

- local fixtures
- local JSON persistence for PC-on testing
- Cloudflare Worker + D1 scaffold for PC-off operation
- schema/workflow generation
- deterministic policy gates

## Elite 3

```text
@min_anko38
@LNCV34
@Alisvolatprop12
```

## Commands

Use `npm.cmd` on Windows PowerShell if script execution blocks `npm`.

```powershell
npm.cmd install
npm.cmd test
npm.cmd run build
npm.cmd run phase1 -- config:check
npm.cmd run phase1 -- ingest:historical --source fixtures --dry-run
npm.cmd run phase1 -- jit:enqueue --limit 10
npm.cmd run phase1 -- triage:next
npm.cmd run phase1 -- cost:status --spent-krw 500000
npm.cmd run phase1 -- ops:status
```

`ops:status` separates units already sent to Telegram from units still eligible to send:

- `triageSentAwaitingDecision`: sent cards waiting for a button decision.
- `nextUnsentTriageUnitId`: the next verified unit that has not been sent yet.

## Local API server

n8n workflows call the local API at `http://127.0.0.1:4319`.

```powershell
npm.cmd run server
```

Endpoints:

```text
GET  /health
POST /ingest/historical
POST /ingest/daily
POST /jit/enqueue
GET  /triage/next
```

Example:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:4319/ingest/historical -ContentType 'application/json' -Body '{"source":"fixtures"}'
Invoke-RestMethod -Method Post -Uri http://localhost:4319/jit/enqueue -ContentType 'application/json' -Body '{"limit":10}'
Invoke-RestMethod -Uri http://localhost:4319/triage/next
```

## Telegram bot

Do not commit the bot token. Set it only in the shell or an ignored `.env` file.

```powershell
$env:TELEGRAM_BOT_TOKEN='...'
npm.cmd run phase1 -- telegram:get-me
npm.cmd run phase1 -- telegram:updates
```

After adding the bot to a chat/channel and sending one message, use the returned `chatId`:

```powershell
$env:TRIAGE_CHAT_ID='...'
npm.cmd run phase1 -- telegram:send-triage
```

`telegram:send-triage` records the sent message and will not resend the same undecided unit unless `--force` is supplied.
If a card was sent before this tracking existed, reconcile it without calling Telegram:

```powershell
npm.cmd run phase1 -- telegram:mark-triage-sent --unit-id manual-001 --message-id 69
```

The triage message uses inline buttons and keeps `aiSummary` / `aiRecommendation` out of the triage channel.
Telegram chat paste/manual post import is intentionally disabled. Use buttons in Telegram; use the CLI JSON import only for admin migration/backfill.

To process inline button clicks without a public webhook URL:

```powershell
npm.cmd run phase1 -- telegram:poll-once
```

For hands-free local operation without a public webhook or paid tunnel, run the polling loop:

```powershell
npm.cmd run phase1 -- telegram:poll-loop
```

Use `--interval-ms` and `--max-iterations` for bounded checks:

```powershell
npm.cmd run phase1 -- telegram:poll-loop --interval-ms 3000 --max-iterations 5
```

Callback behavior:

- `triage:<unitId>:internalize` records `체화` and sends an original-first internalization message.
- `triage:<unitId>:skip` records `체화_안해도_됨`.
- `triage:<unitId>:hold` records `보류`.

Internalization control callbacks:

- `internalization:<unitId>:hint` sends a deterministic local hint.
- `internalization:<unitId>:retry` re-prompts from the original text.
- `internalization:<unitId>:mastery_check` sends a local mastery checklist.
- `internalization:<unitId>:reschedule` leaves a local no-paid reschedule note.

These controls also update local `internalizationState` values:

- `in_progress`
- `hint_requested`
- `retry_requested`
- `mastery_check_requested`
- `rescheduled`

The local API also exposes `POST /telegram/webhook` for local webhook tests. For PC-off operation, use the Cloudflare Worker below.

To resend the internalization control buttons for an existing unit:

```powershell
npm.cmd run phase1 -- telegram:send-internalization --unit-id min-001
```

After an internalization unit is active, send your own understanding as a normal Telegram message, then run:

```powershell
npm.cmd run phase1 -- telegram:poll-once
```

The message is stored as a Chairman attempt and receives deterministic local feedback. No paid model is called.

Telegram text commands are handled before Chairman attempts:

- `/status` sends the current Phase 1 operations status.

## Persistence

Without `DATABASE_URL`, `--persist` uses a local JSON store at `.phase1/local-store.json` and still makes no paid calls:

```powershell
npm.cmd run phase1 -- ingest:historical --source fixtures --persist
npm.cmd run phase1 -- jit:enqueue --limit 10 --persist
npm.cmd run phase1 -- triage:next --persist
```

Admin-only JSON import uses the same no-cost path. This is not exposed in Telegram:

```powershell
npm.cmd run phase1 -- ingest:historical --source manual --file data/manual-posts.example.json --persist
```

Manual post format:

```json
{
  "post_id": "manual-001",
  "expert_handle": "@min_anko38",
  "text": "수급이 가격보다 먼저 움직인다.",
  "created_at": "2026-02-01T00:00:00.000Z",
  "trust_layer": "canonical",
  "is_rt_only": false,
  "retweeted_post_id": "optional-source-id",
  "structural_basis": ["original_post"]
}
```

Only the fixed Elite 3 handles are accepted. `trust_layer` may be `canonical`, `gray`, `pending`, or `quarantined`; gray/pending rows remain discovery/pending until JIT verification.

With a free-tier Postgres/Supabase-compatible database, apply the migration first, then set:

```env
DATABASE_URL=postgresql://...
DATABASE_SSL=true
```

`DATABASE_SSL` defaults to true when the URL contains `supabase.co`.

## PC-off Cloudflare operation

Cloudflare Worker + D1 is the low-cost path for using the Telegram bot from a phone while the PC is off.

```powershell
npm.cmd run d1:export-local
npm.cmd run cloudflare:d1:migrate
npx wrangler d1 execute investment-os-v9-phase1 --remote --file .phase1/d1-import.sql
npm.cmd run cloudflare:deploy
```

## PC-off X collection with GitHub Actions

The Telegram bots already run on Cloudflare, so the remaining PC-off piece is X
collection and D1 import. Use `.github/workflows/xapi-daily.yml` for that. The
workflow imports data through the deployed Worker `/admin/import-local-store`
endpoint, so it does not need a long-lived Cloudflare API token.

Set these GitHub Secrets before running it:

```text
GETXAPI_KEY
WORKER_ADMIN_TOKEN
```

The workflow stores generated X working files in GitHub Actions cache/artifacts,
not in git. `automation/xapi-data/` is ignored locally.
`WORKER_ADMIN_TOKEN` must match the Cloudflare Worker `ADMIN_TOKEN` secret.

First cloud run:

1. Open GitHub Actions.
2. Run `X API daily collection` manually.
3. Set `full_backfill=true`.

After the first run, the daily schedule restores cached progress, collects new X
data, rebuilds context trees, imports to Cloudflare D1, and calls
`/telegram/auto-triage` with a 15-unit scan limit so the triage queue can stay near 10 prepared A/B contexts without hitting Worker request limits.

Set secrets in Cloudflare, not in git:

```powershell
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put INTERNALIZATION_BOT_TOKEN
npx wrangler secret put TRIAGE_CHAT_ID
npx wrangler secret put INTERNALIZATION_CHAT_ID
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY
```

Then set the Telegram webhook to the deployed Worker URL:

```powershell
Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$env:TELEGRAM_BOT_TOKEN/setWebhook" -ContentType "application/json" -Body '{"url":"https://YOUR-WORKER.workers.dev/telegram/webhook"}'
```

`TELEGRAM_BOT_TOKEN` is the 체화구분 봇. It receives prepared X API context units and asks whether each unit should be internalized. `INTERNALIZATION_BOT_TOKEN` is the 체화 봇. When the user taps `체화할래요`, the internalization card is sent through that second bot. If the second token is not set, the system falls back to the first token for test mode.

The Worker menu has no manual text input button. It handles `/start`, status, next card, pending cards/help, and triage card sending against D1. 체화구분 봇 does not call paid AI APIs.

Prepared X API context units can be imported without paid providers:

```powershell
npm.cmd run phase1 -- ingest:historical --source xapi --file C:\Users\qgev9\Downloads\context_units.json --persist
```

The importer treats the prepared `context_units.json` as the triage queue, keeps reply/thread order by timestamp, includes `quoted_tweet` text inside the card, and keeps retweet-only material out of context units.

## AI policy

AI is paid only when needed for user questions or judgement:

```env
AI_MODE=needed_only
AI_PROVIDER_PRIMARY=deepseek
AI_MODEL_PRIMARY=deepseek-v4-flash
AI_PROVIDER_JUDGE=anthropic
AI_MODEL_JUDGE=claude-sonnet-4-6
AI_JUDGE_MODE=important_only
AI_DAILY_LIMIT_KRW=3000
AI_MONTHLY_LIMIT_KRW=30000
```

DeepSeek V4 Flash is the default low-cost model for the 체화 봇. Claude Sonnet 4.6 is the first-pass scorer for 체화구분, with DeepSeek fallback if Claude fails. X API collection still runs through the configured X API workflow.

## Implemented Phase 1 gates

- RT-only posts are archived and excluded from triage.
- Gray discovery data is discovery-only.
- `canonical_status != verified` cannot enter triage or internalization.
- JIT queue selects the next pending batch only.
- Pattern tracking is advisory-only and cannot auto-skip.
- Triage output has no AI summary, recommendation, or strategic interpretation.
- Cost sentinel soft-alerts at 300,000 KRW and hard-stops at 500,000 KRW.

## Artifacts

- `db/migrations/001_phase1_schema.sql`: v3 + v3A4 Postgres-compatible schema.
- `db/d1/001_phase1_schema.sql`: Cloudflare D1 schema for PC-off operation.
- `cloudflare/telegram-worker.js`: Cloudflare Worker Telegram webhook.
- `fixtures/korean-sample-run.json`: no-cost Korean sample run for all three handles.
- `n8n/workflows/*.json`: historical setup, daily ingestion, and triage supply workflows with paid nodes disabled.
