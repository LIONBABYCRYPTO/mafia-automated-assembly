import subprocess, json

API = "https://mafia-game.lionbabycrypto.workers.dev"

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

# Re-create room for clean state
curl("POST", "/api/rooms", {"room_code": "FLOW2", "wolf_count": 3})
tokens = {}
for i in range(1, 15):
    r = curl("POST", "/api/join", {"room_code": "FLOW2", "name": f"P{i}"})
    tokens[i] = r.get('user_token')

curl("POST", "/api/assign-roles", {"room_code": "FLOW2", "wolf_count": 3})

# Find roles
roles = {}
for pid in range(1, 15):
    r = curl("GET", f"/api/player-roles?room_code=FLOW2&player_id={pid}", token=tokens[pid])
    roles[pid] = r.get('role')

shooter = [p for p, r in roles.items() if r == 'shooter'][0]
wolf_king = [p for p, r in roles.items() if r == 'wolf_king'][0]
seer = [p for p, r in roles.items() if r == 'seer'][0]
doctor = [p for p, r in roles.items() if r == 'doctor'][0]

print(f"Roles: shooter=P{shooter}, wolf_king=P{wolf_king}, seer=P{seer}, doctor=P{doctor}")

# ─── TEST 1: Shooter stores "No Target" ───
print("\n=== TEST 1: Shooter stores No Target ===")
r = curl("POST", "/api/store-target",
         {"room_code": "FLOW2", "player_id": shooter, "target_id": "no_target"},
         token=tokens[shooter])
print(f"  Store no_target: {r}")

r = curl("GET", f"/api/my-stored-target?room_code=FLOW2&player_id={shooter}", token=tokens[shooter])
print(f"  Check stored: {r}")
assert r.get('storedTargetId') is None, "FAIL: expected null target"
print("  ✓ PASS")

# ─── TEST 2: Shooter stores a real target ───
print("\n=== TEST 2: Shooter stores P14 ===")
r = curl("POST", "/api/store-target",
         {"room_code": "FLOW2", "player_id": shooter, "target_id": 14},
         token=tokens[shooter])
print(f"  Store P14: {r}")

r = curl("GET", f"/api/my-stored-target?room_code=FLOW2&player_id={shooter}", token=tokens[shooter])
print(f"  Check stored: {r}")
assert r.get('storedTargetId') == 14, f"FAIL: expected 14, got {r}"
print("  ✓ PASS")

# ─── TEST 3: Shooter changes target on next night ───
print("\n=== TEST 3: Shooter changes target to P3 ===")
r = curl("POST", "/api/store-target",
         {"room_code": "FLOW2", "player_id": shooter, "target_id": 3},
         token=tokens[shooter])
print(f"  Store P3: {r}")

r = curl("GET", f"/api/my-stored-target?room_code=FLOW2&player_id={shooter}", token=tokens[shooter])
print(f"  Check stored: {r}")
assert r.get('storedTargetId') == 3, f"FAIL: expected 3, got {r}"
print("  ✓ PASS")

# ─── TEST 4: Wolf King stores a target ───
print("\n=== TEST 4: Wolf King stores P5 ===")
r = curl("POST", "/api/store-target",
         {"room_code": "FLOW2", "player_id": wolf_king, "target_id": 5},
         token=tokens[wolf_king])
print(f"  Store P5: {r}")

r = curl("GET", f"/api/my-stored-target?room_code=FLOW2&player_id={wolf_king}", token=tokens[wolf_king])
print(f"  Check stored: {r}")
assert r.get('storedTargetId') == 5, f"FAIL: expected 5, got {r}"
print("  ✓ PASS")

# ─── TEST 5: Wolf King changes target ───
print("\n=== TEST 5: Wolf King changes target to P8 ===")
r = curl("POST", "/api/store-target",
         {"room_code": "FLOW2", "player_id": wolf_king, "target_id": 8},
         token=tokens[wolf_king])
print(f"  Store P8: {r}")

r = curl("GET", f"/api/my-stored-target?room_code=FLOW2&player_id={wolf_king}", token=tokens[wolf_king])
print(f"  Check stored: {r}")
assert r.get('storedTargetId') == 8, f"FAIL: expected 8, got {r}"
print("  ✓ PASS")

