import subprocess, json

API = "https://mafia-game.lionbabycrypto.workers.dev"

# All player tokens for TEST42
tokens_list = [
    "yEeGL7Yi0L3bsjY5v8g7lHPRCHrDLLaE",
    "SJlCQKi6Ffh5SkmEpeWVSlFPYv49ZPhW",
    "In7WAtZodDqbR6FWJLKNb50tzsnURM5G",
    "mV3yHKmNmrQZFlJKxXh1xhTt7lsPMFNI",
    "Cp2LauPLhTdd1wHRfqjROHii2DnyZ2sO",
    "nojbZ1iXNPZFnU9vj2tQRQOZFoNc5FFz",
    "NfFO3htUoZJ2Cve4qR5ac0ldlN6Gvywq",
    "9PxDcJVIXV6vKSFXQ7nQlhRHHrVoqcJ1",
    "zYfrRfdfs2hr6k9YgqWNKLalPqO3WnZG",
    "wCKUQvIr0hky4Bq3RzNgvKqIQ54OfqH6",
    "pVnS78goDm6AZdCye3UenJ6r1ZgsFWD9",
    "minoZUhB2KzwIBVVjYSqvhnO6UK3k3Zq",
    "JAEMDyQbkmFbEKCYnnHJSXDWXQtRIfgx",
    "KdxxYZtvy6qkLBNej3Tf5tAuLFdxkJQ9",
]

print("=== Role Check ===")
for pid in range(1, 15):
    tok = tokens_list[pid-1]
    r = subprocess.run(
        ["curl", "-s", f"{API}/api/player-roles?room_code=TEST42&player_id={pid}",
         "-H", f"Authorization: Bearer *** capture_output=True, text=True)
    try:
        d = json.loads(r.stdout)
        role = d.get('role', '?')
        name = d.get('name', '?')
        print(f"P{pid} ({name}): {role}")
    except:
        print(f"P{pid}: ERROR {r.stdout[:100]}")

print("\n=== Shooter test ===")
# Find who is shooter
shooter_pid = None
for pid in range(1, 15):
    tok = tokens_list[pid-1]
    r = subprocess.run(
        ["curl", "-s", f"{API}/api/player-roles?room_code=TEST42&player_id={pid}",
         "-H", f"Authorization: Bearer *** capture_output=True, text=True)
    try:
        d = json.loads(r.stdout)
        if d.get('role') == 'shooter':
            shooter_pid = pid
            shooter_name = d.get('name','?')
            shooter_tok = tok
            print(f"Shooter is P{pid} ({shooter_name})")
            break
    except:
        pass

if shooter_pid:
    # Store target via /api/store-target
    r = subprocess.run(
        ["curl", "-s", "-X", "POST", f"{API}/api/store-target",
         "-H", "Content-Type: application/json",
         "-H", f"Authorization: Bearer *** "-d", json.dumps({"room_code":"TEST42","player_id":shooter_pid,"target_id":"no_target"})],
        capture_output=True, text=True)
    print(f"Store 'No Target': {r.stdout}")

    # Store target P3
    r = subprocess.run(
        ["curl", "-s", "-X", "POST", f"{API}/api/store-target",
         "-H", "Content-Type: application/json",
         "-H", f"Authorization: Bearer *** "-d", json.dumps({"room_code":"TEST42","player_id":shooter_pid,"target_id":3})],
        capture_output=True, text=True)
    print(f"Store target P3: {r.stdout}")

    # Check stored target
    r = subprocess.run(
        ["curl", "-s", f"{API}/api/my-stored-target?room_code=TEST42&player_id={shooter_pid}",
         "-H", f"Authorization: Bearer *** capture_output=True, text=True)
    print(f"My stored target: {r.stdout}")

# Find player who stores the token securely
tok_secure = tokens_list[shooter_pid-1] if shooter_pid else None
print(f"\nShooter PID: {shooter_pid}")
print(f"Shooter token: {tok_secure[:10]}...")
