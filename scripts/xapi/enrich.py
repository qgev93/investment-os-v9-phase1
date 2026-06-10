"""
enrich.py v4 — advanced_search 기반 (검증된 엔드포인트만 사용)

핵심:
- 단일 트윗 조회 대신 conversation_id 검색으로 스레드 전체 수집
- 한 번에 ~20개 트윗 받으니 효율적
- 병렬 처리 + 자동 저장 + 재개 기능
- 상세 에러 로깅으로 문제 즉시 파악
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
PROGRESS_FILE = "enrich_progress.json"
OUTPUT_TREE_FILE = "context_trees.json"
COST_PER_CALL = 0.001
WORKERS = 5
BATCH_SIZE = 20
SAVE_INTERVAL = 50
DEBUG_FIRST_N = 3  # 처음 N개 요청의 응답 출력 (디버깅용)

stats = {"api_calls": 0, "fetched": 0, "not_found": 0, "errors": 0, "debug_count": 0}
stop_flag = {"value": False}  # 크레딧 부족 시 중단 플래그


def load_json(path, default):
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return default


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def get_all_posts_flat(raw_posts):
    flat = {}
    for account, posts in raw_posts.items():
        if account.startswith("_"):
            continue
        for p in posts:
            flat[str(p.get("id"))] = p
    return flat


def fetch_conversation(conv_id):
    """conversation_id로 스레드 전체 검색"""
    for attempt in range(2):
        try:
            response = requests.get(
                "https://api.getxapi.com/twitter/tweet/advanced_search",
                headers={"Authorization": "Bearer " + str(API_KEY).strip()},
                params={"q": f"conversation_id:{conv_id}", "product": "Latest"},
                timeout=30
            )
            stats["api_calls"] += 1

            # 디버그: 처음 N개 응답 출력
            if stats["debug_count"] < DEBUG_FIRST_N:
                stats["debug_count"] += 1
                print(f"    [DEBUG] HTTP {response.status_code}, 응답앞부분: {response.text[:300]}")

            if response.status_code == 200:
                data = response.json()
                tweets = data.get("tweets", [])
                return conv_id, tweets
            elif response.status_code == 402:
                print(f"\n⚠️  크레딧 부족 — 수집 중단 (충전 후 python enrich.py 로 이어서 가능)")
                stop_flag["value"] = True
                return conv_id, []
            elif response.status_code == 429:
                print(f"    Rate limit — 10초 대기")
                time.sleep(10)
                continue
            else:
                stats["errors"] += 1
                if stats["errors"] <= 5:
                    print(f"    [{conv_id}] HTTP {response.status_code}: {response.text[:200]}")
                return conv_id, []
        except Exception as e:
            print(f"    [{conv_id}] 재시도 {attempt+1}/2: {e}")
            time.sleep(2 * (attempt + 1))
    return conv_id, []


def fetch_batch(conv_ids):
    """병렬 배치 수집"""
    results = {}
    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {executor.submit(fetch_conversation, cid): cid for cid in conv_ids}
        for future in as_completed(futures):
            conv_id, tweets = future.result()
            results[conv_id] = tweets
    return results


def extract_linked_ids(post):
    """포스팅에서 연결된 ID 추출 (inReply, quoted, conversation)"""
    ids = set()
    for key in ["inReplyToId", "conversationId"]:
        val = str(post.get(key, "") or "")
        if val and val != "None":
            ids.add(val)
    qt = post.get("quoted_tweet") or post.get("quotedTweet") or {}
    quote_id = str(qt.get("id", "") or "")
    if quote_id and quote_id != "None":
        ids.add(quote_id)
    return list(ids)


def classify_post(post):
    if post.get("isRetweet"):
        return "retweet"
    if post.get("quoted_tweet") or post.get("quotedTweet"):
        return "quote"
    if post.get("inReplyToId"):
        return "reply"
    return "original"


def build_context_tree(post_id, all_posts_map, depth=0, max_depth=20, visited=None):
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
print("=== enrich.py v4 (conversation_id 검색 방식) 시작 ===")

raw_posts = load_json(RAW_POSTS_FILE, {})
progress = load_json(PROGRESS_FILE, {"fetched": {}, "processed_convs": [], "queue": []})

flat_posts = get_all_posts_flat(raw_posts)

# 이전 완료분 복원 (raw_posts_enriched.json의 _third_party)
all_known = progress["fetched"]
if os.path.exists(ENRICHED_FILE):
    enriched_data = load_json(ENRICHED_FILE, {})
    prev_third_party = enriched_data.get("_third_party", {})
    all_known = {**prev_third_party, **all_known}  # progress가 우선
    print(f"이전 완료분 복원: {len(prev_third_party)}개")

processed_convs = set(progress["processed_convs"])

print(f"기존 고수 포스팅: {len(flat_posts)}개")
print(f"이전 수집 제3자: {len(all_known)}개")

# 큐 복원 또는 새로 구성: 누락된 conversation_id 추출
if progress["queue"]:
    queue = progress["queue"]
    print(f"이전 진행 이어서: 남은 큐 {len(queue)}개")
else:
    conv_ids = set()
    for pid, post in {**flat_posts, **all_known}.items():
        if post is None:
            continue
        cid = str(post.get("conversationId", "") or "")
        if cid and cid != "None" and cid not in processed_convs:
            conv_ids.add(cid)
    queue = list(conv_ids)
    print(f"누락 conversation 큐: {len(queue)}개")

# 배치 BFS 처리
idx = 0
total_processed = 0

while idx < len(queue):
    if stop_flag["value"]:
        print("크레딧 부족으로 중단 — 진행상황 저장 중...")
        break

    batch = []
    while idx < len(queue) and len(batch) < BATCH_SIZE:
        cid = queue[idx]
        idx += 1
        if cid not in processed_convs:
            batch.append(cid)

    if not batch:
        continue

    print(f"  [{total_processed}/{len(queue)}] 배치 {len(batch)}개 병렬 검색 중...")
    results = fetch_batch(batch)
    new_convs = []

    for conv_id, tweets in results.items():
        total_processed += 1
        processed_convs.add(conv_id)

        if not tweets:
            stats["not_found"] += 1
            continue

        for tweet in tweets:
            tid = str(tweet.get("id", ""))
            if tid and tid not in all_known and tid not in flat_posts:
                all_known[tid] = tweet
                stats["fetched"] += 1
                # 새 트윗에서 추가 conversation_id 발견
                new_cid = str(tweet.get("conversationId", "") or "")
                if new_cid and new_cid != "None" and new_cid not in processed_convs:
                    queue.append(new_cid)
                    new_convs.append(new_cid)

    if new_convs:
        print(f"    → 추가 발견: {len(set(new_convs))}개 conv")
    print(f"    → 누적 수집: {stats['fetched']}개 트윗 / 처리한 conv: {total_processed}")

    if stop_flag["value"]:
        break

    if total_processed % SAVE_INTERVAL == 0:
        progress["fetched"] = all_known
        progress["processed_convs"] = list(processed_convs)
        progress["queue"] = queue[idx:]
        save_json(PROGRESS_FILE, progress)
        print(f"  [자동저장]")

# 크레딧 부족으로 중단됐으면 진행상황 저장 후 종료
if stop_flag["value"]:
    progress["fetched"] = all_known
    progress["processed_convs"] = list(processed_convs)
    progress["queue"] = queue[idx:]
    save_json(PROGRESS_FILE, progress)
    print(f"  저장 완료 — 충전 후 python enrich.py 로 이어서 진행 가능")
    exit()

# 최종 저장
enriched = dict(raw_posts)
enriched["_third_party"] = all_known
save_json(ENRICHED_FILE, enriched)

# 맥락 트리
print("\n=== 맥락 트리 구성 중 ===")
all_posts_map = {**flat_posts, **all_known}
trees = {}
for account, posts in raw_posts.items():
    if account.startswith("_"):
        continue
    trees[account] = []
    for post in posts:
        if post.get("isRetweet"):
            continue
        tree = build_context_tree(str(post.get("id")), all_posts_map)
        if tree:
            trees[account].append(tree)
    print(f"  {account}: {len(trees[account])}개 트리")

save_json(OUTPUT_TREE_FILE, trees)
save_json(PROGRESS_FILE, {"fetched": {}, "processed_convs": [], "queue": []})

print("\n=== 완료 ===")
print(f"  새 트윗 수집: {stats['fetched']}개")
print(f"  빈 응답 conv: {stats['not_found']}개")
print(f"  에러: {stats['errors']}개")
print(f"  API 호출: {stats['api_calls']}회")
print(f"  예상 비용: ${stats['api_calls'] * COST_PER_CALL:.3f}")
