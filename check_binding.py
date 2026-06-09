#!/usr/bin/env python3
import subprocess, json

token = open('/tmp/cf_token.txt').read().strip()
acct = "1e344b17f9e359523dcdbf6c7f229ccf"
auth = "Authorization: Bearer " + token

r = subprocess.run(["curl", "-s",
    "https://api.cloudflare.com/client/v4/accounts/" + acct + "/workers/scripts/mafia-game",
    "-H", auth], capture_output=True, text=True)
res = json.loads(r.stdout)
if res.get("success"):
    script = res.get("result", {})
    for b in script.get("bindings", []):
        print(b["name"], "->", b.get("namespace_id", b.get("type")))
    print("Script:", len(script.get("script", "")), "bytes")
else:
    print("Errors:", res.get("errors"))
