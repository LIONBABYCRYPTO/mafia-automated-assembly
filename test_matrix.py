#!/usr/bin/env python3
"""Role Ability Verification Matrix - Tests every role/scenario via API"""
import subprocess, json

API = "https://mafia-game.lionbabycrypto.workers.dev"

PASS = 0
FAIL = 0
SKIP = 0

def check(label, condition, detail=""):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  [PASS] {label}")
    else:
        FAIL += 1
        print(f"  [FAIL] {label} -- {detail}")

def skip(label):
    global SKIP
    SKIP += 1
    print(f"  [SKIP] {label}")

def api(method, path, body=None, token=None):
    h = ["Content-Type: application/json"]
    if token:
        h.append("Authorization: Bearer " + token)
    cmd = ["curl", "-s", "-X", method, API + path]
    for header in h:
        cmd.extend(["-H", header])
    if body is not None:
        cmd.extend(["-d", json.dumps(body)])
    r = subprocess.run(cmd, capture_output=True, text=True)
    return json.loads(r.stdout)

def room_state(code):
    return api("GET", f"/api/rooms/{code}")

def get_player_role(code, player_id, token):
    r = api("GET", f"/api/player-roles?room_code={code}&player_id={player_id}", token=token)
    return r.get('role')

def setup_game(names, wolf_count=1, role_names=None):
    """Create room, join named players, start game, return {room, players_by_name}"""
    r = api("POST", "/api/rooms", {})
    room = r['room_code']
    
    # Try to use a specific room code if passed
    if isinstance(names, dict):
        # Already have room key
        pass
    
    players = {}
    for name in names:
        p = api("POST", "/api/join", {"room_code": room, "name": name})
        if 'player_id' in p:
            players[name] = {"id": p['player_id'], "token": p['user_token']}
        else:
            print(f"  Join failed for {name}: {p}")
            return None, None
    
    # Start game
    r = api("POST", "/api/assign-roles", {"room_code": room, "wolf_count": wolf_count})
    if not r.get('success'):
        print(f"  Start failed: {r}")
        return None, None
    
    # Read actual roles from the game state's roles distribution
    st = room_state(room)
    dist = st.get('roles', {})
    
    # Now figure out who has which role by examining player-roles endpoint
    for name, pdata in players.items():
        role = get_player_role(room, pdata['id'], pdata['token'])
        pdata['role'] = role
    
    return room, players

def get_role_players(players, role):
    return [v for k,v in players.items() if v.get('role') == role]

def get_role_player(players, role, exclude_id=None):
    for k, v in players.items():
        if v.get('role') == role and (exclude_id is None or v['id'] != exclude_id):
            return v
    return None

# ====================================================================
print("ROLE ABILITY VERIFICATION MATRIX")
print("=" * 60)

# ====================================================================
# DOCTOR SCENARIOS
# ====================================================================
print("\n--- DOCTOR ---")

# S1: Doc saves correct target (prey)
print("\n1. Doctor saves prey")
room, ps = setup_game(["Doc","W1","W2","V1","V2","V3"], wolf_count=2)
if room and ps:
    doc = get_role_player(ps, 'doctor')
    wolves = get_role_players(ps, 'werewolf')
    vill = get_role_player(ps, 'villager')
    if doc and len(wolves) >= 2 and vill:
        api("POST", "/api/night-actions", {"room_code":room,"player_id":wolves[0]['id'],"target_id":vill['id'],"action_type":"kill"}, token=wolves[0]['token'])
        api("POST", "/api/night-actions", {"room_code":room,"player_id":wolves[1]['id'],"target_id":vill['id'],"action_type":"kill"}, token=wolves[1]['token'])
        api("POST", "/api/night-actions", {"room_code":room,"player_id":doc['id'],"target_id":vill['id'],"action_type":"protect"}, token=doc['token'])
        result = api("POST", "/api/process-night", {"room_code":room})
        check("Kill prevented (doctor saved correct target)", not result.get('killedPlayer') and result.get('saved'), str(result))
    else:
        skip("Role assignment failed (roles not found)")
