import subprocess, json

API = "https://mafia-game.lionbabycrypto.workers.dev"

# Test create room with no body - just -d '{}'
r = subprocess.run(["curl", "-s", "-X", "POST", API+"/api/rooms", "-d", "{}"], capture_output=True, text=True)
print("Raw stdout:", r.stdout[:200])
print("Raw stderr:", r.stderr[:200])
try:
    d = json.loads(r.stdout)
    print("Parsed keys:", list(d.keys()))
except Exception as e:
    print("Parse error:", e)
