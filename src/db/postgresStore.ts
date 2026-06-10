import type {
  ContextUnitRecord,
  ChairmanAttemptRecord,
  LedgerPostInput,
  Phase1Store,
  RtArchiveInput,
} from "./types.js";
import type { TriageDecision } from "../domain/index.js";

type PgClient = {
  query<T = unknown>(sql: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
};

export class PostgresPhase1Store implements Phase1Store {
  readonly kind = "postgres";

  constructor(private readonly client: PgClient) {}

  async upsertLedgerPost(input: LedgerPostInput): Promise<void> {
    await this.client.query(
      `INSERT INTO x_resource_ledger (
        post_id, author_id, fetched_via, trust_layer, cost_usd, referenced_type,
        is_rt_only, residual_text_len, archived
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (post_id) DO UPDATE SET
        fetched_via = EXCLUDED.fetched_via,
        trust_layer = EXCLUDED.trust_layer,
        cost_usd = EXCLUDED.cost_usd,
        is_rt_only = EXCLUDED.is_rt_only,
        residual_text_len = EXCLUDED.residual_text_len,
        archived = EXCLUDED.archived`,
      [
        input.postId,
        input.expertHandle,
        input.fetchedVia,
        input.trustLayer,
        input.costUsd,
        input.referencedType ?? null,
        input.isRtOnly,
        input.residualTextLen ?? 0,
        input.isRtOnly,
      ],
    );
  }

  async archiveRtOnly(input: RtArchiveInput): Promise<void> {
    await this.client.query(
      `INSERT INTO rt_only_archive (post_id, expert_handle, retweeted_post_id, self_rt, notes)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        input.postId,
        input.expertHandle,
        input.retweetedPostId ?? null,
        input.selfRt,
        input.notes ?? "RT-only archived; excluded from triage",
      ],
    );
  }

  async upsertContextUnit(input: ContextUnitRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO context_units (
        unit_id, expert_handle, structural_basis, started_at, completed_at,
        completion_status, included_post_ids, source_stimulus, elite_posts,
        canonical_status, rt_only_excluded
      ) VALUES ($1,$2,$3,$4,$5,'completed',$6,$7,$8,$9,$10)
      ON CONFLICT (unit_id) DO UPDATE SET
        completed_at = EXCLUDED.completed_at,
        canonical_status = EXCLUDED.canonical_status,
        rt_only_excluded = EXCLUDED.rt_only_excluded,
        updated_at = now()`,
      [
        input.unitId,
        input.expertHandle,
        input.structuralBasis,
        input.completedAt,
        input.completedAt,
        [input.unitId],
        JSON.stringify({ status: "absent" }),
        JSON.stringify([{ post_id: input.unitId, text: input.originalText }]),
        input.canonicalStatus,
        input.rtOnlyExcluded,
      ],
    );
  }

  async countLedgerPosts(): Promise<number> {
    const result = await this.client.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM x_resource_ledger");
    return Number(result.rows[0]?.count ?? 0);
  }

  async countRtOnlyArchive(): Promise<number> {
    const result = await this.client.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM rt_only_archive");
    return Number(result.rows[0]?.count ?? 0);
  }

  async listContextUnits(): Promise<ContextUnitRecord[]> {
    const result = await this.client.query<{
      unit_id: string;
      expert_handle: string;
      elite_posts: Array<{ text?: string }> | string;
      completed_at: string;
      canonical_status: ContextUnitRecord["canonicalStatus"];
      rt_only_excluded: boolean;
      structural_basis: string[];
      triage_decision: TriageDecision | null;
      triage_sent_at: string | null;
      triage_message_id: string | number | null;
      internalization_state: ContextUnitRecord["internalizationState"] | null;
    }>(
      `SELECT unit_id, expert_handle, elite_posts, completed_at::text, canonical_status,
        rt_only_excluded, structural_basis, chairman_triage->>'decision' AS triage_decision,
        chairman_triage->>'triage_sent_at' AS triage_sent_at,
        chairman_triage->>'triage_message_id' AS triage_message_id,
        chairman_triage->>'internalization_state' AS internalization_state
       FROM context_units
       ORDER BY completed_at ASC`,
    );

    return result.rows.map((row) => {
      const elitePosts =
        typeof row.elite_posts === "string"
          ? (JSON.parse(row.elite_posts) as Array<{ text?: string }>)
          : row.elite_posts;
      return {
        unitId: row.unit_id,
        expertHandle: row.expert_handle,
        originalText: elitePosts[0]?.text ?? "",
        completedAt: row.completed_at,
        canonicalStatus: row.canonical_status,
        rtOnlyExcluded: row.rt_only_excluded,
        structuralBasis: row.structural_basis,
        triageDecision: row.triage_decision ?? undefined,
        triageSentAt: row.triage_sent_at ?? undefined,
        triageMessageId:
          row.triage_message_id === null || row.triage_message_id === undefined
            ? undefined
            : Number(row.triage_message_id),
        internalizationState: row.internalization_state ?? undefined,
      };
    });
  }

  async getContextUnit(unitId: string): Promise<ContextUnitRecord | null> {
    return (await this.listContextUnits()).find((unit) => unit.unitId === unitId) ?? null;
  }

  async setTriageDecision(unitId: string, decision: TriageDecision): Promise<void> {
    await this.client.query(
      `UPDATE context_units
       SET chairman_triage = jsonb_set(
         COALESCE(chairman_triage, '{}'::jsonb),
         '{decision}',
         to_jsonb($2::text),
         true
       ),
       updated_at = now()
       WHERE unit_id = $1`,
      [unitId, decision],
    );
  }

  async markTriageSent(unitId: string, sentAt: string, messageId: number): Promise<void> {
    await this.client.query(
      `UPDATE context_units
       SET chairman_triage = COALESCE(chairman_triage, '{}'::jsonb) ||
         jsonb_build_object('triage_sent_at', $2::text, 'triage_message_id', $3::int),
       updated_at = now()
       WHERE unit_id = $1`,
      [unitId, sentAt, messageId],
    );
  }

  async setInternalizationState(
    unitId: string,
    state: NonNullable<ContextUnitRecord["internalizationState"]>,
  ): Promise<void> {
    await this.client.query(
      `UPDATE context_units
       SET chairman_triage = jsonb_set(
         COALESCE(chairman_triage, '{}'::jsonb),
         '{internalization_state}',
         to_jsonb($2::text),
         true
       ),
       updated_at = now()
       WHERE unit_id = $1`,
      [unitId, state],
    );
  }

  async findActiveInternalizationUnit(): Promise<ContextUnitRecord | null> {
    return (
      (await this.listContextUnits())
        .filter(
          (unit) =>
            unit.triageDecision === "\uCCB4\uD654" &&
            unit.canonicalStatus === "verified" &&
            !unit.rtOnlyExcluded &&
            unit.internalizationState !== "completed",
        )
        .at(-1) ?? null
    );
  }

  async addChairmanAttempt(input: ChairmanAttemptRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO internalization_sessions (
        session_id, unit_id, chairman_id, chairman_attempts, mastery_state
      ) VALUES ($1,$2,'telegram',$3,'in_progress')
      ON CONFLICT (session_id) DO UPDATE SET
        chairman_attempts = internalization_sessions.chairman_attempts || EXCLUDED.chairman_attempts`,
      [
        `telegram-${input.unitId}`,
        input.unitId,
        JSON.stringify([{ text: input.attemptText, attempted_at: input.attemptedAt }]),
      ],
    );
  }

  async listChairmanAttempts(_unitId: string): Promise<ChairmanAttemptRecord[]> {
    return [];
  }

  async enqueueJitUnits(limit: number): Promise<ContextUnitRecord[]> {
    const candidates = (await this.listContextUnits())
      .filter((unit) => unit.canonicalStatus === "pending")
      .filter((unit) => !unit.rtOnlyExcluded)
      .slice(0, limit);

    for (const unit of candidates) {
      await this.client.query(
        `INSERT INTO jit_verification_queue (unit_id, provider)
         VALUES ($1,'manual')
         ON CONFLICT (unit_id) DO NOTHING`,
        [unit.unitId],
      );
    }

    return candidates;
  }

  async nextTriageUnit(): Promise<ContextUnitRecord | null> {
    return (
      (await this.listContextUnits()).find(
        (unit) =>
          unit.canonicalStatus === "verified" &&
          !unit.rtOnlyExcluded &&
          unit.triageDecision === undefined &&
          unit.triageSentAt === undefined,
      ) ?? null
    );
  }
}
