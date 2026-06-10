#!/usr/bin/env python3
"""Verify player-roles endpoint returns roles after game start"""
import subprocess, json

API = "https://mafia-game.lionbabycrypto.workers.dev"

r1 = json.loads(subprocess.run(["curl", "-s", "-X", "POST", API+"/api/rooms", "-d", "{}"], capture_output=True, text=True).stdout)
ROOM = r1["room_code"]
print("Room:", ROOM)

players = {}
for n in ["Doc","W1","W2","V1","V2","V3"]:
    r = json.loads(subprocess.run(["curl", "-s", "-X", "POST", API+"/api/join", "-d", '{"room_code":"'+ROOM+'","name":"'+n+'"}'], capture_output=True, text=True).stdout)
    players[n] = r

subprocess.run(["curl", "-s", "-X", "POST", API+"/api/assign-roles", "-d", '{"room_code":"'+ROOM+'","wolf_count":2}'], capture_output=True, text=True)

# Try player-roles with Bearer token
for n in players:
    pid = players[n]["player_id"]
    tok = players[n]["user_token"]
    # Build auth header manually (no f-strings to avoid *** corruption)
    prefix = "Authorization: Bearer ***
    hdr_value = prefix + tok
    cmd = ["curl", "-s", API+"/api/player-roles?room_code="+ROOM+"&player_id="+str(pid), "-H", hdr_value]
    r = subprocess.run(cmd, capture_output=True, text=True)
    try:
        d = json.loads(r.stdout)
        role = d.get("role")
        players[n]["role"] = role
        print(" " + n + " (" + str(pid) + "): " + str(role))
    except:
        print(" " + n + ": parse error: " + r.stdout[:100])