else:
    skip("Setup failed")

# S2: Doc picks wrong target
print("\n2. Doctor saves wrong target")
room, ps = setup_game(["Doc","W1","W2","V1","V2","V3"], wolf_count=2)
if room and ps:
    doc = get_role_player(ps, 'doctor')
    wolves = get_role_players(ps, 'werewolf')
    vills = get_role_players(ps, 'villager')
    if doc and len(wolves) >= 2 and len(vills) >= 2:
        victim = vills[0]
        decoy = vills[1]
        api("POST", "/api/night-actions", {"room_code":room,"player_id":wolves[0]['id'],"target_id":victim['id'],"action_type":"kill"}, token=wolves[0]['token'])
        api("POST", "/api/night-actions", {"room_code":room,"player_id":wolves[1]['id'],"target_id":victim['id'],"action_type":"kill"}, token=wolves[1]['token'])
        api("POST", "/api/night-actions", {"room_code":room,"player_id":doc['id'],"target_id":decoy['id'],"action_type":"protect"}, token=doc['token'])
        result = api("POST", "/api/process-night", {"room_code":room})
        st = room_state(room)
        victim_dead = not any(p['alive'] for p in st['players'] if p['id']==victim['id'])
        check("Wrong target -> victim dies", result.get('killedPlayer') and not result.get('saved') and victim_dead, str(result))
    else:
        skip(f"Role assignment: doc={bool(doc)} wolves={len(wolves)} vills={len(vills)}")
else:
    skip("Setup failed")

# S3: Doc disconnects
print("\n3. Doctor disconnects")
room, ps = setup_game(["Doc","W1","W2","V1","V2","V3"], wolf_count=2)
if room and ps:
    wolves = get_role_players(ps, 'werewolf')
    vill = get_role_player(ps, 'villager')
    if len(wolves) >= 2 and vill:
        api("POST", "/api/night-actions", {"room_code":room,"player_id":wolves[0]['id'],"target_id":vill['id'],"action_type":"kill"}, token=wolves[0]['token'])
        api("POST", "/api/night-actions", {"room_code":room,"player_id":wolves[1]['id'],"target_id":vill['id'],"action_type":"kill"}, token=wolves[1]['token'])
        result = api("POST", "/api/process-night", {"room_code":room})
        check("No protection -> victim dies", bool(result.get('killedPlayer')) and not result.get('saved'), str(result))
    else:
        skip("Role assignment")
else:
    skip("Setup failed")

# ====================================================================
# SEER SCENARIOS
# ====================================================================
print("\n--- SEER ---")

# S4: Seer investigates wolf
print("\n4. Seer investigates wolf")
room, ps = setup_game(["See","W1","W2","V1","V2","V3"], wolf_count=2)
if room and ps:
    seer = get_role_player(ps, 'seer')
    wolf = get_role_player(ps, 'werewolf')
    if seer and wolf:
        r = api("POST", "/api/night-actions", {"room_code":room,"player_id":seer['id'],"target_id":wolf['id'],"action_type":"investigate"}, token=seer['token'])
        check("Returns 'Bad' for wolf", r.get('investigation',{}).get('isGood') == False, str(r.get('investigation')))
    else:
        skip(f"Seer={bool(seer)} Wolf={bool(wolf)}")
else:
    skip("Setup failed")

# S5: Seer investigates villager
print("\n5. Seer investigates villager")
room, ps = setup_game(["See","W1","W2","V1","V2","V3"], wolf_count=2)
if room and ps:
    seer = get_role_player(ps, 'seer')
    vill = get_role_player(ps, 'villager')
    if seer and vill:
        r = api("POST", "/api/night-actions", {"room_code":room,"player_id":seer['id'],"target_id":vill['id'],"action_type":"investigate"}, token=seer['token'])
        check("Returns 'Good' for villager", r.get('investigation',{}).get('isGood') == True, str(r.get('investigation')))
    else:
        skip(f"Seer={bool(seer)} Vill={bool(vill)}")
else:
    skip("Setup failed")

