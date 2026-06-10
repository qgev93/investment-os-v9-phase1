"""
rebuild_trees.py — 수집 없이 context_trees.json만 재생성
"""

import json
import os

RAW_POSTS_FILE = "raw_posts.json"
ENRICHED_FILE = "raw_posts_enriched.json"
PROGRESS_FILE = "fix_progress.json"
TREES_FILE = "context_trees.json"


def load_json(path, default):
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return default


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def extract_linked_ids(post):
    ids = set()
    for key in ["inReplyToId", "conversationId"]:
        val = str(post.get(key, "") or "")
        if val and val != "None":
            ids.add(val)
    qt = post.get("quoted_tweet") or post.get("quotedTweet") or {}
    quote_id = str(qt.get("id", "") or "")
    if quote_id and quote_id != "None":
        ids.add(quote_id)
    return ids


def classify_post(post):
    if post.get("isRetweet"):
        return "retweet"
    if post.get("quoted_tweet") or post.get("quotedTweet"):
        return "quote"
    if post.get("inReplyToId"):
        return "reply"
    return "original"


def build_context_tree(post_id, all_posts_map, depth=0, max_depth=30, visited=None):
    if visited is None:
        visited = set()
    if depth > max_depth or post_id in visited:
        return None
    visited.add(post_id)

    post = all_posts_map.get(post_id)
    if post is None:
        return {"id": post_id, "status": "not_found", "children": []}

    node = {
        "id": post_id,
        "author": post.get("author", {}).get("userName") if isinstance(post.get("author"), dict) else post.get("authorHandle"),
        "text": (post.get("text") or post.get("full_text", ""))[:200],
        "createdAt": post.get("createdAt", ""),
        "type": classify_post(post),
        "children": []
    }
    for linked_id in extract_linked_ids(post):
        if linked_id == post_id:
            continue
        child = build_context_tree(linked_id, all_posts_map, depth + 1, max_depth, visited)
        if child:
            node["children"].append(child)
    return node


print("=== rebuild_trees.py 시작 ===")

raw_posts = load_json(RAW_POSTS_FILE, {})
enriched = load_json(ENRICHED_FILE, {})
progress = load_json(PROGRESS_FILE, {"new_fetched": {}, "still_not_found": [], "queue": [], "visited": []})

# 모든 수집된 트윗 합치기
all_known = {}
for account, posts in raw_posts.items():
    if account.startswith("_"):
        continue
    for p in posts:
        all_known[str(p.get("id"))] = p
all_known.update(enriched.get("_third_party", {}))
all_known.update(progress.get("new_fetched", {}))

print(f"총 수집된 트윗: {len(all_known)}개")

# enriched 업데이트
flat_originals = set()
for account, posts in raw_posts.items():
    if account.startswith("_"):
        continue
    for p in posts:
        flat_originals.add(str(p.get("id")))

enriched["_third_party"] = {k: v for k, v in all_known.items() if k not in flat_originals}
save_json(ENRICHED_FILE, enriched)
print(f"raw_posts_enriched.json 업데이트 완료")

# context_trees.json 재생성
print("\n=== context_trees.json 재생성 중 ===")
new_trees = {}
for account, posts in raw_posts.items():
    if account.startswith("_"):
        continue
    new_trees[account] = []
    for post in posts:
        if post.get("isRetweet"):
            continue
        tree = build_context_tree(str(post.get("id")), all_known)
        if tree:
            new_trees[account].append(tree)
    print(f"  {account}: {len(new_trees[account])}개 트리")

save_json(TREES_FILE, new_trees)
print(f"\n완료! context_trees.json 저장됨")
