"""
fix_progress.py — 잘못 기록된 progress 복구
- fetched에 실제 수집된 트윗들의 conversationId 추출
- processed_convs 중 실제 수집 안 된 것들 제거
- 다음 실행 시 누락된 conversation 재수집
"""

import json
import os

PROGRESS_FILE = "enrich_progress.json"

def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

print("=== fix_progress.py 시작 ===")

if not os.path.exists(PROGRESS_FILE):
    print("enrich_progress.json 없음 — 복구 불필요")
    exit()

progress = load_json(PROGRESS_FILE)
fetched = progress.get("fetched", {})
processed_convs = set(progress.get("processed_convs", []))

print(f"처리된 conv 기록: {len(processed_convs)}개")
print(f"실제 수집된 트윗: {len(fetched)}개")

# 실제 수집된 트윗들의 conversationId 추출
actually_collected_convs = set()
for tid, tweet in fetched.items():
    if tweet is None:
        continue
    cid = str(tweet.get("conversationId", "") or "")
    if cid and cid != "None":
        actually_collected_convs.add(cid)

print(f"실제 수집된 conv: {len(actually_collected_convs)}개")

# 완료로 기록됐지만 실제로 수집 안 된 conversation
fake_completed = processed_convs - actually_collected_convs
print(f"잘못 완료 기록된 conv: {len(fake_completed)}개 → 재수집 대상으로 복구")

# processed_convs에서 가짜 완료 제거
new_processed = list(processed_convs - fake_completed)
progress["processed_convs"] = new_processed
progress["queue"] = list(fake_completed)  # 재수집 큐에 추가

save_json(PROGRESS_FILE, progress)

print(f"\n복구 완료!")
print(f"  남은 처리된 conv: {len(new_processed)}개")
print(f"  재수집 큐: {len(fake_completed)}개")
print(f"\n이제 python enrich.py 실행하면 누락된 것만 재수집해요.")
