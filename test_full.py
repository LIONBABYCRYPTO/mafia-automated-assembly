import subprocess, json

API = "https://mafia-game.lionbabycrypto.workers.dev"

with open('/tmp/tokens.json') as f:
    tokens = json.load(f)

print("=== Roles ===")
for pid in range(1, 15):
    tok = tokens[str(pid)]
    r = subprocess.run(
        ["curl", "-s", f"{API}/api/player-roles?room_code=TEST42&player_id={pid}",
         "-H", f"Authorization: Bearer *** capture_output=True, text=True)
    d = json.loads(r.stdout)
    print(f"P{pid}: {d.get('role','?')}")

print("\n=== Shooter /api/store-target test ===")
# Find shooter
shooter_pid = None
shooter_tok = None
for pid in range(1, 15):
    tok = tokens[str(pid)]
    r = subprocess.run(
        ["curl", "-s", f"{API}/api/player-roles?room_code=TEST42&player_id={pid}",
         "-H", f"Authorization: Bearer *** capture_output=True, text=True)
    d = json.loads(r.stdout)
    if d.get('role') == 'shooter':
        shooter_pid = str(pid)
        shooter_tok = tok
        print(f"Found Shooter: P{pid}")
        break

wolf_king_pid = None
wolf_king_tok = None
for pid in range(1, 15):
    tok = tokens[str(pid)]
    r = subprocess.run(
        ["curl", "-s", f"{API}/api/player-roles?room_code=TEST42&player_id={pid}",
         "-H", f"Authorization: Bearer *** capture_output=True, text=True)
    d = json.loads(r.stdout)
    if d.get('role') == 'wolf_king':
        wolf_king_pid = str(pid)
        wolf_king_tok = tok
        print(f"Found Wolf King: P{pid}")
        break

if shooter_pid:
    tok = shooter_tok
    # Store "No Target"
    r = subprocess.run(
        ["curl", "-s", "-X", "POST", f"{API}/api/store-target",
         "-H", "Content-Type: application/json",
         "-H", f"Authorization: Bearer *** = json.dumps({"room_code":"TEST42","player_id":int(shooter_pid),"target_id":"no_target"})
    , "-d", data], capture_output=True, text=True)
    try:
        d = json.loads(r.stdout)
        print(f"Store No Target: {d}")
    except:
        print(f"Store No Target raw: {r.stdout[:200]}")

    # Store target P3
    data = json.dumps({"room_code":"TEST42","player_id":int(shooter_pid),"target_id":3})
    r = subprocess.run(
        ["curl", "-s", "-X", "POST", f"{API}/api/store-target",
         "-H", "Content-Type: application/json",
         "-H", f"Authorization: Bearer *** "-d", data], capture_output=True, text=True)
    print(f"Store target P3: {r.stdout}")

    # Check stored target
    r = subprocess.run(
        ["curl", "-s", f"{API}/api/my-stored-target?room_code=TEST42&player_id={shooter_pid}",
         "-H", f"Authorization: Bearer *** capture_output=True, text=True)
    print(f"My stored target: {r.stdout}")

if wolf_king_pid:
    tok = wolf_king_tok
    # Wolf King stores a target
    data = json.dumps({"room_code":"TEST42","player_id":int(wolf_king_pid),"target_id":5})
    r = subprocess.run(
        ["curl", "-s", "-X", "POST", f"{API}/api/store-target",
         "-H", "Content-Type: application/json",
         "-H", f"Authorization: Bearer *** "-d", data], capture_output=True, text=True)
    print(f"\nWolf King store P5: {r.stdout}")

    # Check stored
    r = subprocess.run(
        ["curl", "-s", f"{API}/api/my-stored-target?room_code=TEST42&player_id={wolf_king_pid}",
         "-H", f"Authorization: Bearer *** capture_output=True, text=True)
    print(f"Wolf King stored: {r.stdout}")
