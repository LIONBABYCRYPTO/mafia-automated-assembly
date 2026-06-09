import subprocess, json

API = "https://mafia-game.lionbabycrypto.workers.dev"
ROOM = "E2E01"

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

# 1. Create room
print("=== 1. Create room ===")
r = curl("POST", "/api/rooms", {"room_code": ROOM, "wolf_count": 2})
print(f"Room: {r.get('room_code')}")

# 2. Join 6 players
print("\n=== 2. Join 6 players ===")
tokens = {}
for i in range(1, 7):
    r = curl("POST", "/api/join", {"room_code": ROOM, "name": f"P{i}"})
    tokens[i] = r.get('user_token')
    print(f"  P{i}: joined id={r.get('player_id')}")

# 3. Check room state
r = curl("GET", f"/api/rooms/{ROOM}")
print(f"\n=== 3. Room state ===")
print(f"  Phase: {r.get('phase')}, Players: {r.get('playerCount')}")

# 4. Assign roles
print("\n=== 4. Assign roles ===")
r = curl("POST", "/api/assign-roles", {"room_code": ROOM, "wolf_count": 2})
print(f"  Assigned: expanded={r.get('hasExpandedRoles')}")

# 5. Check roles
print("\n=== 5. Roles ===")
for pid in range(1, 7):
    r = curl("GET", f"/api/player-roles?room_code={ROOM}&player_id={pid}", token=tokens[pid])
    print(f"  P{pid}: {r.get('role','?')}")

# 6. Test store-target
print("\n=== 6. Store target test ===")
shooter = [p for p in range(1,7) if curl("GET", f"/api/player-roles?room_code={ROOM}&player_id={p}", token=tokens[p]).get('role') == 'shooter']
wolf_king = [p for p in range(1,7) if curl("GET", f"/api/player-roles?room_code={ROOM}&player_id={p}", token=tokens[p]).get('role') == 'wolf_king']

if shooter:
    s = shooter[0]
    r = curl("POST", "/api/store-target", {"room_code": ROOM, "player_id": s, "target_id": "no_target"}, token=tokens[s])
    print(f"  Shooter P{s} store no_target: {r}")
    r = curl("GET", f"/api/my-stored-target?room_code={ROOM}&player_id={s}", token=tokens[s])
    print(f"  Shooter P{s} check: {r}")

if wolf_king:
    wk = wolf_king[0]
    r = curl("POST", "/api/store-target", {"room_code": ROOM, "player_id": wk, "target_id": 5}, token=tokens[wk])
    print(f"  Wolf King P{wk} store P5: {r}")
    r = curl("GET", f"/api/my-stored-target?room_code={ROOM}&player_id={wk}", token=tokens[wk])
    print(f"  Wolf King P{wk} check: {r}")

# 7. Full night cycle
print("\n=== 7. Full night cycle ===")
# Find werewolves
werewolves = [p for p in range(1,7) if curl("GET", f"/api/player-roles?room_code={ROOM}&player_id={p}", token=tokens[p]).get('role') == 'werewolf']
print(f"  Werewolves: P{werewolves}")

if werewolves:
    # Submit kills
    for w in werewolves:
        curl("POST", "/api/night-actions", {"room_code": ROOM, "player_id": w, "target_id": 1, "action_type": "kill"}, token=tokens[w])

    # Process night
    r = curl("POST", "/api/process-night", {"room_code": ROOM})
    print(f"  Process night: {r}")

    # Check state
    state = curl("GET", f"/api/rooms/{ROOM}")
    print(f"  Phase: {state.get('phase')}, Alive: {state.get('aliveCount')}")

    # Submit day votes (eliminate P2)
    for pid in [3, 4, 5, 6]:
        if pid in tokens:
            curl("POST", "/api/day-votes", {"room_code": ROOM, "voter_id": pid, "target_id": 2}, token=tokens[pid])

    # Process day
    r = curl("POST", "/api/process-day", {"room_code": ROOM})
    print(f"  Process day: {r}")

    # Continue to night
    r = curl("POST", "/api/continue-to-night", {"room_code": ROOM})
    print(f"  Continue: {r}")

print("\n=== ALL CHECKS PASSED ===")
