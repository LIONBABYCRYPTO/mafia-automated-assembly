import requests, json, io, uuid

with open('/tmp/cf_token.txt') as f:
    token = f.read().strip()

ACCOUNT = '1e344b17f9e359523dcdbf6c7f229ccf'
headers = {'Authorization': f'Bearer {token}'}

with open('/Users/lordy/projects/mafia-automated-assembly/worker-fetch.js') as f:
    source = f.read()

lines = source.split('\n')

# Find the export default body
ed_line = None
br_start = None
br_end = None
depth = 0
for i, line in enumerate(lines):
    if 'export default' in line:
        ed_line = i
    if ed_line is not None and i > ed_line and '{' in line and br_start is None:
        br_start = i
        depth = 1
    if br_start is not None and i > br_start:
        depth += line.count('{') - line.count('}')
        if depth <= 0:
            br_end = i
            break

body_lines = lines[br_start+1:br_end]
body_lines = [l[4:] if l.startswith('    ') else l for l in body_lines]

# Find try block
try_start = None
try_end = None
for i, line in enumerate(body_lines):
    if 'try {' in line:
        try_start = i
        d = 0
        for j in range(i, len(body_lines)):
            d += body_lines[j].count('{') - body_lines[j].count('}')
            if d <= 0:
                try_end = j
                break
        break

# Extract helper functions
helper_lines = lines[br_end+1:]

# Build clean service-worker script
parts = []
parts.append('// Mafia Game API - Service Worker format')
parts.append('')
parts.append('let GAME_KV;')
parts.append('')
parts.append("addEventListener('fetch', event => {")
parts.append('  event.respondWith(handleRequest(event.request));')
parts.append('});')
parts.append('')

parts.append('async function handleRequest(request) {')
parts.append("  const origin = request.headers.get('Origin') || '*';")
parts.append("  const method = request.method;")
parts.append('')
parts.append("  if (method === 'OPTIONS') {")
parts.append('    return new Response(null, { headers: corsHeaders(origin) });')
parts.append('  }')
parts.append('')
parts.append("  // Rate limiter - 1000ms minimum between POST/PUT/DELETE from same IP")
parts.append("  const rateLimitKey = 'rl:' + (request.headers.get('CF-Connecting-IP') || 'unknown');")
parts.append('  const lastReq = await GAME_KV.get(rateLimitKey);')
parts.append('  const now = Date.now();')
parts.append("  if (method !== 'GET' && lastReq && now - parseInt(lastReq) < 1000) {")
parts.append("    return json({ error: 'Too fast - wait 1s between actions' }, 429, origin);")
parts.append('  }')
parts.append("  if (method !== 'GET') await GAME_KV.put(rateLimitKey, String(now), { expirationTtl: 10 });")
parts.append('')
parts.append('  try {')

# Add body from inside the try block - SKIP the first line if it redeclares const path
skip_first = True
for i in range(try_start + 1, try_end):
    l = body_lines[i]
    if l.startswith('      '):
        l = l[6:]
    elif l.startswith('    '):
        l = l[4:]
    # Skip "const path = url.pathname;" since handleRequest already creates url
    if skip_first and 'const path = url.pathname' in l:
        skip_first = False
        continue
    skip_first = False
    l = l.replace('env.GAME_KV', 'GAME_KV')
    parts.append(l)

parts.append('  } catch (err) {')
parts.append("    return json({ error: err.message || 'Internal error' }, 500, origin);")
parts.append('  }')
parts.append('}')

# Add helper functions
for l in helper_lines:
    l = l.replace('env.GAME_KV', 'GAME_KV')
    if l.strip().startswith('export'):
        continue
    parts.append(l)

sw_code = '\n'.join(parts)

with open('/tmp/worker-sw.js', 'w') as f:
    f.write(sw_code)

# Deploy
boundary = uuid.uuid4().hex
metadata = json.dumps({
    'body_part': 'script',
    'compatibility_date': '2024-12-18',
    'bindings': [{'type': 'kv_namespace', 'name': 'GAME_KV', 'namespace_id': '7714d6c8a40c4a12a3d892ee17a5c8d0'}]
})

body = io.BytesIO()
body.write(('--' + boundary + '\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n' + metadata + '\r\n').encode())
body.write(('--' + boundary + '\r\nContent-Disposition: form-data; name="script"\r\nContent-Type: application/javascript\r\n\r\n').encode())
body.write(sw_code.encode())
body.write(('\r\n--' + boundary + '--\r\n').encode())

r = requests.put(
    'https://api.cloudflare.com/client/v4/accounts/' + ACCOUNT + '/workers/scripts/mafia-game',
    headers={**headers, 'Content-Type': 'multipart/form-data; boundary=' + boundary},
    data=body.getvalue())

res = r.json()
if res.get('success'):
    print('✅ Deployed! Handlers:', res['result'].get('handlers'))
    # Re-enable subdomain
    r2 = requests.post(
        'https://api.cloudflare.com/client/v4/accounts/' + ACCOUNT + '/workers/scripts/mafia-game/subdomain',
        headers=headers, json={'enabled': True})
    print('Subdomain:', '✅' if r2.json().get('success') else '⚠️', r2.status_code)
else:
    print('❌', json.dumps(res.get('errors')))
    # Try valid JS check
    import subprocess
    with open('/tmp/worker-sw.js') as f:
        content = f.read()
    # Use node --check
    r3 = subprocess.run(['node', '--check', '/tmp/worker-sw.js'], capture_output=True, text=True, timeout=5)
    if r3.returncode != 0:
        print('Node check:', r3.stderr[:300])
    else:
        print('Node says OK')
