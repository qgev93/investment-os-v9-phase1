# X API cloud collection

This folder contains the GitHub Actions-safe copy of the X collection scripts.

## Secrets

Set these in GitHub Secrets before running `.github/workflows/xapi-daily.yml`:

- `GETXAPI_KEY`: GetXAPI bearer token.
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
node scripts/import-local-store-to-worker.mjs automation/xapi-data/local-store.json
```

The import script posts chunks to the deployed Worker `/admin/import-local-store`
endpoint, so the workflow does not need a Cloudflare API token. Then it calls
`/telegram/auto-triage` with a 15-unit scan limit so the triage bot can keep
about 10 A/B contexts prepared without hitting Worker request limits.
