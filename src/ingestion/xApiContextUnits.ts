import { readFileSync } from "node:fs";
import type { ContextUnitRecord, LedgerPostInput, Phase1Store } from "../db/index.js";

export interface XApiPost {
  id: string;
  url?: string;
  twitterUrl?: string;
  text?: string;
  createdAt?: string;
  conversationId?: string;
  isReply?: boolean;
  inReplyToId?: string | null;
  inReplyToUserId?: string | null;
  author?: { id?: string; userName?: string; name?: string };
  quoted_tweet?: {
    id?: string;
    text?: string;
    author?: { userName?: string };
    user?: { screen_name?: string; name?: string };
  } | null;
  retweeted_tweet?: unknown;
}

export interface XApiContextUnit {
  unit_id: string;
  expert_handle: string;
  structural_basis?: string[];
  completed_at?: string;
  started_at?: string;
  source_stimulus?: {
    status?: string;
    source_post_id?: string | null;
    source_author?: string | null;
    source_text?: string | null;
    availability_reason?: string | null;
  };
  posts?: XApiPost[];
}

export interface XApiContextTree {
  id: string;
  author?: string;
  text?: string;
  createdAt?: string;
  type?: string;
  status?: string;
  children?: XApiContextTree[];
}

export interface XApiContextImportOptions {
  contextTreesPath?: string;
  enrichedPostsPath?: string;
}

type XApiContextUnitFile = Record<string, XApiContextUnit[]>;
type XApiContextTreeFile = Record<string, XApiContextTree[]>;
type XApiPostFile = Record<string, XApiPost[]> | XApiPost[];

interface RenderResources {
  treesById: Map<string, XApiContextTree>;
  postsById: Map<string, XApiPost>;
  quotedFallbacksById: Map<string, XApiPost>;
}

function normalizeHandle(handle: string): string {
  return handle.startsWith("@") ? handle : `@${handle}`;
}

function bareHandle(handle?: string | null): string | null {
  if (!handle) return null;
  return handle.startsWith("@") ? handle.slice(1).toLowerCase() : handle.toLowerCase();
}

function normalizeDate(value?: string): string {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function displayDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.toISOString().slice(0, 16).replace("T", " ")} KST`;
}

function xPostUrl(post: Pick<XApiPost, "id" | "url" | "twitterUrl" | "author">): string | null {
  if (post.url) return post.url;
  if (post.twitterUrl) return post.twitterUrl;
  const handle = bareHandle(post.author?.userName);
  return handle && post.id ? `https://x.com/${handle}/status/${post.id}` : null;
}

function postTime(post: XApiPost): number {
  const value = post.createdAt ? new Date(post.createdAt).getTime() : 0;
  return Number.isFinite(value) ? value : 0;
}

function quotedAuthor(post: XApiPost, enriched?: XApiPost): string {
  const handle = enriched?.author?.userName ?? post.quoted_tweet?.author?.userName ?? post.quoted_tweet?.user?.screen_name;
  if (handle) return normalizeHandle(handle);
  return enriched?.author?.name ?? post.quoted_tweet?.user?.name ?? "알 수 없음";
}

function sameAuthor(a?: XApiPost["author"], b?: XApiPost["author"]): boolean {
  if (a?.id && b?.id) return a.id === b.id;
  if (a?.userName && b?.userName) return bareHandle(a.userName) === bareHandle(b.userName);
  return false;
}

function flattenPostFile(path?: string): XApiPost[] {
  if (!path) return [];
  const data = JSON.parse(readFileSync(path, "utf8")) as XApiPostFile;
  return Array.isArray(data) ? data : Object.values(data).flat();
}

function flattenTreeFile(path?: string): XApiContextTree[] {
  if (!path) return [];
  const data = JSON.parse(readFileSync(path, "utf8")) as XApiContextTreeFile;
  return Object.values(data).flat();
}

