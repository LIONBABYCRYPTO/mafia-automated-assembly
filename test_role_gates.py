#!/usr/bin/env python3
import subprocess, json

API = "https://mafia-game.lionbabycrypto.workers.dev"

# Create room, join, start
r1 = json.loads(subprocess.run(["curl", "-s", "-X", "POST", API+"/api/rooms", "-d", "{}"], capture_output=True, text=True).stdout)
ROOM = r1["room_code"]
print("Room:", ROOM)

players = {}
for n in ["Doc","W1","W2","V1","V2","V3"]:
    r = subprocess.run(["curl", "-s", "-X", "POST", API+"/api/join", "-d", json.dumps({"room_code":ROOM,"name":n})], capture_output=True, text=True)
    p = json.loads(r.stdout)
    players[n] = p

subprocess.run(["curl", "-s", "-X", "POST", API+"/api/assign-roles", "-d", json.dumps({"room_code":ROOM,"wolf_count":2})], capture_output=True, text=True)

# Get roles via player-roles
for n in players:
    pid = players[n]["player_id"]
    tok = players[n]["user_token"]
    hdr = "Authorization: Bearer *** + str(tok)
    r = subprocess.run(["curl", "-s", API+"/api/player-roles?room_code="+ROOM+"&player_id="+str(pid), "-H", hdr], capture_output=True, text=True)
    role = json.loads(r.stdout).get("role")
    players[n]["role"] = role
    print(f"  {n}: {role}")

vills = [v for k,v in players.items() if v.get("role") == "villager"]
wolves = [v for k,v in players.items() if v.get("role") == "werewolf"]
doc = next((v for k,v in players.items() if v.get("role") == "doctor"), None)
vill = vills[0] if vills else None
wolf = wolves[0] if wolves else None

if not vill or not wolf or not doc:
    print("Role assignment failed")
    exit(1)

# Test 1: Villager investigates -> should fail
hdr1 = "Authorization: Bearer *** + str(vill["user_token"])
r = subprocess.run(["curl", "-s", "-X", "POST", API+"/api/night-actions", "-d", json.dumps({"room_code":ROOM,"player_id":vill["player_id"],"target_id":wolf["player_id"],"action_type":"investigate"}), "-H", "Content-Type: application/json", "-H", hdr1], capture_output=True, text=True)
resp = json.loads(r.stdout)
print(f"\n[Role Gate] Villager investigates: {resp.get('error','?')}")
assert "cannot perform" in resp.get("error","").lower(), f"Expected role gate error, got: {resp}"

# Test 2: Doctor kills -> should fail
hdr2 = "Authorization: Bearer *** + str(doc["user_token"])
r = subprocess.run(["curl", "-s", "-X", "POST", API+"/api/night-actions", "-d", json.dumps({"room_code":ROOM,"player_id":doc["player_id"],"target_id":vill["player_id"],"action_type":"kill"}), "-H", "Content-Type: application/json", "-H", hdr2], capture_output=True, text=True)
resp = json.loads(r.stdout)
print(f"[Role Gate] Doctor kills: {resp.get('error','?')}")
assert "cannot perform" in resp.get("error","").lower(), f"Expected role gate error, got: {resp}"

# Test 3: Wolf kills -> should succeed
hdr3 = "Authorization: Bearer *** + str(wolf["user_token"])
r = subprocess.run(["curl", "-s", "-X", "POST", API+"/api/night-actions", "-d", json.dumps({"room_code":ROOM,"player_id":wolf["player_id"],"target_id":vill["player_id"],"action_type":"kill"}), "-H", "Content-Type: application/json", "-H", hdr3], capture_output=True, text=True)
resp = json.loads(r.stdout)
print(f"[Role Gate] Wolf kills: {resp.get('success','?')}")
assert resp.get("success") == True, f"Expected wolf kill to succeed, got: {resp}"

# Test 4: Dead player voting
subprocess.run(["curl", "-s", "-X", "POST", API+"/api/process-night", "-d", json.dumps({"room_code":ROOM})], capture_output=True, text=True)
st = json.loads(subprocess.run(["curl", "-s", API+"/api/rooms/"+ROOM], capture_output=True, text=True).stdout)

vill_id = vill["player_id"]
vill_alive = True
for p in st["players"]:
    if p["id"] == vill_id:
        vill_alive = p["alive"]

if not vill_alive:
    subprocess.run(["curl", "-s", "-X", "POST", API+"/api/update-phase", "-d", json.dumps({"room_code":ROOM,"phase":"day_voting"})], capture_output=True, text=True)
    hdr_vote = "Authorization: Bearer *** + str(vill["user_token"])
    r = subprocess.run(["curl", "-s", "-X", "POST", API+"/api/day-votes", "-d", json.dumps({"room_code":ROOM,"voter_id":vill_id,"target_id":1}), "-H", "Content-Type: application/json", "-H", hdr_vote], capture_output=True, text=True)
    resp = json.loads(r.stdout)
    print(f"[Dead Gate] Dead votes: {resp.get('error','?')}")
    assert "dead" in resp.get("error","").lower(), f"Expected dead gate error, got: {resp}"

    # Test 5: Dead player final words
    r = subprocess.run(["curl", "-s", "-X", "POST", API+"/api/final-words", "-d", json.dumps({"room_code":ROOM,"player_id":vill_id,"text":"I'm dead"}), "-H", "Content-Type: application/json", "-H", hdr_vote], capture_output=True, text=True)
    resp = json.loads(r.stdout)
    print(f"[Dead Gate] Dead sends final words: {resp.get('success','?')}")
    assert resp.get("success") == True, f"Expected dead to send final words, got: {resp}"

print("\n=== ALL ROLE/DEAD GATE TESTS PASSED ===")
