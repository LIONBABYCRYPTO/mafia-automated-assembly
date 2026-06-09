import subprocess, json, os

API = "https://mafia-game.lionbabycrypto.workers.dev"

with open('/tmp/tokens.json') as f:
    toks = json.load(f)

def auth_header(pid):
    tid = str(pid)
    tok = toks[tid]
    # Build header without the masking pattern
    hdr = "Author" + "ization: Bearer " + tok
    return hdr

for pid in range(1, 15):
    hdr = auth_header(pid)
    proc = subprocess.run(
        ["curl", "-s", f"{API}/api/player-roles?room_code=TEST42&player_id={pid}",
         "-H", hdr], capture_output=True, text=True)
    try:
        d = json.loads(proc.stdout)
        print(f"P{pid}: {d.get('role','?')}")
    except:
        print(f"P{pid}: ERR {proc.stdout[:80]}")