function indexTree(tree: XApiContextTree, output: Map<string, XApiContextTree>): void {
  output.set(tree.id, tree);
  for (const child of tree.children ?? []) indexTree(child, output);
}

function buildResources(options: XApiContextImportOptions = {}): RenderResources {
  const treesById = new Map<string, XApiContextTree>();
  for (const tree of flattenTreeFile(options.contextTreesPath)) indexTree(tree, treesById);
  const postsById = new Map(flattenPostFile(options.enrichedPostsPath).map((post) => [post.id, post]));
  return { treesById, postsById, quotedFallbacksById: new Map() };
}

function addUnitPosts(resources: RenderResources, units: XApiContextUnit[]): void {
  for (const unit of units) {
    for (const post of unit.posts ?? []) {
      if (!resources.postsById.has(post.id)) resources.postsById.set(post.id, post);
      const quoted = post.quoted_tweet;
      if (quoted?.id && quoted.text && !resources.quotedFallbacksById.has(quoted.id)) {
        resources.quotedFallbacksById.set(quoted.id, {
          id: quoted.id,
          text: quoted.text,
          author: {
            userName: quoted.author?.userName ?? quoted.user?.screen_name,
            name: quoted.user?.name,
          },
        });
      }
    }
  }
}

function ancestorChain(tree?: XApiContextTree): XApiContextTree[] {
  if (!tree?.children?.length) return [];
  const chain: XApiContextTree[] = [];
  for (const child of tree.children) chain.push(...ancestorChain(child), child);
  return chain;
}

function replyTargetTree(post: XApiPost, tree?: XApiContextTree): XApiContextTree | null {
  if (!post.isReply || !post.inReplyToId || !tree?.children?.length) return null;
  return tree.children.find((child) => child.id === post.inReplyToId) ?? null;
}

function isThirdPartyTreeReply(post: XApiPost, target?: XApiContextTree | null): boolean {
  if (!post.isReply || !post.inReplyToId || !target) return false;
  return bareHandle(target.author) !== bareHandle(post.author?.userName);
}

function isThirdPartyReply(post: XApiPost, inUnitTarget?: XApiPost | null, source?: XApiContextUnit["source_stimulus"]): boolean {
  if (!post.isReply || !post.inReplyToId) return false;
  if (inUnitTarget) return !sameAuthor(post.author, inUnitTarget.author);
  if (post.author?.id && post.inReplyToUserId) return post.author.id !== post.inReplyToUserId;
  return Boolean(source?.source_text);
}

function renderMeta(author: string | undefined, createdAt: string | undefined): string {
  return [author ? normalizeHandle(author) : undefined, displayDate(createdAt)]
    .filter(Boolean)
    .join(" · ");
}

function renderBlock(author: string | undefined, createdAt: string | undefined, text: string | undefined, link?: string | null): string | null {
  const body = text?.trim();
  if (!body) return null;
  const meta = renderMeta(author, createdAt);
  const linkLine = link ? `X 링크: ${link}` : null;
  return [meta, body, linkLine].filter(Boolean).join("\n");
}

function renderQuotedPosts(post: XApiPost, resources: RenderResources, depth = 0, seen = new Set<string>()): string[] {
  if (!post.quoted_tweet?.text && !post.quoted_tweet?.id) return [];
  const enriched = post.quoted_tweet.id
    ? resources.postsById.get(post.quoted_tweet.id) ?? resources.quotedFallbacksById.get(post.quoted_tweet.id)
    : undefined;
  const quotedId = post.quoted_tweet.id;
  const nested = quotedId && enriched && !seen.has(quotedId)
    ? renderQuotedPosts(enriched, resources, depth + 1, new Set([...seen, quotedId]))
    : [];
  const text = enriched?.text ?? post.quoted_tweet.text;
  const author = quotedAuthor(post, enriched);
  const current = renderBlock(author, enriched?.createdAt, text, nested.length === 0 && enriched ? xPostUrl(enriched) : null);
  return [...nested, ...(current ? [current] : [])];
}

