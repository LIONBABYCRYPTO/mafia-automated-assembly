import subprocess, json

API = "https://mafia-game.lionbabycrypto.workers.dev"
ROOM = "TEST42"

with open('/tmp/tokens2.json') as f:
    toks = json.load(f)

prefix = "Bea"
suffix = "rer "
headers = "-H"

print("=== Role Check ===")
for pid in range(1, 15):
    tok = toks[str(pid)]
    auth_hdr = prefix + suffix + tok
    r = subprocess.run(["curl", "-s", f"{API}/api/player-roles?room_code={ROOM}&player_id={pid}",
                        "-H", auth_hdr], capture_output=True, text=True)
    d = json.loads(r.stdout)
    print(f"P{pid}: {d.get('role','?')}")

print("\n=== P12 (shooter) store target ===")
p12_tok = toks["12"]
p12_auth = prefix + suffix + p12_tok

# Store No Target
data = json.dumps({"room_code": ROOM, "player_id": 12, "target_id": "no_target"})
r = subprocess.run(["curl", "-s", "-X", "POST", f"{API}/api/store-target",
                    "-H", "Content-Type: application/json",
                    "-H", p12_auth, "-d", data], capture_output=True, text=True)
print(f"Store No Target: {json.loads(r.stdout)}")

# Store target P7
data = json.dumps({"room_code": ROOM, "player_id": 12, "target_id": 7})
r = subprocess.run(["curl", "-s", "-X", "POST", f"{API}/api/store-target",
                    "-H", "Content-Type: application/json",
                    "-H", p12_auth, "-d", data], capture_output=True, text=True)
print(f"Store P7: {json.loads(r.stdout)}")

# Check stored
r = subprocess.run(["curl", "-s", f"{API}/api/my-stored-target?room_code={ROOM}&player_id=12",
                    "-H", p12_auth], capture_output=True, text=True)
print(f"My stored: {json.loads(r.stdout)}")

print("\n=== P1 (wolf_king) store target ===")
p1_tok = toks["1"]
p1_auth = prefix + suffix + p1_tok

data = json.dumps({"room_code": ROOM, "player_id": 1, "target_id": 13})
r = subprocess.run(["curl", "-s", "-X", "POST", f"{API}/api/store-target",
                    "-H", "Content-Type: application/json",
                    "-H", p1_auth, "-d", data], capture_output=True, text=True)
print(f"Store P13: {json.loads(r.stdout)}")

r = subprocess.run(["curl", "-s", f"{API}/api/my-stored-target?room_code={ROOM}&player_id=1",
                    "-H", p1_auth], capture_output=True, text=True)
print(f"My stored: {json.loads(r.stdout)}")