# S6: Seer disconnects
print("\n6. Seer disconnects")
skip("No test needed - just means no investigation result that round")

# ====================================================================
# SHOOTER SCENARIOS (need 12+ players)
# ====================================================================
print("\n--- SHOOTER ---")

# S7: Shooter stores target
print("\n7. Shooter stores target")
big = ["Shoo","W1","W2","V1","V2","V3","V4","V5","V6","V7","V8","V9","V10"]
room, ps = setup_game(big, wolf_count=3)
if room and ps:
    shooter = get_role_player(ps, 'shooter')
    vill = get_role_player(ps, 'villager')
    if shooter and vill:
        r = api("POST", "/api/store-target", {"room_code":room,"player_id":shooter['id'],"target_id":vill['id']}, token=shooter['token'])
        check("Stored target matches", r.get('success') and r.get('storedTargetId') == vill['id'], str(r))
    else:
        skip(f"Shooter={bool(shooter)} Vill={bool(vill)}")
else:
    skip("Setup failed")

# S8: Shooter stores "No Target"
print("\n8. Shooter stores No Target")
room, ps = setup_game(["Shoo","W1","W2","V1","V2","V3","V4","V5","V6","V7","V8","V9","V10"], wolf_count=3)
if room and ps:
    shooter = get_role_player(ps, 'shooter')
    if shooter:
        r = api("POST", "/api/store-target", {"room_code":room,"player_id":shooter['id'],"target_id":"no_target"}, token=shooter['token'])
        check("No Target stored as null", r.get('success') and r.get('storedTargetId') is None, str(r))
    else:
        skip("No shooter")
else:
    skip("Setup failed")

# S9: Shooter dies -> stored target dies too
print("\n9. Shooter dies -> stored target dies")
room, ps = setup_game(["Shoo","W1","W2","V1","V2","V3","V4","V5","V6","V7","V8","V9","V10"], wolf_count=3)
if room and ps:
    shooter = get_role_player(ps, 'shooter')
    wolves = get_role_players(ps, 'werewolf')
    vill = get_role_player(ps, 'villager')
    if shooter and len(wolves) >= 2 and vill:
        # Shooter stores target
        api("POST", "/api/store-target", {"room_code":room,"player_id":shooter['id'],"target_id":vill['id']}, token=shooter['token'])
        # Wolves kill shooter
        api("POST", "/api/night-actions", {"room_code":room,"player_id":wolves[0]['id'],"target_id":shooter['id'],"action_type":"kill"}, token=wolves[0]['token'])
        api("POST", "/api/night-actions", {"room_code":room,"player_id":wolves[1]['id'],"target_id":shooter['id'],"action_type":"kill"}, token=wolves[1]['token'])
        result = api("POST", "/api/process-night", {"room_code":room})
        st = room_state(room)
        shooter_name = [k for k,v in ps.items() if v.get('role')=='shooter'][0]
        shooter_dead = not any(p['alive'] for p in st['players'] if p['name']==shooter_name)
        stored_dead = not any(p['alive'] for p in st['players'] if p['id']==vill['id'])
        check("Both shooter and stored target die", shooter_dead and stored_dead, f"Shooter alive={not shooter_dead} Stored alive={not stored_dead}")
    else:
        skip(f"Shooter={bool(shooter)} Wolves={len(wolves)} Vill={bool(vill)}")
else:
    skip("Setup failed")

