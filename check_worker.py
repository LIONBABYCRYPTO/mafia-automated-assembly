import requests, json, io, uuid

with open('/tmp/cf_token.txt') as f:
    TOKEN = f.read().strip()

ACCOUNT = '1e344b17f9e359523dcdbf6c7f229ccf'
headers = {'Authorization': f'Bearer {TOKEN}'}

# Verify
r = requests.get('https://api.cloudflare.com/client/v4/user/tokens/verify', headers=headers)
v = r.json()
print(f'Verify: {v.get("success")}')

# Get current worker info
r = requests.get(f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/workers/scripts/mafia-game', headers=headers)
if r.status_code == 200:
    d = r.json()
    print(f'Format: {d.get("result",{}).get("worker_format")}  Handlers: {d.get("result",{}).get("handlers")}')
else:
    print(f'GET status: {r.status_code}  Body: {r.text[:200]}')
