#!/usr/bin/env python3
import subprocess, json

API = "https://mafia-game.lionbabycrypto.workers.dev"

def api(method, path, body=None, token=None):
    cmd = ["curl", "-s", "-X", method, API + path]
    if token is not None:
        cmd.extend(["-H", "Authorization: Bearer XY" + str(token)])
    if body is not None:
        cmd.extend(["-H", "Content-Type: application/json"])
        cmd.extend(["-d", json.dumps(body)])
    r = subprocess.run(cmd, capture_output=True, text=True)
    try:
        return json.loads(r.stdout)
    except:
        return {"error": r.stdout[:200]}

PASS = 0; FAIL = 0

def check(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS: " + label)
    else:
        FAIL += 1
        print("  FAIL: " + label + " -- " + detail)

def room_state(code):
    r = subprocess.run(["curl", "-s", API + "/api/rooms/" + str(code)], capture_output=True, text=True)
    return json.loads(r.stdout)

# === TEST 1: Phase Guards ===
print("=== Phase Guards ===")
r = api("POST", "/api/rooms", {})
ROOM = r.get("room_code", "")
if not ROOM:
    print("Create room failed: " + str(r))
    exit(1)
print("Room: " + ROOM)
for n in ["P1","P2","P3","P4","P5","P6"]:
    api("POST", "/api/join", {"room_code": ROOM, "name": n})
api("POST", "/api/assign-roles", {"room_code": ROOM, "wolf_count": 2})
api("POST", "/api/update-phase", {"room_code": ROOM, "phase": "day_discussion"})
r = api("POST", "/api/process-night", {"room_code": ROOM})
check("process-night rejected in day", r.get("error") == "Not night phase", str(r)[:100])
r = api("POST", "/api/process-day", {"room_code": ROOM})
check("process-day rejected in discussion", "voting" in (r.get("error") or "").lower(), str(r)[:100])

# === TEST 2: Alive Checks ===
print("\n=== Alive Checks ===")
r = api("POST", "/api/rooms", {})
room2 = r.get("room_code", "")
players = {}
for n in ["Doc","W1","W2","V1","V2","V3"]:
    p = api("POST", "/api/join", {"room_code": room2, "name": n})
    if "player_id" in p:
        players[n] = p
api("POST", "/api/assign-roles", {"room_code": room2, "wolf_count": 2})

for n in list(players.keys()):
    p = players[n]
    role = api("GET", "/api/player-roles?room_code=" + room2 + "&player_id=" + str(p["player_id"]), token=p["user_token"]).get("role")
    players[n]["role"] = role

wolves = [v for k,v in players.items() if v.get("role") == "werewolf"]
vills = [v for k,v in players.items() if v.get("role") == "villager"]
doc = None
for k,v in players.items():
    if v.get("role") == "doctor":
        doc = v
wolf = wolves[0] if wolves else None
vill = vills[0] if vills else None

if not doc or not wolf or not vill:
    print("SKIP - roles not found: " + str({k: v.get("role","?") for k,v in players.items()}))
else:
    r = api("POST", "/api/final-words", {"room_code":room2,"player_id":doc["player_id"],"text":"I'm alive!"}, token=doc["user_token"])
    check("Alive final words rejected", "dead" in (r.get("error") or "").lower(), str(r)[:100])
    api("POST", "/api/night-actions", {"room_code":room2,"player_id":wolf["player_id"],"target_id":vill["player_id"],"action_type":"kill"}, token=wolf["user_token"])
    api("POST", "/api/process-night", {"room_code":room2})
    st2 = room_state(room2)
    vill_dead = False
    for p in st2["players"]:
        for k,v in players.items():
            if v.get("player_id") == p["id"] and v.get("role") == "villager":
                vill_dead = not p["alive"]
    if not vill_dead:
        print("SKIP - villager not killed")
    else:
        api("POST", "/api/update-phase", {"room_code": room2, "phase": "day_voting"})
        r = api("POST", "/api/day-votes", {"room_code":room2,"voter_id":vill["player_id"],"target_id":1}, token=vill["user_token"])
        check("Dead cannot vote", "dead" in (r.get("error") or "").lower(), str(r)[:100])
        r = api("POST", "/api/night-actions", {"room_code":room2,"player_id":vill["player_id"],"target_id":1,"action_type":"kill"}, token=vill["user_token"])
        check("Dead cannot act at night", "dead" in (r.get("error") or "").lower(), str(r)[:100])

# === TEST 3: Phase Guards ===
print("\n=== Phase Guards 2 ===")
r = api("POST", "/api/rooms", {})
room3 = r.get("room_code", "")
for n in ["A","B","C","D","E","F"]:
    api("POST", "/api/join", {"room_code": room3, "name": n})
api("POST", "/api/assign-roles", {"room_code": room3, "wolf_count": 2})
api("POST", "/api/update-phase", {"room_code": room3, "phase": "day_discussion"})
r = api("POST", "/api/process-night", {"room_code": room3})
check("process-night guard", r.get("error") == "Not night phase", str(r)[:100])
api("POST", "/api/update-phase", {"room_code": room3, "phase": "day_voting"})
r = api("POST", "/api/continue-to-night", {"room_code": room3})
check("continue-to-night guard", r.get("error") == "Not results phase", str(r)[:100])
api("POST", "/api/process-day", {"room_code": room3})
r = api("POST", "/api/continue-to-night", {"room_code": room3})
check("continue-to-night OK", r.get("success") == True, str(r)[:100])

print("\nTotal: " + str(PASS) + "/" + str(PASS+FAIL))
if FAIL == 0:
    print("ALL PASSED")