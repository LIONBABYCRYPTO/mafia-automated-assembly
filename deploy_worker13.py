import requests, json, io, uuid, subprocess

with open('/tmp/cf_token.txt') as f:
    token = f.read().strip()
ACCOUNT = '1e344b17f9e359523dcdbf6c7f229ccf'
headers = {'Authorization': f'Bearer {token}'}

with open('/Users/lordy/projects/mafia-automated-assembly/worker-fetch.js') as f:
    source = f.read()

old_start = "export default {\n  async fetch(request, env) {\n    const url = new URL(request.url);\n    const origin = request.headers.get('Origin') || '*';\n    const method = request.method;\n\n    if (method === 'OPTIONS') {\n      return new Response(null, { headers: corsHeaders(origin) });\n    }\n\n    try {\n      const path = url.pathname;"

new_start = """addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin') || '*';
  const method = request.method;

  if (method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin) });
  }

  // Rate limiter - 1000ms between POST/PUT/DELETE from same IP
  try {
    const rateLimitKey = 'rl:' + (request.headers.get('CF-Connecting-IP') || 'unknown');
    const lastReq = await GAME_KV.get(rateLimitKey);
    const now = Date.now();
    if (method !== 'GET' && lastReq && now - parseInt(lastReq) < 1000) {
      return json({ error: 'Too fast - wait 1s between actions' }, 429, origin);
    }
    if (method !== 'GET') await GAME_KV.put(rateLimitKey, String(now), { expirationTtl: 10 });
  } catch(e) {}

  try {
    const path = url.pathname;"""

old_end_sub = "\n    } catch (err) {\n      return json({ error: err.message || 'Internal error' }, 500, origin);\n    }\n  }\n};"

new_end_sub = "\n  } catch (err) {\n    return json({ error: err.message || 'Internal error' }, 500, origin);\n  }\n}"

sw = source.replace(old_start, new_start, 1)
sw = sw.replace(old_end_sub, new_end_sub, 1)
sw = sw.replace('env.GAME_KV', 'GAME_KV')

with open('/tmp/worker-sw.js', 'w') as f:
    f.write(sw)

r = subprocess.run(['node', '--check', '/tmp/worker-sw.js'], capture_output=True, text=True, timeout=5)
if r.returncode != 0:
    print('Syntax error:', r.stderr[:300])
else:
    print('✅ JS valid')
    boundary = uuid.uuid4().hex
    metadata = json.dumps({'body_part': 'script', 'compatibility_date': '2024-12-18', 'bindings': [{'type': 'kv_namespace', 'name': 'GAME_KV', 'namespace_id': '7714d6c8a40c4a12a3d892ee17a5c8d0'}]})
    body_b = io.BytesIO()
    body_b.write(('--' + boundary + '\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n' + metadata + '\r\n').encode())
    body_b.write(('--' + boundary + '\r\nContent-Disposition: form-data; name="script"\r\nContent-Type: application/javascript\r\n\r\n').encode())
    body_b.write(sw.encode())
    body_b.write(('\r\n--' + boundary + '--\r\n').encode())
    r2 = requests.put(f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/workers/scripts/mafia-game',
        headers={**headers, 'Content-Type': 'multipart/form-data; boundary=' + boundary}, data=body_b.getvalue())
    res = r2.json()
    if res.get('success'):
        print('✅ Deployed!')
        requests.post(f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/workers/scripts/mafia-game/subdomain',
                     headers=headers, json={'enabled': True})
        import time; time.sleep(3)
        for test_path, test_method, test_body in [
            ('/api/rooms', 'POST', {'room_code': 'RLTEST'}),
            ('/api/rooms/RLTEST', 'GET', None),
            ('/api/players', 'POST', {'room_code': 'RLTEST', 'name': 'Test'}),
        ]:
            if test_method == 'POST':
                r3 = requests.post(f'https://mafia-game.lionbabycrypto.workers.dev{test_path}', json=test_body)
            else:
                r3 = requests.get(f'https://mafia-game.lionbabycrypto.workers.dev{test_path}')
            print(f'  {test_method} {test_path}: {r3.status_code} {r3.text[:100]}')
    else:
        print('❌', json.dumps(res.get('errors')))
