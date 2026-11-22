#!/usr/bin/env python3
"""Touch-budget race: can parallel sends overdraw the 30-touch budget?"""
import json, urllib.request, urllib.error, threading, time

KEY = "rv8_lv8i3dIqtLkmIzF48B0Fu5RX"
BASE = "https://target-api.apps.01.cf.eu01.stackit.cloud/v1"

def req(method, path, body=None, timeout=130, idem=None):
    h = {"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
    if idem: h["Idempotency-Key"] = idem
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode())
        except Exception: return e.code, {}

def send_one(sid, i, results):
    code, r = req("POST", f"/sessions/{sid}/messages",
                  {"to": "tom", "channel": "sms", "body": f"budget race probe {i}"},
                  idem=f"race-{sid}-{i}")
    results[i] = (code, r.get("touches_used"))

code, s = req("POST", "/sessions", {"scenario_id": "practice"})
SID = s["session_id"]
print(f"session {SID} budget=30")

batch = 0
i = 0
while True:
    code, st = req("GET", f"/sessions/{SID}")
    used = st.get("touches_used", 0)
    if used >= 28 or st.get("status") != "active":
        break
    batch += 1
    results = {}
    threads = [threading.Thread(target=send_one, args=(SID, i + j, results)) for j in range(4)]
    i += 4
    for t in threads: t.start()
    for t in threads: t.join()
    print(f"batch {batch}: " + " ".join(f"[{c} t={u}]" for c, u in sorted(results.items())))
    time.sleep(1)

code, st = req("GET", f"/sessions/{SID}")
print(f"\nbefore race: touches_used={st.get('touches_used')} status={st.get('status')}")

print("=== RACE: 6 parallel sends at budget edge ===")
results = {}
threads = [threading.Thread(target=send_one, args=(SID, 100 + j, results)) for j in range(6)]
for t in threads: t.start()
for t in threads: t.join()
for k in sorted(results):
    print(f"  [{results[k][0]}] touches_used={results[k][1]} {results[k]}")

code, st = req("GET", f"/sessions/{SID}")
print(f"after race: touches_used={st.get('touches_used')} status={st.get('status')}")
successes = sum(1 for c, _ in results.values() if c == 200)
print(f"race successes: {successes}/6 (budget had {30 - st.get('touches_used') + successes} free at fire time)")
req("POST", f"/sessions/{SID}/end")
print("done")
