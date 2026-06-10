"""
fix_not_found.py — context_trees.json의 not_found 전부 재귀 수집

핵심:
- context_trees.json에서 not_found ID 전부 추출
- 각 ID를 conversation_id로 검색 (스레드 전체 한 번에)
- 새로 수집한 트윗에서 또 inReplyToId/quotedTweetId/conversationId 추출
- 새 ID도 not_found면 큐에 추가 → 뿌리까지 재귀
- raw_posts_enriched.json에 병합 + context_trees.json 재생성
- 자동저장 + 재개 가능 + 토큰 부족 자동 중단
"""

import requests
import json
import time
import os
from concurrent.futures import ThreadPoolExecutor, as_completed

API_KEY = os.environ.get("GETXAPI_KEY")
if not API_KEY:
    raise RuntimeError("GETXAPI_KEY environment variable is required")
RAW_POSTS_FILE = "raw_posts.json"
ENRICHED_FILE = "raw_posts_enriched.json"
TREES_FILE = "context_trees.json"
PROGRESS_FILE = "fix_progress.json"
COST_PER_CALL = 0.001
WORKERS = 5
BATCH_SIZE = 20
SAVE_INTERVAL = 50

stats = {"api_calls": 0, "fetched": 0, "still_not_found": 0, "errors": 0}
stop_flag = {"value": False}


def load_json(path, default):
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return default


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def extract_not_found_ids(node, ids_set):
    if isinstance(node, dict):
        if node.get("status") == "not_found" and node.get("id"):
            ids_set.add(node["id"])
        # children 뿐 아니라 모든 값 재귀 탐색
        for val in node.values():
            extract_not_found_ids(val, ids_set)
    elif isinstance(node, list):
        for item in node:
            extract_not_found_ids(item, ids_set)


def extract_linked_ids(post):
    """포스팅에서 연결된 ID 전부 추출"""
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


def fetch_by_conv(target_id):
    """target_id를 conversation_id로 검색"""
    for attempt in range(2):
        try:
            response = requests.get(
                "https://api.getxapi.com/twitter/tweet/advanced_search",
                headers={"Authorization": "Bearer " + str(API_KEY).strip()},
                params={"q": f"conversation_id:{target_id}", "product": "Latest"},
                timeout=30
            )
            stats["api_calls"] += 1

            if response.status_code == 200:
                data = response.json()
                return target_id, data.get("tweets", [])
            elif response.status_code == 402:
                print(f"\n⚠️ 크레딧 부족 — 중단")
                stop_flag["value"] = True
                return target_id, []
            elif response.status_code == 429:
                time.sleep(10)
                continue
            else:
                stats["errors"] += 1
                return target_id, []
        except Exception as e:
            if attempt == 1:
                stats["errors"] += 1
                print(f"    [{target_id}] 오류: {e}")
            time.sleep(2 * (attempt + 1))
    return target_id, []


def fetch_batch(target_ids):
    results = {}
    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {executor.submit(fetch_by_conv, tid): tid for tid in target_ids}
        for future in as_completed(futures):
            target_id, tweets = future.result()
            results[target_id] = tweets
    return results


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


# ===== 실행 =====
print("=== fix_not_found.py 시작 ===")

# 기존 데이터 로드
raw_posts = load_json(RAW_POSTS_FILE, {})
enriched = load_json(ENRICHED_FILE, {})
trees = load_json(TREES_FILE, {})
progress = load_json(PROGRESS_FILE, {"new_fetched": {}, "still_not_found": [], "queue": [], "visited": []})

# all_known: 기존에 수집된 모든 트윗
all_known = {}
for account, posts in raw_posts.items():
    if account.startswith("_"):
        continue
    for p in posts:
        all_known[str(p.get("id"))] = p
all_known.update(enriched.get("_third_party", {}))
all_known.update(progress["new_fetched"])

print(f"기존 수집된 트윗: {len(all_known)}개")

