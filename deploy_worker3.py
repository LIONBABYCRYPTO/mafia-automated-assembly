import requests, json, io, uuid, re

with open('/tmp/cf_token.txt') as f:
    token = f.read().strip()

ACCOUNT = '1e344b17f9e359523dcdbf6c7f229ccf'
headers = {'Authorization': f'Bearer {token}'}

with open('/Users/lordy/projects/mafia-automated-assembly/worker-fetch.js') as f:
    source = f.read()

# Convert to clean service-worker format
# Strategy: extract the fetch handler body, wrap in addEventListener

# The original has:
# export default {
#   async fetch(request, env) {
#     ...body...
#   }
# };
# plus helper functions after

# Extract the fetch body (lines after "async fetch(request, env) {" until the "};" line)
lines = source.split('\n')
fetch_start = None
fetch_end = None
for i, line in enumerate(lines):
    if 'async fetch(request, env)' in line:
        fetch_start = i + 1  # start after this line
    if fetch_start and line.strip() == '};' and i > fetch_start:
        fetch_end = i
        break

if not fetch_start or not fetch_end:
    print('Could not find fetch boundaries')
    exit(1)

# The try block might be the core - extract from "try {" to closing "}"
try_start = None
try_end = None
depth = 0
for i in range(fetch_start, fetch_end):
    line = lines[i]
    if 'try {' in line:
        try_start = i + 1
        depth = 1
    elif try_start is not None:
        depth += line.count('{') - line.count('}')
        if depth <= 0:
            try_end = i
            break

# Extract helper functions (everything after the export default block)
helper_start = fetch_end + 1  # after the closing };

# Build service-worker script
result = []
result.append('// Mafia Game API - Service Worker format')
result.append('// Auto-converted from ES module')
result.append('')
result.append('let GAME_KV; // KV binding set globally')
result.append('')
result.append("addEventListener('fetch', event => {")
result.append('  event.respondWith(handleRequest(event.request));')
result.append('});')
result.append('')
result.append('async function handleRequest(request) {')
result.append('  const url = new URL(request.url);')
result.append('  const origin = request.headers.get(\'Origin\') || \'*\';')
result.append('  const method = request.method;')
result.append('')
result.append('  if (method === \'OPTIONS\') {')
result.append('    return new Response(null, { headers: corsHeaders(origin) });')
result.append('  }')
result.append('')
result.append('  // Rate limiter - 1000ms minimum between POST/PUT/DELETE from same IP')
result.append('  const rateLimitKey = \'rl:\' + (request.headers.get(\'CF-Connecting-IP\') || \'unknown\');')
result.append('  const lastReq = await GAME_KV.get(rateLimitKey);')
result.append('  const now = Date.now();')
result.append('  if (method !== \'GET\' && lastReq && now - parseInt(lastReq) < 1000) {')
result.append("    return json({ error: 'Too fast - wait 1s between actions' }, 429, origin);")
result.append('  }')
result.append('  if (method !== \'GET\') await GAME_KV.put(rateLimitKey, String(now), { expirationTtl: 10 });')
result.append('')
result.append('  try {')
result.append('    const path = url.pathname;')

# Add the body from the original try block
for i in range(try_start, try_end - 1):  # exclude the final empty line
    result.append(lines[i])

result.append('    } catch (err) {')
result.append('      return json({ error: err.message || \'Internal error\' }, 500, origin);')
result.append('    }')
result.append('  }')
result.append('')

# Add helper functions
for i in range(helper_start, len(lines)):
    # Fix env references
    line = lines[i]
    # env.GAME_KV -> GAME_KV  (but not in comments)
    if 'env.GAME_KV' in line:
        line = line.replace('env.GAME_KV', 'GAME_KV')
    # The json and corsHeaders functions already don't use env
    result.append(line)

# Remove any remaining 'export default' references
sw_script = '\n'.join(result)
sw_script = sw_script.replace('};', '}', 1)  # Only the first one

# Save for debugging
with open('/tmp/worker-sw.js', 'w') as f:
    f.write(sw_script)

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
body.write(sw_script.encode())
body.write(('\r\n--' + boundary + '--\r\n').encode())

r = requests.put(
    'https://api.cloudflare.com/client/v4/accounts/' + ACCOUNT + '/workers/scripts/mafia-game',
    headers={**headers, 'Content-Type': 'multipart/form-data; boundary=' + boundary},
    data=body.getvalue())

res = r.json()
if res.get('success'):
    print('✅ Deployed! Handlers:', res['result'].get('handlers'))
else:
    print('❌', json.dumps(res.get('errors')))
    print('Line check of generated script...')
    # Check common syntax issues
    lines2 = sw_script.split('\n')
    for i, l in enumerate(lines2):
        s = l.strip()
        if s in ['}', '};', '{']:
            pass
        elif s.startswith('}') and not s.endswith('{') and not any(x in s for x in ['catch', 'else', 'finally']):
            # Check if this is a closing for something
            pass
    print('Total lines:', len(lines2))
    # Try a JS syntax check
    import subprocess
    r2 = subprocess.run(['node', '-e', 'try { new Function(' + repr(sw_script) + '); console.log("OK") } catch(e) { console.log(e.message) }'],
                       capture_output=True, text=True, timeout=5)
    print('Syntax check:', r2.stdout.strip()[:200])
