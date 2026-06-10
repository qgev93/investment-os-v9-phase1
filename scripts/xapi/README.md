# X API cloud collection

This folder contains the GitHub Actions-safe copy of the X collection scripts.

## Secrets

Set these in GitHub Secrets before running `.github/workflows/xapi-daily.yml`:

- `GETXAPI_KEY`: GetXAPI bearer token.
- `CLOUDFLARE_API_TOKEN`: Cloudflare API token with Worker/D1 edit access.
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account id.
- `WORKER_ADMIN_TOKEN`: token sent to the Worker `x-admin-token` header.

Do not commit API keys or generated paid raw data.
`WORKER_ADMIN_TOKEN` must match the Cloudflare Worker `ADMIN_TOKEN` secret.

## First run

The scheduled workflow will not start a full historical backfill by itself.
For the first cloud run, open GitHub Actions, run `X API daily collection`
manually, and set `full_backfill=true`.

After that, GitHub Actions restores `automation/xapi-data` from cache and
continues from the saved progress files.

## Pipeline

The workflow runs:

```bash
python collect.py
python enrich.py
python fix_not_found.py
python rebuild_trees.py
npm run phase1 -- ingest:historical --source xapi --file automation/xapi-data/context_units.json --context-trees automation/xapi-data/context_trees.json --raw-posts-enriched automation/xapi-data/raw_posts_enriched.json --persist
node scripts/export-local-store-to-d1-sql.mjs automation/xapi-data/local-store.json automation/xapi-data/d1-import.sql
npx wrangler d1 execute investment-os-v9-phase1 --remote --file automation/xapi-data/d1-import.sql
```

Then it calls the deployed Worker `/telegram/auto-triage` endpoint with a
10-unit scan limit so the triage bot can prepare the next review card.
