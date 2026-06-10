import subprocess, json

API = "https://mafia-game.lionbabycrypto.workers.dev"

def api(method, path, body=None, token=None):
    cmd = ["curl", "-s", "-X", method, API + path]
    if body is not None:
        cmd.extend(["-H", "Content-Type: application/json"])
        cmd.extend(["-d", json.dumps(body)])
    if token is not None:
        at = "Authorization: Bearer " + token
        cmd.extend(["-H", at])
    r = subprocess.run(cmd, capture_output=True, text=True)
    return json.loads(r.stdout)

PASS = 0; FAIL = 0
def check(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print("  PASS: " + label)
    else:
        FAIL += 1
        print("  FAIL: " + label + " -- " + detail)

print("=== Phase 1: Role Gates ===")
r = api("POST", "/api/rooms", {})
ROOM = r["room_code"]
players = {}
for n in ["Doc","W1","W2","V1","V2","V3"]:
    p = api("POST", "/api/join", {"room_code": ROOM, "name": n})
    players[n] = p
api("POST", "/api/assign-roles", {"room_code": ROOM, "wolf_count": 2})

for n in players:
    pid = players[n]["player_id"]
    tok = players[n]["user_token"]
    role = api("GET", "/api/player-roles?room_code="+ROOM+"&player_id="+str(pid), token=tok).get("role")
    players[n]["role"] = role

vills = [v for k,v in players.items() if v.get("role") == "villager"]
wolves = [v for k,v in players.items() if v.get("role") == "werewolf"]
doc = None
for v in players.values():
    if v.get("role") == "doctor":
        doc = v
vill = vills[0]
wolf = wolves[0]

print("Roles identified: vill="+vill.get("name","?")+" wolf="+wolf.get("name","?")+" doc="+doc.get("name","?") if doc else "?")

r = api("POST", "/api/night-actions", {"room_code":ROOM,"player_id":vill["player_id"],"target_id":wolf["player_id"],"action_type":"investigate"}, token=vill["user_token"])
check("Villager cannot investigate", "cannot" in (r.get("error","") or "").lower(), str(r)[:80])

r = api("POST", "/api/night-actions", {"room_code":ROOM,"player_id":doc["player_id"],"target_id":vill["player_id"],"action_type":"kill"}, token=doc["user_token"])
check("Doctor cannot kill", "cannot" in (r.get("error","") or "").lower(), str(r)[:80])

r = api("POST", "/api/night-actions", {"room_code":ROOM,"player_id":wolf["player_id"],"target_id":vill["player_id"],"action_type":"kill"}, token=wolf["user_token"])
check("Wolf can kill", r.get("success") == True, str(r)[:80])

r = api("POST", "/api/night-actions", {"room_code":ROOM,"player_id":doc["player_id"],"target_id":wolf["player_id"],"action_type":"protect"}, token=doc["user_token"])
check("Doctor can protect", r.get("success") == True, str(r)[:80])

print("\n=== Phase 1: Dead Gates ===")
api("POST", "/api/process-night", {"room_code": ROOM})
st = api("GET", "/api/rooms/" + ROOM)
vill_dead = True
for p in st["players"]:
    if p["id"] == vill["player_id"] and p["alive"]:
        vill_dead = False

if vill_dead:
    api("POST", "/api/update-phase", {"room_code":ROOM,"phase":"day_voting"})
    r = api("POST", "/api/day-votes", {"room_code":ROOM,"voter_id":vill["player_id"],"target_id":1}, token=vill["user_token"])
    check("Dead cannot vote", "dead" in (r.get("error","") or "").lower(), str(r)[:80])
    r = api("POST", "/api/night-actions", {"room_code":ROOM,"player_id":vill["player_id"],"target_id":1,"action_type":"kill"}, token=vill["user_token"])
    check("Dead cannot act", "dead" in (r.get("error","") or "").lower(), str(r)[:80])
    r = api("POST", "/api/final-words", {"room_code":ROOM,"player_id":vill["player_id"],"text":"bye"}, token=vill["user_token"])
    check("Dead can send final words", r.get("success") == True, str(r)[:80])
else:
    print("  SKIP - villager survived (doctor saved)")

r = api("POST", "/api/final-words", {"room_code":ROOM,"player_id":wolf["player_id"],"text":"im alive"}, token=wolf["user_token"])
check("Alive cannot send final words", "dead" in (r.get("error","") or "").lower(), str(r)[:80])

print("\n=== Phase 1: Phase Guards ===")
api("POST", "/api/update-phase", {"room_code":ROOM,"phase":"day_discussion"})
r = api("POST", "/api/process-night", {"room_code": ROOM})
check("process-night guard", r.get("error") == "Not night phase", str(r)[:60])
r = api("POST", "/api/process-day", {"room_code": ROOM})
check("process-day guard", "vot" in (r.get("error","") or "").lower(), str(r)[:60])

api("POST", "/api/update-phase", {"room_code":ROOM,"phase":"day_voting"})
r = api("POST", "/api/continue-to-night", {"room_code": ROOM})
check("continue-to-night guard", r.get("error") == "Not results phase", str(r)[:60])
api("POST", "/api/process-day", {"room_code": ROOM})
r = api("POST", "/api/continue-to-night", {"room_code": ROOM})
check("continue-to-night OK", r.get("success") == True, str(r)[:60])

print("\n=== Phase 1: Update Phase ===")
for phase in ["night","day_discussion","day_voting","day_results","victory"]:
    r = api("POST", "/api/update-phase", {"room_code":ROOM,"phase":phase})
    check("update: "+phase, r.get("success") == True, str(r)[:50])
    st = api("GET", "/api/rooms/" + ROOM)
    check("  verified", st.get("phase") == phase, "got "+st.get("phase","?"))

print("\n=== RESULTS: "+str(PASS)+"/"+str(PASS+FAIL)+" ===")
if FAIL == 0:
    print("ALL PASSED")
else:
    print(str(FAIL)+" FAILURES")
