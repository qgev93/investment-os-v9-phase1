import { readFileSync } from "node:fs";
import type { TrustLayer } from "../domain/index.js";

export const ELITE3_HANDLES = new Set(["@min_anko38", "@LNCV34", "@Alisvolatprop12"]);

export interface ManualImportPost {
  post_id: string;
  expert_handle: string;
  text: string;
  created_at: string;
  trust_layer: TrustLayer;
  is_rt_only: boolean;
  retweeted_post_id?: string;
  structural_basis: string[];
}

const TRUST_LAYERS = new Set(["canonical", "gray", "pending", "quarantined"]);

function assertObject(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Manual import file must contain an array of post objects");
  }
}

function stringField(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Manual import post is missing ${field}`);
  }
  return value.trim();
}

function optionalStringField(row: Record<string, unknown>, field: string): string | undefined {
  const value = row[field];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new Error(`Manual import ${field} must be a string`);
  }
  return value.trim();
}

function normalizeStructuralBasis(value: unknown): string[] {
  if (value === undefined) return ["original_post"];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error("Manual import structural_basis must be a string array");
  }
  return value;
}

function normalizeTrustLayer(value: unknown): TrustLayer {
  const trustLayer = typeof value === "string" ? value : "pending";
  if (!TRUST_LAYERS.has(trustLayer)) {
    throw new Error(`Manual import trust_layer is invalid: ${trustLayer}`);
  }
  return trustLayer as TrustLayer;
}

export function parseManualImportFile(filePath: string): ManualImportPost[] {
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (!Array.isArray(raw)) {
    throw new Error("Manual import file must contain an array of post objects");
  }

  return raw.map((value) => {
    assertObject(value);
    const expertHandle = stringField(value, "expert_handle");
    if (!ELITE3_HANDLES.has(expertHandle)) {
      throw new Error(`Manual import contains non-Elite handle: ${expertHandle}`);
    }

    return {
      post_id: stringField(value, "post_id"),
      expert_handle: expertHandle,
      text: typeof value.text === "string" ? value.text : "",
      created_at: stringField(value, "created_at"),
      trust_layer: normalizeTrustLayer(value.trust_layer),
      is_rt_only: value.is_rt_only === true,
      retweeted_post_id: optionalStringField(value, "retweeted_post_id"),
      structural_basis: normalizeStructuralBasis(value.structural_basis),
    };
  });
}
