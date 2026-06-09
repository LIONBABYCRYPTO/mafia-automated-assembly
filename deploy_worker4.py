import requests, json, io, uuid

with open('/tmp/cf_token.txt') as f:
    token = f.read().strip()

ACCOUNT = '1e344b17f9e359523dcdbf6c7f229ccf'
headers = {'Authorization': f'Bearer {token}'}

with open('/Users/lordy/projects/mafia-automated-assembly/worker-fetch.js') as f:
    source = f.read()

# Find the fetch handler body boundaries
lines = source.split('\n')
# Find export default line
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

print(f'export default at line {ed_line}')
print(f'brace start at line {br_start}, end at line {br_end}')

# Extract the body (everything between outer braces of export default)
body_lines = lines[br_start+1:br_end]
# Remove the leading whitespace (4 spaces)
body_lines = [l[4:] if l.startswith('    ') else l for l in body_lines]

# Now body_lines contains the fetch function body (including async fetch...)
# Find the actual inner try block
try_start = None
try_end = None
for i, line in enumerate(body_lines):
    if 'try {' in line:
        try_start = i
        # Count braces from here
        d = 0
        for j in range(i, len(body_lines)):
            d += body_lines[j].count('{') - body_lines[j].count('}')
            if d <= 0:
                try_end = j
                break
        break

print(f'try block: line {try_start} to {try_end}')

# Extract helper functions (everything after the export default block ends)
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

# Write handleRequest
parts.append('async function handleRequest(request) {')
parts.append("  const url = new URL(request.url);")
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
parts.append("    const path = url.pathname;")

# Add body from inside the try block (skip the "try {" line and its closing brace)
for i in range(try_start + 1, try_end):
    l = body_lines[i]
    # Remove leading 6 spaces from the original
    if l.startswith('      '):
        l = l[6:]
    elif l.startswith('    '):
        l = l[4:]
    # Replace env.GAME_KV with GAME_KV
    l = l.replace('env.GAME_KV', 'GAME_KV')
    parts.append(l)

parts.append('  } catch (err) {')
parts.append("    return json({ error: err.message || 'Internal error' }, 500, origin);")
parts.append('  }')
parts.append('}')

# Add helper functions
for l in helper_lines:
    l = l.replace('env.GAME_KV', 'GAME_KV')
    # Skip if just empty or export related
    if l.strip().startswith('export'):
        continue
    parts.append(l)

sw_code = '\n'.join(parts)

# Save
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
    print('Now re-enabling workers.dev route (may need dashboard)...')
    # Try re-enabling subdomain
    r2 = requests.post(
        'https://api.cloudflare.com/client/v4/accounts/' + ACCOUNT + '/workers/scripts/mafia-game/subdomain',
        headers=headers,
        json={'enabled': True})
    print('Subdomain re-enable:', r2.status_code, r2.json().get('success'))
else:
    print('❌', json.dumps(res.get('errors')))
    print('First 10 lines of generated script:')
    for l in sw_code.split('\n')[:10]:
        print(f'  {l}')
