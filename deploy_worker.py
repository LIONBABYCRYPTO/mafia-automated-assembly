#!/usr/bin/env python3
import subprocess, json
token = open('/tmp/cf_token.txt').read().strip()
acct = "1e344b17f9e359523dcdbf6c7f229ccf"
auth = "Authorization: Bearer " + token

# Upload
r = subprocess.run(["curl", "-s", "-X", "PUT",
    "https://api.cloudflare.com/client/v4/accounts/" + acct + "/workers/scripts/mafia-game",
    "-H", auth,
    "-H", "Content-Type: application/javascript",
    "--data-binary", "@worker-fetch.js"], capture_output=True, text=True)
res = json.loads(r.stdout)
print("Upload:", res.get("success"))
if not res.get("success"):
    for e in res.get("errors", []):
        print("  Error:", e.get("message"))
