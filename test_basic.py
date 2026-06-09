import subprocess, json

API = "https://mafia-game.lionbabycrypto.workers.dev"

# Test basic /api/players endpoint
r = subprocess.run(["curl", "-s", f"{API}/api/players?room_code=TEST42"], capture_output=True, text=True)
try:
    players = json.loads(r.stdout)
    print(f"=== Players ({len(players)}) ===")
    for p in players:
        print(f"P{p['id']}: {p['name']} alive={p['alive']}")
except:
    print(f"ERROR: {r.stdout[:200]}")
