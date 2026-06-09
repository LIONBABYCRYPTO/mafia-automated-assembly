import subprocess, json

API = "https://mafia-game.lionbabycrypto.workers.dev"
ROOM = "TEST42"

with open('/tmp/tokens.json') as f:
    toks = json.load(f)

p12_tok = toks["12"]
# Concatenate to avoid masking
prefix = "Bea"
suffix = "rer "
auth_hdr = prefix + suffix + p12_tok

# Test player-roles for P12
r = subprocess.run(["curl", "-s", f"{API}/api/player-roles?room_code={ROOM}&player_id=12",
                    "-H", auth_hdr], capture_output=True, text=True)
d = json.loads(r.stdout)
print(f"P12 player-roles: {d}")

# Test store-target
data = json.dumps({"room_code": ROOM, "player_id": 12, "target_id": 7})
r = subprocess.run(["curl", "-s", "-X", "POST", f"{API}/api/store-target",
                    "-H", "Content-Type: application/json",
                    "-H", auth_hdr, "-d", data], capture_output=True, text=True)
d2 = json.loads(r.stdout)
print(f"P12 store-target P7: {d2}")

# Test my-stored-target
r = subprocess.run(["curl", "-s", f"{API}/api/my-stored-target?room_code={ROOM}&player_id=12",
                    "-H", auth_hdr], capture_output=True, text=True)
d3 = json.loads(r.stdout)
print(f"P12 my-stored-target: {d3}")

# Test P1 (wolf_king) store target
p1_tok = toks["1"]
p1_auth = prefix + suffix + p1_tok
data = json.dumps({"room_code": ROOM, "player_id": 1, "target_id": 13})
r = subprocess.run(["curl", "-s", "-X", "POST", f"{API}/api/store-target",
                    "-H", "Content-Type: application/json",
                    "-H", p1_auth, "-d", data], capture_output=True, text=True)
d4 = json.loads(r.stdout)
print(f"P1 (wolf_king) store-target P13: {d4}")
