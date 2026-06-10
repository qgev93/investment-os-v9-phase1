"""
X 포스팅 수집기 — 완전판
- 자동 재시도 (네트워크/타임아웃 대응)
- 구간별 중간 저장 (죽어도 이어서 가능)
- 재개 기능 (이미 수집한 구간 자동 스킵)
- 진행률 표시
- API 호출 수 및 비용 추적
- 리트윗 제외, 인용글 원본 포함, conversationId 기준 맥락 묶기
"""

import requests
import json
import time
import os
from collections import defaultdict
from datetime import datetime, timedelta

# ===================== 설정 =====================
API_KEY = os.environ.get("GETXAPI_KEY")
if not API_KEY:
    raise RuntimeError("GETXAPI_KEY environment variable is required")

ACCOUNTS = {
    "LNCV34":          "2021-05-01",
    "min_anko38":      "2024-01-01",
    "Alisvolatprop12": "2020-09-01",
}

INTERVAL_MONTHS = 1   # 월별 분할 (작을수록 안전)
RETRIES = 5           # 재시도 횟수
TIMEOUT = 60          # 요청 타임아웃 초
COST_PER_CALL = 0.001 # GetXAPI 단가

OUTPUT_POSTS = "raw_posts.json"
OUTPUT_UNITS = "context_units.json"
PROGRESS_FILE = "progress.json"
# ================================================


# 전역 통계
stats = {"api_calls": 0, "retries": 0, "skipped_ranges": 0}


def date_ranges(start_str, interval_months=1):
    start = datetime.strptime(start_str, "%Y-%m-%d")
    end = datetime.today()
    ranges = []
    cursor = start
    while cursor < end:
        m = cursor.month + interval_months
        y = cursor.year + (m - 1) // 12
        m = (m - 1) % 12 + 1
        next_cursor = cursor.replace(year=y, month=m, day=1)
        if next_cursor > end:
            next_cursor = end + timedelta(days=1)
        ranges.append((cursor.strftime("%Y-%m-%d"), next_cursor.strftime("%Y-%m-%d")))
        cursor = next_cursor
    return ranges


def load_progress():
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"completed_ranges": {}, "posts": {}}


def save_progress(progress):
    with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
        json.dump(progress, f, ensure_ascii=False)


def safe_request(params):
    """재시도 포함 안전 요청"""
    for attempt in range(RETRIES):
        try:
            response = requests.get(
                "https://api.getxapi.com/twitter/tweet/advanced_search",
                headers={"Authorization": f"Bearer {API_KEY}"},
                params=params,
                timeout=TIMEOUT
            )
            stats["api_calls"] += 1
            if response.status_code == 200:
                return response.json()
            else:
                print(f"      HTTP {response.status_code}: {response.text[:200]}")
                if response.status_code == 429:  # rate limit
                    print("      Rate limit — 30초 대기")
                    time.sleep(30)
                    continue
        except requests.exceptions.Timeout:
            stats["retries"] += 1
            print(f"      타임아웃 재시도 {attempt+1}/{RETRIES}")
        except requests.exceptions.ConnectionError as e:
            stats["retries"] += 1
            print(f"      연결오류 재시도 {attempt+1}/{RETRIES}: {e}")
        except Exception as e:
            stats["retries"] += 1
            print(f"      오류 재시도 {attempt+1}/{RETRIES}: {e}")
        time.sleep(5 * (attempt + 1))  # 지수 백오프
    return None


def get_posts_by_range(username, since, until):
    posts = []
    cursor = None
    while True:
        params = {
            "q": f"from:{username} since:{since} until:{until}",
            "product": "Latest"
        }
        if cursor:
            params["cursor"] = cursor

        data = safe_request(params)
        if data is None:
            print(f"      구간 실패 스킵: {since}~{until}")
            stats["skipped_ranges"] += 1
            return posts

        batch = data.get("tweets", [])
        posts.extend(batch)
        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")
        time.sleep(0.3)
    return posts


def collect_account(username, start_date, progress):
    if username not in progress["posts"]:
        progress["posts"][username] = []
    if username not in progress["completed_ranges"]:
        progress["completed_ranges"][username] = []

    all_posts = progress["posts"][username]
    seen_ids = set(str(p.get("id")) for p in all_posts)
    done_ranges = set(tuple(r) for r in progress["completed_ranges"][username])

    ranges = date_ranges(start_date, INTERVAL_MONTHS)
    total_ranges = len(ranges)

    for idx, (since, until) in enumerate(ranges, 1):
        if (since, until) in done_ranges:
            continue

        print(f"  [{idx}/{total_ranges}] {username} [{since} ~ {until}] 수집 중...")
        posts = get_posts_by_range(username, since, until)

        new_count = 0
        for p in posts:
            pid = str(p.get("id"))
            if pid not in seen_ids:
                seen_ids.add(pid)
                all_posts.append(p)
                new_count += 1

        print(f"    → {len(posts)}개 받음, 신규 {new_count}개, 누적 {len(all_posts)}개")

        progress["completed_ranges"][username].append([since, until])
        progress["posts"][username] = all_posts
        save_progress(progress)
        time.sleep(0.5)

    return all_posts