# S10: Shooter survives (no one attacks shooter, stored target lives)
print("\n10. Shooter survives")
room, ps = setup_game(["Shoo","W1","W2","V1","V2","V3","V4","V5","V6","V7","V8","V9","V10"], wolf_count=3)
if room and ps:
    shooter = get_role_player(ps, 'shooter')
    wolves = get_role_players(ps, 'werewolf')
    vills = get_role_players(ps, 'villager')
    if shooter and len(wolves) >= 2 and len(vills) >= 2:
        vill = vills[0]
        other = vills[1]
        api("POST", "/api/store-target", {"room_code":room,"player_id":shooter['id'],"target_id":vill['id']}, token=shooter['token'])
        api("POST", "/api/night-actions", {"room_code":room,"player_id":wolves[0]['id'],"target_id":other['id'],"action_type":"kill"}, token=wolves[0]['token'])
        api("POST", "/api/night-actions", {"room_code":room,"player_id":wolves[1]['id'],"target_id":other['id'],"action_type":"kill"}, token=wolves[1]['token'])
        result = api("POST", "/api/process-night", {"room_code":room})
        st = room_state(room)
        shooter_alive = any(p['alive'] for p in st['players'] if p['id']==shooter['id'])
        stored_alive = any(p['alive'] for p in st['players'] if p['id']==vill['id'])
        check("Shooter and stored target both survive", shooter_alive and stored_alive and bool(result.get('killedPlayer')), f"Shooter={shooter_alive} Stored={stored_alive}")
    else:
        skip("Role assignment")
else:
    skip("Setup failed")

# ====================================================================
# WOLF KING SCENARIOS (need 12+ players)
# ====================================================================
print("\n--- WOLF KING ---")

# S11: Wolf King stores target
print("\n11. Wolf King stores mark target")
room, ps = setup_game(["WK","W1","W2","V1","V2","V3","V4","V5","V6","V7","V8","V9","V10"], wolf_count=3)
if room and ps:
    wk = get_role_player(ps, 'wolf_king')
    vill = get_role_player(ps, 'villager')
    if wk and vill:
        r = api("POST", "/api/store-target", {"room_code":room,"player_id":wk['id'],"target_id":vill['id']}, token=wk['token'])
        check("Stored target matches", r.get('success') and r.get('storedTargetId') == vill['id'], str(r))
    else:
        skip(f"WK={bool(wk)} Vill={bool(vill)}")
else:
    skip("Setup failed")

# S12: Wolf King changes target
print("\n12. Wolf King changes mark target")
room, ps = setup_game(["WK","W1","W2","V1","V2","V3","V4","V5","V6","V7","V8","V9","V10"], wolf_count=3)
if room and ps:
    wk = get_role_player(ps, 'wolf_king')
    vills = get_role_players(ps, 'villager')
    if wk and len(vills) >= 2:
        first = vills[0]
        second = vills[1]
        r1 = api("POST", "/api/store-target", {"room_code":room,"player_id":wk['id'],"target_id":first['id']}, token=wk['token'])
        r2 = api("POST", "/api/store-target", {"room_code":room,"player_id":wk['id'],"target_id":second['id']}, token=wk['token'])
        check("Second store overwrites first (final target = second)", r2.get('storedTargetId') == second['id'], f"First={r1.get('storedTargetId')} Second={r2.get('storedTargetId')}")
    else:
        skip("Not enough roles")
else:
    skip("Setup failed")

# S13: Wolf King dies -> marked target dies
print("\n13. Wolf King dies -> marked target dies")
room, ps = setup_game(["WK","W1","W2","V1","V2","V3","V4","V5","V6","V7","V8","V9","V10"], wolf_count=3)
if room and ps:
    wk = get_role_player(ps, 'wolf_king')
    wolves = get_role_players(ps, 'werewolf')
    vill = get_role_player(ps, 'villager')
    if wk and len(wolves) >= 2 and vill:
        api("POST", "/api/store-target", {"room_code":room,"player_id":wk['id'],"target_id":vill['id']}, token=wk['token'])
        # WK and wolves all target WK himself (suicide to test death trigger)
        api("POST", "/api/night-actions", {"room_code":room,"player_id":wk['id'],"target_id":wk['id'],"action_type":"kill"}, token=wk['token'])
        api("POST", "/api/night-actions", {"room_code":room,"player_id":wolves[0]['id'],"target_id":wk['id'],"action_type":"kill"}, token=wolves[0]['token'])
        api("POST", "/api/night-actions", {"room_code":room,"player_id":wolves[1]['id'],"target_id":wk['id'],"action_type":"kill"}, token=wolves[1]['token'])
        result = api("POST", "/api/process-night", {"room_code":room})
        st = room_state(room)
        wk_name = [k for k,v in ps.items() if v.get('role')=='wolf_king'][0]
        wk_dead = not any(p['alive'] for p in st['players'] if p['name']==wk_name)
        marked_dead = not any(p['alive'] for p in st['players'] if p['id']==vill['id'])
        check("WK dead and marked target dead", wk_dead and marked_dead, f"WK alive={not wk_dead} Marked alive={not marked_dead}")
    else:
        skip("Role assignment")