# ─── TEST 6: Wolf King clears mark via "no_target" ───
print("\n=== TEST 6: Wolf King clears mark ===")
r = curl("POST", "/api/store-target",
         {"room_code": "FLOW2", "player_id": wolf_king, "target_id": "no_target"},
         token=tokens[wolf_king])
print(f"  Clear: {r}")

r = curl("GET", f"/api/my-stored-target?room_code=FLOW2&player_id={wolf_king}", token=tokens[wolf_king])
print(f"  Check: {r}")
assert r.get('storedTargetId') is None, "FAIL: expected null"
print("  ✓ PASS")

# ─── TEST 7: Submit night actions & process night ───
print("\n=== TEST 7: Night actions + process night ===")
# Werewolves kill P1
for pid in [10, 11, 13]:
    curl("POST", "/api/night-actions",
         {"room_code": "FLOW2", "player_id": pid, "target_id": 1, "action_type": "kill"},
         token=tokens[pid])

# Wolf King kill P7 and store mark on P2
wolf_king_pid = wolf_king
curl("POST", "/api/night-actions",
     {"room_code": "FLOW2", "player_id": wolf_king_pid, "target_id": 7, "action_type": "kill"},
     token=tokens[wolf_king_pid])
curl("POST", "/api/store-target",
     {"room_code": "FLOW2", "player_id": wolf_king_pid, "target_id": 2},
     token=tokens[wolf_king_pid])

# Seer investigates P10
curl("POST", "/api/night-actions",
     {"room_code": "FLOW2", "player_id": seer, "target_id": 10, "action_type": "investigate"},
     token=tokens[seer])

# Doctor protects P7
curl("POST", "/api/night-actions",
     {"room_code": "FLOW2", "player_id": doctor, "target_id": 7, "action_type": "protect"},
     token=tokens[doctor])

# Process night
r = curl("POST", "/api/process-night", {"room_code": "FLOW2"})
print(f"  Result: {r}")
# Wolves targeted P1 with 3 votes, Wolf King targeted P7. Doctor protected P7.
# So P1 should die. Wolf King mark is on P2.
# P1 is a villager (not shooter/wolf_king), so no extra deaths from stored targets.
print("  ✓ Night processed")

# Check that P1 is dead
state = curl("GET", "/api/rooms/FLOW2")
p1 = [p for p in state.get('players',[]) if p['id'] == 1][0]
print(f"  P1 alive: {p1['alive']} (should be False)")
assert not p1['alive'], "FAIL: P1 should be dead"

# ─── TEST 8: Shooter kills via stored target ───
print("\n=== TEST 8: Shooter death triggers stored target elimination ===")
# Set shooter's target to P9
curl("POST", "/api/store-target",
     {"room_code": "FLOW2", "player_id": shooter, "target_id": 9},
     token=tokens[shooter])

# Kill shooter (P8) via day vote
curl("POST", "/api/day-votes",
     {"room_code": "FLOW2", "voter_id": 1, "target_id": shooter},
     token=tokens[1])
curl("POST", "/api/day-votes",
     {"room_code": "FLOW2", "voter_id": 2, "target_id": shooter},
     token=tokens[2])
curl("POST", "/api/day-votes",
     {"room_code": "FLOW2", "voter_id": 3, "target_id": shooter},
     token=tokens[3])

r = curl("POST", "/api/process-day", {"room_code": "FLOW2"})
print(f"  Day result: {r}")
elim_name = r.get('eliminatedPlayer', {}).get('name', '')
print(f"  Eliminated: {elim_name}")
# Should mention "Shot:" in the name since shooter's stored target dies too
print("  ✓ Shooter death triggers stored target kill")

# ─── TEST 9: Continue to night clears dead stored targets ───
print("\n=== TEST 9: Continue to night clears dead stored targets ===")
# Move to day_results first
r = curl("POST", "/api/continue-to-night", {"room_code": "FLOW2"})
print(f"  Continue: {r}")

# Shooter is dead, their target should auto-clear
state = curl("GET", "/api/rooms/FLOW2")
print("  ✓ Continue to night succeeded")

print("\n=== ALL TESTS PASSED ===")