def classify_post(post):
    if post.get("isRetweet"):
        return "repost_or_retweet"
    if post.get("quoted_tweet") or post.get("quotedTweet"):
        return "quote_post"
    if post.get("inReplyToId"):
        in_reply_author = post.get("inReplyToUserId")
        author = post.get("author", {}).get("id") if isinstance(post.get("author"), dict) else post.get("authorId")
        if in_reply_author and author and str(in_reply_author) == str(author):
            return "self_reply"
        return "reply_to_external_post"
    return "original_post"


def extract_source_stimulus(post):
    qt = post.get("quoted_tweet") or post.get("quotedTweet")
    if qt:
        return {
            "status": "present",
            "source_post_id": str(qt.get("id", "")),
            "source_author": qt.get("author", {}).get("userName") if isinstance(qt.get("author"), dict) else None,
            "source_text": qt.get("text") or qt.get("full_text"),
            "availability_reason": None,
            "media_refs": []
        }
    if post.get("inReplyToId"):
        return {
            "status": "unavailable",
            "source_post_id": str(post.get("inReplyToId", "")),
            "source_author": None,
            "source_text": None,
            "availability_reason": "별도 수집 필요",
            "media_refs": []
        }
    return {
        "status": "absent",
        "source_post_id": None,
        "source_author": None,
        "source_text": None,
        "availability_reason": None,
        "media_refs": []
    }


def build_context_units(posts, expert_handle):
    # 리트윗 제외
    posts = [p for p in posts if not p.get("isRetweet")]

    threads = defaultdict(list)
    for post in posts:
        cid = post.get("conversationId") or post.get("conversation_id") or str(post.get("id"))
        threads[cid].append(post)

    units = []
    for cid, thread_posts in threads.items():
        sorted_posts = sorted(thread_posts, key=lambda x: x.get("createdAt", ""))
        structural_basis = list(set([classify_post(p) for p in sorted_posts]))
        units.append({
            "unit_id": f"{expert_handle}_{cid}",
            "expert_handle": expert_handle,
            "structural_basis": structural_basis,
            "started_at": sorted_posts[0].get("createdAt", ""),
            "completed_at": sorted_posts[-1].get("createdAt", ""),
            "completion_status": "completed_candidate",
            "included_post_ids": [str(p.get("id")) for p in sorted_posts],
            "source_stimulus": extract_source_stimulus(sorted_posts[0]),
            "posts": sorted_posts
        })
    units.sort(key=lambda x: x["completed_at"])
    return units


# ===================== 실행 =====================
if __name__ == "__main__":
    print("=" * 50)
    print("X 포스팅 수집 시작")
    print("=" * 50)

    progress = load_progress()
    all_posts = {}

    for account, start_date in ACCOUNTS.items():
        print(f"\n=== {account} (가입: {start_date}) ===")
        posts = collect_account(account, start_date, progress)
        all_posts[account] = posts
        print(f"{account} 완료: 총 {len(posts)}개 포스팅")

    # 최종 저장
    with open(OUTPUT_POSTS, "w", encoding="utf-8") as f:
        json.dump(all_posts, f, ensure_ascii=False, indent=2)

    # Context unit 빌드
    print("\n=== Context Unit 생성 ===")
    all_units = {}
    for account, posts in all_posts.items():
        units = build_context_units(posts, account)
        all_units[account] = units
        print(f"  {account}: {len(posts)}개 포스팅 → {len(units)}개 unit")

    with open(OUTPUT_UNITS, "w", encoding="utf-8") as f:
        json.dump(all_units, f, ensure_ascii=False, indent=2)

    # 통계
    print("\n" + "=" * 50)
    print("완료!")
    print(f"  API 호출: {stats['api_calls']}회")
    print(f"  재시도: {stats['retries']}회")
    print(f"  스킵된 구간: {stats['skipped_ranges']}개")
    print(f"  예상 비용: ${stats['api_calls'] * COST_PER_CALL:.3f}")
    print(f"  저장 파일: {OUTPUT_POSTS}, {OUTPUT_UNITS}")
    print("=" * 50)