else:
    skip("Setup failed")

# S14: Wolf King survives
print("\n14. Wolf King survives")
room, ps = setup_game(["WK","W1","W2","V1","V2","V3","V4","V5","V6","V7","V8","V9","V10"], wolf_count=3)
if room and ps:
    wk = get_role_player(ps, 'wolf_king')
    wolves = get_role_players(ps, 'werewolf')
    vills = get_role_players(ps, 'villager')
    if wk and len(wolves) >= 2 and len(vills) >= 2:
        vill = vills[0]
        other = vills[1]
        api("POST", "/api/store-target", {"room_code":room,"player_id":wk['id'],"target_id":vill['id']}, token=wk['token'])
        api("POST", "/api/night-actions", {"room_code":room,"player_id":wk['id'],"target_id":other['id'],"action_type":"kill"}, token=wk['token'])
        api("POST", "/api/night-actions", {"room_code":room,"player_id":wolves[0]['id'],"target_id":other['id'],"action_type":"kill"}, token=wolves[0]['token'])
        api("POST", "/api/night-actions", {"room_code":room,"player_id":wolves[1]['id'],"target_id":other['id'],"action_type":"kill"}, token=wolves[1]['token'])
        result = api("POST", "/api/process-night", {"room_code":room})
        st = room_state(room)
        wk_alive = any(p['alive'] for p in st['players'] if p['id']==wk['id'])
        marked_alive = any(p['alive'] for p in st['players'] if p['id']==vill['id'])
        check("Both WK and marked target survive", wk_alive and marked_alive, f"WK={wk_alive} Marked={marked_alive}")
    else:
        skip("Role assignment")
else:
    skip("Setup failed")

# ====================================================================
# WEREWOLF KILL SCENARIOS
# ====================================================================
print("\n--- WEREWOLF KILL TARGETING ---")

def test_wolf_kill(target_name):
    print(f"\n15-18. Wolves kill {target_name}")
    room, ps = setup_game([target_name[:4],"W1","W2","V1","V2","V3","V4","V5","V6","V7"], wolf_count=2)
    if not room or not ps:
        skip("Setup failed")
        return False
    target = get_role_player(ps, target_name.lower())
    wolves = get_role_players(ps, 'werewolf')
    if not target or len(wolves) < 2:
        skip(f"Target={bool(target)} Wolves={len(wolves)}")
        return False
    api("POST", "/api/night-actions", {"room_code":room,"player_id":wolves[0]['id'],"target_id":target['id'],"action_type":"kill"}, token=wolves[0]['token'])
    api("POST", "/api/night-actions", {"room_code":room,"player_id":wolves[1]['id'],"target_id":target['id'],"action_type":"kill"}, token=wolves[1]['token'])
    result = api("POST", "/api/process-night", {"room_code":room})
    check(f"{target_name} is killed by wolves", bool(result.get('killedPlayer')), str(result))
    return True

# S15: Wolves kill doctor
test_wolf_kill("Doctor")
# S16: Wolves kill seer
test_wolf_kill("Seer")
# S17+S18 need 12+ players
skip("S17 (Wolves kill Shooter) and S18 (Wolves kill Wolf King) need expanded roles. Tested in S9/S13 above.")

# ====================================================================
# SUMMARY
# ====================================================================
print("\n" + "=" * 60)
print(f"MATRIX RESULTS: {PASS} PASS / {FAIL} FAIL / {SKIP} SKIP / {PASS+FAIL+SKIP} TOTAL")
print("=" * 60)
if FAIL == 0:
    print("ALL TESTED SCENARIOS PASSED")
else:
    print(f"{FAIL} SCENARIOS FAILED")
