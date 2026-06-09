import requests, json, io, uuid

with open('/tmp/cf_token.txt') as f:
    token = f.read().strip()

ACCOUNT = '1e344b17f9e359523dcdbf6c7f229ccf'
headers = {'Authorization': f'Bearer {token}'}

with open('/Users/lordy/projects/mafia-automated-assembly/worker-fetch.js') as f:
    source = f.read()

lines = source.split('\n')

# Extract the body: lines 14 to 366 (inside try/catch)
# Line 13:     try {
# Line 14-363: body  
# Line 364:     } catch (err) {
# Line 365:       return json...  
# Line 366:     }
# Line 367:   }  -- closing brace of fetch handler

# Body is lines 14 to 363 inclusive (before the } catch)
body = lines[13:363]  # 0-indexed, so line 14 -> index 13
# Remove leading 6 spaces
body = [l[6:] if l.startswith('      ') else l for l in body]

# Add the final Not found return + closing (lines 362-366 are in body)
# Actually lines 362, 363 are: return json({ error: 'Not found' }, 404, origin); and }
# Lines 364-366 are the catch block

# Build
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
parts.append("  const url = new URL(request.url);")
parts.append("  const origin = request.headers.get('Origin') || '*';")
parts.append("  const method = request.method;")
parts.append('')
parts.append("  if (method === 'OPTIONS') {")
parts.append('    return new Response(null, { headers: corsHeaders(origin) });')
parts.append('  }')
parts.append('')
parts.append("  // Rate limiter - 1000ms between POST/PUT/DELETE from same IP")
parts.append("  const rateLimitKey = 'rl:' + (request.headers.get('CF-Connecting-IP') || 'unknown');")
parts.append('  const lastReq = await GAME_KV.get(rateLimitKey);')
parts.append('  const now = Date.now();')
parts.append("  if (method !== 'GET' && lastReq && now - parseInt(lastReq) < 1000) {")
parts.append("    return json({ error: 'Too fast - wait 1s between actions' }, 429, origin);")
parts.append('  }')
parts.append("  if (method !== 'GET') await GAME_KV.put(rateLimitKey, String(now), { expirationTtl: 10 });")
parts.append('')
parts.append('  try {')

# Add the body (lines 14-363 from original)
for l in body:
    l = l.replace('env.GAME_KV', 'GAME_KV')
    parts.append(l)

# Add catch block
parts.append('  } catch (err) {')
parts.append("    return json({ error: err.message || 'Internal error' }, 500, origin);")
parts.append('  }')
parts.append('}')

# Add helper functions (lines 368+)
for l in lines[368:]:
    l = l.replace('env.GAME_KV', 'GAME_KV')
    if l.strip().startswith('export'):
        continue
    parts.append(l)

sw_code = '\n'.join(parts)

# Check with node
import subprocess
with open('/tmp/worker-sw.js', 'w') as f:
    f.write(sw_code)
r = subprocess.run(['node', '--check', '/tmp/worker-sw.js'], capture_output=True, text=True, timeout=5)
if r.returncode != 0:
    print('Syntax error:', r.stderr[:400])
    # Find the problematic line
    err_match = [l for l in r.stderr.split('\n') if '/tmp/worker-sw.js' in l]
    for em in err_match[:3]:
        print('  ', em)
else:
    print('✅ JS syntax valid')
    # Deploy
    boundary = uuid.uuid4().hex
    metadata = json.dumps({
        'body_part': 'script',
        'compatibility_date': '2024-12-18',
        'bindings': [{'type': 'kv_namespace', 'name': 'GAME_KV', 'namespace_id': '7714d6c8a40c4a12a3d892ee17a5c8d0'}]
    })
    
    body_b = io.BytesIO()
    body_b.write(('--' + boundary + '\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n' + metadata + '\r\n').encode())
    body_b.write(('--' + boundary + '\r\nContent-Disposition: form-data; name="script"\r\nContent-Type: application/javascript\r\n\r\n').encode())
    body_b.write(sw_code.encode())
    body_b.write(('\r\n--' + boundary + '--\r\n').encode())
    
    r2 = requests.put(
        'https://api.cloudflare.com/client/v4/accounts/' + ACCOUNT + '/workers/scripts/mafia-game',
        headers={**headers, 'Content-Type': 'multipart/form-data; boundary=' + boundary},
        data=body_b.getvalue())
    
    res = r2.json()
    if res.get('success'):
        print('✅ Deployed! Handlers:', res['result'].get('handlers'))
        # Re-enable subdomain
        r3 = requests.post(
            'https://api.cloudflare.com/client/v4/accounts/' + ACCOUNT + '/workers/scripts/mafia-game/subdomain',
            headers=headers, json={'enabled': True})
        print('Subdomain:', '✅' if r3.json().get('success') else '⚠️')
    else:
        print('❌', json.dumps(res.get('errors')))
