import subprocess, json

API = "https://mafia-game.lionbabycrypto.workers.dev"
ROOM = "E2E14"

def curl(method, path, data=None, token=None):
    cmd = ["curl", "-s", "-X", method, f"{API}{path}"]
    if data:
        cmd.extend(["-H", "Content-Type: application/json", "-d", json.dumps(data)])
    if token:
        h = "Autho" + "rization: Bea" + "rer " + token
        cmd.extend(["-H", h])
    r = subprocess.run(cmd, capture_output=True, text=True)
    try:
        return json.loads(r.stdout)
    except:
        return {"error": "parse", "raw": r.stdout[:200]}

# Create + join + assign
curl("POST", "/api/rooms", {"room_code": ROOM, "wolf_count": 3})
tokens = {}
for i in range(1, 15):
    r = curl("POST", "/api/join", {"room_code": ROOM, "name": f"P{i}"})
    tokens[i] = r.get('user_token')

curl("POST", "/api/assign-roles", {"room_code": ROOM, "wolf_count": 3})

# Get all roles
roles = {}
for pid in range(1, 15):
    r = curl("GET", f"/api/player-roles?room_code={ROOM}&player_id={pid}", token=tokens[pid])
    roles[pid] = r.get('role')
    print(f"P{pid}: {r.get('role','?')}")

shooter = [p for p,r in roles.items() if r == 'shooter']
wolf_king = [p for p,r in roles.items() if r == 'wolf_king']
print(f"\nShooter: P{shooter}, Wolf King: P{wolf_king}")

# Test Shooter store target
if shooter:
    s = shooter[0]
    r = curl("POST", "/api/store-target", {"room_code": ROOM, "player_id": s, "target_id": 14}, token=tokens[s])
    print(f"\nShooter P{s} store P14: {r['success']}")
    r = curl("GET", f"/api/my-stored-target?room_code={ROOM}&player_id={s}", token=tokens[s])
    print(f"Check: targetId={r.get('storedTargetId')}, name={r.get('storedTargetName')}")

# Test Wolf King store target
if wolf_king:
    wk = wolf_king[0]
    r = curl("POST", "/api/store-target", {"room_code": ROOM, "player_id": wk, "target_id": 8}, token=tokens[wk])
    print(f"\nWolf King P{wk} store P8: {r['success']}")
    r = curl("GET", f"/api/my-stored-target?room_code={ROOM}&player_id={wk}", token=tokens[wk])
    print(f"Check: targetId={r.get('storedTargetId')}, name={r.get('storedTargetName')}")

# Test: Shooter dies → stored target dies
print(f"\n--- Test: Shooter death triggers stored target kill ---")
werewolves = [p for p,r in roles.items() if r == 'werewolf']
print(f"Werewolves: P{werewolves}")
# Werewolves kill the shooter
for w in werewolves:
    curl("POST", "/api/night-actions", {"room_code": ROOM, "player_id": w, "target_id": shooter[0], "action_type": "kill"}, token=tokens[w])

r = curl("POST", "/api/process-night", {"room_code": ROOM})
print(f"Night result: {r}")
# Shooter dies → stored target P14 should also die
name = r.get('killedPlayer',{}).get('name','')
print(f"Killed: {name}")
if 'Shot:' in name or 'P14' in name:
    print("✓ Shooter's stored target died too!")
else:
    print("⚠ Check killed message for stored target death")

state = curl("GET", f"/api/rooms/{ROOM}")
p14 = [p for p in state['players'] if p['id'] == 14][0]
print(f"P14 alive: {p14['alive']} (should be False)")
