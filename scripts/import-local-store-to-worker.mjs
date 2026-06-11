import { readFileSync } from "node:fs";

const inputPath = process.argv[2] ?? "automation/xapi-data/local-store.json";
const importUrl = process.env.WORKER_IMPORT_URL ?? "https://investment-os-v9-phase1.eolala940.workers.dev/admin/import-local-store";
const adminToken = process.env.WORKER_ADMIN_TOKEN;
const chunkSize = Number(process.env.WORKER_IMPORT_CHUNK_SIZE ?? 50);

if (!adminToken) {
  throw new Error("WORKER_ADMIN_TOKEN is required");
}

function chunks(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const size = Number.isFinite(chunkSize) && chunkSize > 0 ? Math.floor(chunkSize) : 50;
  const result = [];
  for (let index = 0; index < list.length; index += size) {
    result.push(list.slice(index, index + size));
  }
  return result.length ? result : [[]];
}

async function postBatch(payload) {
  const response = await fetch(importUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-token": adminToken,
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { ok: false, error: text };
  }
  if (!response.ok || !body.ok) {
    throw new Error(`Worker import failed: ${response.status} ${text.slice(0, 500)}`);
  }
  return body.data;
}

const snapshot = JSON.parse(readFileSync(inputPath, "utf8"));
const totals = { ledger: 0, rtArchive: 0, contextUnits: 0 };

for (const ledger of chunks(snapshot.ledger)) {
  const data = await postBatch({ ledger });
  totals.ledger += data.ledger ?? 0;
}

for (const rtArchive of chunks(snapshot.rtArchive)) {
  const data = await postBatch({ rtArchive });
  totals.rtArchive += data.rtArchive ?? 0;
}

for (const contextUnits of chunks(snapshot.contextUnits)) {
  const data = await postBatch({ contextUnits });
  totals.contextUnits += data.contextUnits ?? 0;
}

console.log(`Imported into Worker D1: ledger=${totals.ledger}, rtArchive=${totals.rtArchive}, contextUnits=${totals.contextUnits}`);