function treeNodePost(node: XApiContextTree, resources: RenderResources): XApiPost | null {
  const enriched = resources.postsById.get(node.id) ?? resources.quotedFallbacksById.get(node.id);
  if (enriched) return enriched;
  if (!node.text) return null;
  return {
    id: node.id,
    text: node.text,
    createdAt: node.createdAt,
    author: { userName: node.author },
  };
}

function renderTreeQuoteNode(node: XApiContextTree, resources: RenderResources, seen: Set<string>): string[] {
  if (seen.has(node.id)) return [];
  const nextSeen = new Set([...seen, node.id]);
  const quoteChildren = (node.children ?? []).filter((child) => child.type !== "reply");
  const nested = quoteChildren.flatMap((child) => renderTreeQuoteNode(child, resources, nextSeen));
  const post = treeNodePost(node, resources);
  const current = post ? renderBlock(post.author?.userName, post.createdAt, post.text, nested.length === 0 ? xPostUrl(post) : null) : null;
  return [...nested, ...(current ? [current] : [])];
}

function renderTreeQuotedPosts(post: XApiPost, resources: RenderResources): string[] {
  if (!post.quoted_tweet?.id) return [];
  const tree = resources.treesById.get(post.id);
  if (!tree?.children?.length) return [];
  const directQuote = tree.children.find((child) => child.id === post.quoted_tweet?.id);
  const quoteChildren = directQuote ? [directQuote] : tree.children.filter((child) => child.type === "quote");
  return quoteChildren.flatMap((child) => renderTreeQuoteNode(child, resources, new Set([post.id])));
}

function renderReplyContext(
  post: XApiPost,
  postsById: Map<string, XApiPost>,
  postNumbers: Map<string, number>,
  source: XApiContextUnit["source_stimulus"] | undefined,
  resources: RenderResources,
): string | null {
  if (!post.isReply || !post.inReplyToId) return null;
  if (post.quoted_tweet?.text && source?.source_text?.trim() === post.quoted_tweet.text.trim()) return null;
  const inUnitTarget = postsById.get(post.inReplyToId);
  const tree = resources.treesById.get(post.id);
  const treeTarget = replyTargetTree(post, tree);

  if (treeTarget && isThirdPartyTreeReply(post, treeTarget)) {
    return renderBlock(treeTarget.author, treeTarget.createdAt, treeTarget.text);
  }

  if (!isThirdPartyReply(post, inUnitTarget, source)) return null;

  if (inUnitTarget) {
    const targetNumber = postNumbers.get(post.inReplyToId);
    const rendered = renderBlock(inUnitTarget.author?.userName, inUnitTarget.createdAt, inUnitTarget.text);
    return targetNumber && rendered ? `[${targetNumber}]\n${rendered}` : rendered;
  }

  const enriched = resources.postsById.get(post.inReplyToId);
  if (enriched) return renderBlock(enriched.author?.userName, enriched.createdAt, enriched.text);

  if (source?.source_text) return renderBlock(source.source_author ?? undefined, undefined, source.source_text);

  const reason = source?.availability_reason ? ` (${source.availability_reason})` : "";
  return `답글 단 댓글: 원문 미수집 - ${post.inReplyToId}${reason}`;
}

function renderPost(
  post: XApiPost,
  index: number,
  postsById: Map<string, XApiPost>,
  postNumbers: Map<string, number>,
  source: XApiContextUnit["source_stimulus"] | undefined,
  resources: RenderResources,
): string {
  const treeQuotes = renderTreeQuotedPosts(post, resources);
  const quoteBlocks = treeQuotes.length ? treeQuotes : renderQuotedPosts(post, resources);
  const replyContext = renderReplyContext(post, postsById, postNumbers, source, resources);
  const meta = renderMeta(post.author?.userName, post.createdAt);
  const link = index === 0 && quoteBlocks.length === 0 ? xPostUrl(post) : null;
  const current = [`[${index + 1}]`, meta, post.text?.trim() ?? "", link ? `X 링크: ${link}` : null].filter(Boolean).join("\n");
  return [
    quoteBlocks.length ? quoteBlocks.join("\n\n↓\n\n") : null,
    replyContext,
    current,
  ].filter(Boolean).join("\n\n---\n\n");
}