# 큐 복원 또는 not_found 추출
still_not_found = set(progress["still_not_found"])
visited = set(progress["visited"]) | set(all_known.keys())

if progress["queue"]:
    queue = progress["queue"]
    print(f"이전 진행 이어서: 남은 큐 {len(queue)}개")
else:
    not_found_ids = set()
    extract_not_found_ids(trees, not_found_ids)
    # 이미 수집된 건 제외
    queue = [nid for nid in not_found_ids if nid not in all_known]
    visited |= set(queue)
    print(f"context_trees.json에서 not_found 추출: {len(not_found_ids)}개")
    print(f"실제 미수집: {len(queue)}개")

# BFS 재귀 수집
idx = 0
total_processed = 0

while idx < len(queue):
    if stop_flag["value"]:
        print("크레딧 부족으로 중단 — 진행상황 저장 중...")
        break

    batch = []
    while idx < len(queue) and len(batch) < BATCH_SIZE:
        tid = queue[idx]
        idx += 1
        if tid not in all_known and tid not in still_not_found:
            batch.append(tid)

    if not batch:
        continue

    print(f"  [{total_processed}/{len(queue)}] 배치 {len(batch)}개 병렬 검색 중...")
    results = fetch_batch(batch)
    new_count = 0
    found_target = 0

    for target_id, tweets in results.items():
        total_processed += 1

        if not tweets:
            still_not_found.add(target_id)
            stats["still_not_found"] += 1
            continue

        # target_id가 결과에 포함됐는지 확인
        target_found = False
        for tweet in tweets:
            tid = str(tweet.get("id", ""))
            if tid == target_id:
                target_found = True
            if tid and tid not in all_known:
                all_known[tid] = tweet
                stats["fetched"] += 1
                new_count += 1
                # 새 트윗에서 추가 누락 ID 발견
                for linked_id in extract_linked_ids(tweet):
                    if linked_id not in visited and linked_id not in all_known:
                        visited.add(linked_id)
                        queue.append(linked_id)

        if target_found:
            found_target += 1
        else:
            still_not_found.add(target_id)
            stats["still_not_found"] += 1

    print(f"    → 신규 수집: {new_count}개 / 타겟 도달: {found_target}/{len(batch)} / 큐 크기: {len(queue)}")

    if stop_flag["value"]:
        break

    if total_processed % SAVE_INTERVAL == 0:
        progress["new_fetched"] = {k: v for k, v in all_known.items() if k not in enriched.get("_third_party", {})}
        progress["still_not_found"] = list(still_not_found)
        progress["queue"] = queue[idx:]
        progress["visited"] = list(visited)
        save_json(PROGRESS_FILE, progress)
        print(f"  [자동저장]")

# 중단 시 저장 후 종료
if stop_flag["value"]:
    progress["new_fetched"] = {k: v for k, v in all_known.items() if k not in enriched.get("_third_party", {})}
    progress["still_not_found"] = list(still_not_found)
    progress["queue"] = queue[idx:]
    progress["visited"] = list(visited)
    save_json(PROGRESS_FILE, progress)
    print(f"\n저장 완료 — 충전 후 python fix_not_found.py 로 이어서 진행 가능")
    exit()

# enriched 업데이트
flat_originals = set()
for account, posts in raw_posts.items():
    if account.startswith("_"):
        continue
    for p in posts:
        flat_originals.add(str(p.get("id")))

enriched["_third_party"] = {k: v for k, v in all_known.items() if k not in flat_originals}
save_json(ENRICHED_FILE, enriched)

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
save_json(PROGRESS_FILE, {"new_fetched": {}, "still_not_found": [], "queue": [], "visited": []})

print("\n=== 완료 ===")
print(f"  신규 수집: {stats['fetched']}개")
print(f"  여전히 not_found (삭제/비공개): {stats['still_not_found']}개")
print(f"  에러: {stats['errors']}개")
print(f"  API 호출: {stats['api_calls']}회")
print(f"  예상 비용: ${stats['api_calls'] * COST_PER_CALL:.3f}")
