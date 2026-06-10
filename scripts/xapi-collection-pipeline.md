# X API collection pipeline

This project treats the paid X collection scripts as an external data pipeline.
Do not commit API keys or generated paid raw data into the repository.

## Paid collection order

Run these scripts in the data working directory when new X data must be collected:

```powershell
python C:\Users\qgev9\Downloads\collect.py
python C:\Users\qgev9\Downloads\enrich.py
python C:\Users\qgev9\Downloads\fix_not_found.py
python C:\Users\qgev9\Downloads\rebuild_trees.py
```

`fix_progress.py` is a recovery tool for failed collection state. Use it only when the
collection progress file is broken or a collection run needs repair.

## Bot import order

After the paid collection scripts finish, import the completed output files into
the Phase 1 bot store:

```powershell
npm.cmd run phase1 -- ingest:historical --source xapi --file C:\Users\qgev9\Downloads\context_units.json --context-trees C:\Users\qgev9\Downloads\context_trees.json --raw-posts-enriched C:\Users\qgev9\Downloads\raw_posts_enriched.json --persist
npm.cmd run d1:export-local
npx.cmd wrangler d1 execute investment-os-v9-phase1 --remote --file .phase1\d1-import.sql
```

Current renderer behavior:

- `context_units.json` decides the queue unit and conversation grouping.
- `context_trees.json` decides recursive quote/reply tree order.
- `raw_posts_enriched.json` provides enriched third-party post details when available.
- Retweets are ignored by the context-unit importer.

