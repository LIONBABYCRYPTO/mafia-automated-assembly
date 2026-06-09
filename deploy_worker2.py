import requests, json, io, uuid

with open('/tmp/cf_token.txt') as f:
    token = f.read().strip()

ACCOUNT = '1e344b17f9e359523dcdbf6c7f229ccf'
headers = {'Authorization': f'Bearer {token}'}

# Read source
with open('/Users/lordy/projects/mafia-automated-assembly/worker-fetch.js') as f:
    source = f.read()

# Add rate limiter if not present
if 'Rate limiter' not in source:
    rate_block = (
        '    // Rate limiter - 1000ms minimum between POST/PUT/DELETE from same IP\n'
        "    const rateLimitKey = 'rl:' + (request.headers.get('CF-Connecting-IP') || 'unknown');\n"
        '    const lastReq = await env.GAME_KV.get(rateLimitKey);\n'
        '    const now = Date.now();\n'
        "    if (method !== 'GET' && lastReq && now - parseInt(lastReq) < 1000) {\n"
        "      return json({ error: 'Too fast - wait 1s between actions' }, 429, origin);\n"
        '    }\n'
        "    if (method !== 'GET') await env.GAME_KV.put(rateLimitKey, String(now), { expirationTtl: 10 });\n\n"
    )
    source = source.replace(
        "    if (method === 'OPTIONS') {\n      return new Response(null, { headers: corsHeaders(origin) });\n    }\n\n    try {",
        "    if (method === 'OPTIONS') {\n      return new Response(null, { headers: corsHeaders(origin) });\n    }\n" + rate_block + "    try {"
    )

# Convert from ES module to Service Worker format
# Replace: export default { async fetch(request, env) {
# With: addEventListener('fetch', event => { event.respondWith(handleRequest(event.request)); }); async function handleRequest(request) {
# And env becomes a global variable

# Step 1: Replace the export/fetch wrapper
source = source.replace(
    "export default {\n  async fetch(request, env) {",
    "/** Global variable for bindings */\nlet GAME_KV;\n\naddEventListener('fetch', event => {\n  event.respondWith(handleRequest(event.request));\n});\n\nasync function handleRequest(request) {\n  GAME_KV = GAME_KV || undefined;"
)

# Step 2: Remove the closing };\n at the end of export default
# Find the last line which should be "};"
lines = source.split('\n')
for i in range(len(lines)-1, -1, -1):
    if lines[i].strip() == '};':
        lines[i] = '}'
        break
source = '\n'.join(lines)

# Step 3: Replace env.GAME_KV with global GAME_KV
source = source.replace('env.GAME_KV', 'GAME_KV')

# Step 4: For the try block closing, handleRequest already ends with }
# Check the structure
print("Lines with '};':", sum(1 for l in source.split('\n') if l.strip() == '};'))

# Deploy with body_part format
boundary = uuid.uuid4().hex
metadata = json.dumps({
    'body_part': 'script',
    'compatibility_date': '2024-12-18',
    'bindings': [{'type': 'kv_namespace', 'name': 'GAME_KV', 'namespace_id': '7714d6c8a40c4a12a3d892ee17a5c8d0'}]
})

body = io.BytesIO()
body.write(('--' + boundary + '\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n' + metadata + '\r\n').encode())
body.write(('--' + boundary + '\r\nContent-Disposition: form-data; name="script"\r\nContent-Type: application/javascript\r\n\r\n').encode())
body.write(source.encode())
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
    print('Response excerpt:', r.text[:200])
