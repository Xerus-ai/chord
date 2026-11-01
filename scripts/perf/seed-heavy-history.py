"""Builds the perf bench's heavy profile: a copy of a signed-in seed profile
whose busiest chat session gains a long history, so opening it, scrolling it
and reading old turns can be timed at a realistic size.

    python scripts/perf/seed-heavy-history.py [seed=chord-p1-smoke] [target=chord-perf-heavy] [pairs=600]

The added turns are copies of the seed's own agent turns (fresh ids), placed
before the session's first real row, so the visible tail is unchanged. Every
added row is stamped `synced_at`, so the sync queue never pushes it to the
cloud (sync-queue-reconcile.ts reads `synced_at IS NULL`).
"""

import json
import os
import random
import shutil
import sqlite3
import sys
import uuid

SEED_ENTRIES = [
    "chord.db", "chord.db-wal", "chord.db-shm", "Preferences", "Local State",
    "Local Storage", "Session Storage", "Network", "IndexedDB", "WebStorage",
]

seed = sys.argv[1] if len(sys.argv) > 1 else "chord-p1-smoke"
target = sys.argv[2] if len(sys.argv) > 2 else "chord-perf-heavy"
pairs = int(sys.argv[3]) if len(sys.argv) > 3 else 600

appdata = os.environ["APPDATA"]
seed_dir = os.path.join(appdata, seed)
target_dir = os.path.join(appdata, target)
if os.path.exists(target_dir):
    shutil.rmtree(target_dir)
os.makedirs(target_dir)
for entry in SEED_ENTRIES:
    src = os.path.join(seed_dir, entry)
    if os.path.isdir(src):
        shutil.copytree(src, os.path.join(target_dir, entry))
    elif os.path.exists(src):
        shutil.copy2(src, os.path.join(target_dir, entry))

db = sqlite3.connect(os.path.join(target_dir, "chord.db"))
# The chat session with the most rows is the one the bench opens.
session_id, work_item_id = db.execute(
    """SELECT m.session_id, m.work_item_id FROM chat_messages m
       JOIN agent_sessions s ON s.id = m.session_id AND s.kind = 'chat'
       GROUP BY m.session_id ORDER BY count(*) DESC LIMIT 1"""
).fetchone()
(first_ms,) = db.execute(
    "SELECT min(created_at_ms) FROM chat_messages WHERE work_item_id = ?", (work_item_id,)
).fetchone()
templates = [
    json.loads(m)
    for (m,) in db.execute(
        "SELECT metadata FROM chat_messages WHERE message_type = 'agent_turn' AND metadata IS NOT NULL"
    )
]
templates = [t for t in templates if t.get("turnId") and t.get("items")]
if not templates:
    raise SystemExit(f"{seed} has no agent turns to copy")
prompts = [
    c for (c,) in db.execute(
        "SELECT content FROM chat_messages WHERE sender_type = 'human' AND length(content) > 0"
    )
] or ["Continue with the next step."]

random.seed(7)


def fresh_ids(value):
    if isinstance(value, dict):
        return {k: (str(uuid.uuid4()) if k == "id" else fresh_ids(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [fresh_ids(v) for v in value]
    return value


rows = []
start_ms = first_ms - pairs * 120_000
for i in range(pairs):
    at = start_ms + i * 120_000
    rows.append((
        str(uuid.uuid4()), work_item_id, session_id, "human", None, "Perf", random.choice(prompts),
        "text", "{}", None, at // 1000, at, at // 1000,
    ))
    turn = fresh_ids(random.choice(templates))
    turn_id = str(uuid.uuid4())
    turn["turnId"] = turn_id
    turn["startedAt"] = at + 1000
    turn["completedAt"] = at + 60_000
    # Items keep their own start times (thinking shows "Thought for Ns" from
    # them); copied ones still carried the original turn's, months earlier.
    for item in turn["items"]:
        if "startedAt" in item:
            item["startedAt"] = at + 1000
    rows.append((
        str(uuid.uuid4()), work_item_id, session_id, "agent", None, "Claude Code", "",
        "agent_turn", json.dumps(turn), turn_id, (at + 60_000) // 1000, at + 60_000,
        (at + 60_000) // 1000,
    ))
db.executemany(
    """INSERT INTO chat_messages (id, work_item_id, session_id, sender_type, sender_id,
       sender_name, content, message_type, metadata, turn_id, created_at, created_at_ms, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
    rows,
)
db.commit()
(name,) = db.execute("SELECT name FROM work_items WHERE id = ?", (work_item_id,)).fetchone()
(total, size) = db.execute(
    "SELECT count(*), sum(length(metadata)) FROM chat_messages WHERE work_item_id = ?",
    (work_item_id,),
).fetchone()
db.close()
print(json.dumps({
    "profile": target, "workItemId": work_item_id, "workItemName": name, "sessionId": session_id,
    "rows": total, "metadataBytes": size,
}))