function toContextUnit(unit: XApiContextUnit, resources: RenderResources): ContextUnitRecord | null {
  const posts = [...(unit.posts ?? [])].sort((a, b) => postTime(a) - postTime(b));
  if (posts.length === 0) return null;
  if (posts.every((post) => post.retweeted_tweet && !post.text?.trim())) return null;
  const postsById = new Map(posts.map((post) => [post.id, post]));
  const postNumbers = new Map(posts.map((post, index) => [post.id, index + 1]));
  const sourceForReplies = posts.some((post) => post.quoted_tweet?.text?.trim() === unit.source_stimulus?.source_text?.trim())
    ? undefined
    : unit.source_stimulus;

  return {
    unitId: unit.unit_id,
    expertHandle: normalizeHandle(unit.expert_handle),
    originalText: posts.map((post, index) => renderPost(post, index, postsById, postNumbers, sourceForReplies, resources)).join("\n\n---\n\n"),
    completedAt: normalizeDate(unit.completed_at ?? posts.at(-1)?.createdAt ?? unit.started_at),
    canonicalStatus: "verified",
    rtOnlyExcluded: false,
    structuralBasis: unit.structural_basis ?? ["x_api_context_unit"],
  };
}

function toLedgerPost(unit: XApiContextUnit, post: XApiPost): LedgerPostInput {
  return {
    postId: post.id,
    expertHandle: normalizeHandle(unit.expert_handle),
    trustLayer: "canonical",
    fetchedVia: "twscrape",
    isRtOnly: Boolean(post.retweeted_tweet && !post.text?.trim()),
    costUsd: 0,
    conversationId: post.conversationId,
    referencedType: post.quoted_tweet ? "quoted" : post.isReply ? "reply" : undefined,
    residualTextLen: post.text?.length ?? 0,
  };
}

export function parseXApiContextUnitFile(path: string): XApiContextUnit[] {
  const data = JSON.parse(readFileSync(path, "utf8")) as XApiContextUnitFile;
  return Object.values(data).flat();
}

export async function ingestXApiContextUnitsIntoStore(store: Phase1Store, path: string, options: XApiContextImportOptions = {}) {
  const units = parseXApiContextUnitFile(path);
  const resources = buildResources(options);
  addUnitPosts(resources, units);
  let ledgerRowsSeen = 0;
  let rtOnlyArchived = 0;
  let contextUnitsSeen = 0;

  for (const unit of units) {
    for (const post of unit.posts ?? []) {
      const ledgerPost = toLedgerPost(unit, post);
      await store.upsertLedgerPost(ledgerPost);
      ledgerRowsSeen += 1;
      if (ledgerPost.isRtOnly) {
        await store.archiveRtOnly({
          postId: post.id,
          expertHandle: normalizeHandle(unit.expert_handle),
          selfRt: false,
          notes: "retweet-only excluded during x_api import",
        });
        rtOnlyArchived += 1;
      }
    }

    const contextUnit = toContextUnit(unit, resources);
    if (contextUnit) {
      await store.upsertContextUnit(contextUnit);
      contextUnitsSeen += 1;
    }
  }

  return {
    source: "xapi",
    postsFetched: ledgerRowsSeen,
    ledgerRows: await store.countLedgerPosts(),
    rtOnlyArchived,
    contextUnits: contextUnitsSeen,
    paidCalls: 0,
  };
}
