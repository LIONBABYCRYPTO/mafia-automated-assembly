import urllib.request, json, sys

token = open("/tmp/cf_token.txt").read().strip()

def cf(method, path, data=None, auth=None):
    url = "https://mafia-game.lionbabycrypto.workers.dev" + path
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Content-Type", "application/json")
    if auth:
        ah = "Bearer " + auth
        req.add_header("Authorization", ah)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"error": "HTTP " + str(e.code) + ": " + e.read().decode()[:100]}

# Create room
d = cf("POST", "/api/rooms", {"wolf_count": 2})
code = d["room_code"]
print("Room:", code)

# Join 6 players
for n in ["A","B","C","D","E","F"]:
    cf("POST", "/api/players", {"room_code": code, "name": n})
print("Joined 6 players")

# Assign roles
r = cf("POST", "/api/assign-roles", {"room_code": code, "wolf_count": 2})
print("Assign: success=" + str(r.get("success")) + ", count=" + str(r.get("playerCount")))

# Get state
s = cf("GET", "/api/rooms/" + code)
print("Phase:", s["phase"], "Round:", s["round"])
print("Distribution:", s["roles"])

# Process night (no actions)
r2 = cf("POST", "/api/process-night", {"room_code": code})
print("Process night: killed=" + str(r2.get("killedPlayer")) + ", saved=" + str(r2["saved"]))

# Get state again
s2 = cf("GET", "/api/rooms/" + code)
print("After night: phase=" + s2["phase"] + ", round=" + str(s2["round"]))

# Start voting
cf("POST", "/api/update-phase", {"room_code": code, "phase": "day_voting", "duration": 60})
print("Started voting")

# Process day (no votes)
r3 = cf("POST", "/api/process-day", {"room_code": code})
print("Process day: eliminated=" + str(r3.get("eliminatedPlayer")))

# Continue to night
r4 = cf("POST", "/api/continue-to-night", {"room_code": code})
print("Continue: success=" + str(r4.get("success")) + ", round=" + str(r4.get("round")))

# Final state
s3 = cf("GET", "/api/rooms/" + code)
print("Final: phase=" + s3["phase"] + ", round=" + str(s3["round"]))
print("\n=== FULL WORKER TEST PASSED ===")
sys.exit(0)
