import requests, json, io, uuid

with open('/tmp/cf_token.txt') as f:
    token = f.read().strip()

ACCOUNT = '1e344b17f9e359523dcdbf6c7f229ccf'
headers = {'Authorization': f'Bearer {token}'}

with open('/Users/lordy/projects/mafia-automated-assembly/worker-fetch.js') as f:
    source = f.read()

lines = source.split('\n')

# The original structure uses export default { async fetch(...)  { ...body... } };
# The body inside fetch() spans lines 6-367 (after the opening { of fetch)
# Inside that body is: method checks, try { routes... }, catch

# I need lines 14-363 (inside try{}), but the indentation is tricky
# Let me just manually extract the route blocks
# Lines 14-363 include: const declarations + all route if-blocks + return json(not found) + closing }
# All at 6-space indent (4 for fetch body + 2 for try body)

# Actually the simplest approach: just edit the source to be SW format directly
# Replace the wrapper
old_top = "export default {\n  async fetch(request, env) {\n    const url = new URL(request.url);\n    const origin = request.headers.get('Origin') || '*';\n    const method = request.method;\n\n    if (method === 'OPTIONS') {\n      return new Response(null, { headers: corsHeaders(origin) });\n    }\n\n    try {\n      const path = url.pathname;\n"

new_top = """let GAME_KV;

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

let request, env; // for compatibility

async function handleRequest(req) {
  const url = new URL(req.url);
  const origin = req.headers.get('Origin') || '*';
  const method = req.method;

  if (method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(origin) });
  }

  // Rate limiter - 1000ms between POST/PUT/DELETE from same IP
  const rateLimitKey = 'rl:' + (req.headers.get('CF-Connecting-IP') || 'unknown');
  const lastReq = await GAME_KV.get(rateLimitKey);
  const now = Date.now();
  if (method !== 'GET' && lastReq && now - parseInt(lastReq) < 1000) {
    return json({ error: 'Too fast - wait 1s between actions' }, 429, origin);
  }
  if (method !== 'GET') await GAME_KV.put(rateLimitKey, String(now), { expirationTtl: 10 });

  const path = url.pathname;
"""

old_bottom = """      return json({ error: 'Not found' }, 404, origin);
    } catch (err) {
      return json({ error: err.message || 'Internal error' }, 500, origin);
    }
  }
};
"""

new_bottom = """      return json({ error: 'Not found' }, 404, origin);
  } catch (err) {
    return json({ error: err.message || 'Internal error' }, 500, origin);
  }
}
"""

# Replace in source
sw = source.replace(old_top, new_top)
sw = sw.replace(old_bottom, new_bottom)
# Replace env.GAME_KV
sw = sw.replace('env.GAME_KV', 'GAME_KV')
# Remove any other exports
sw = sw.replace('export default {\n', '')

# Write
with open('/tmp/worker-sw.js', 'w') as f:
    f.write(sw)

import subprocess
r = subprocess.run(['node', '--check', '/tmp/worker-sw.js'], capture_output=True, text=True, timeout=5)
if r.returncode != 0:
    print('Syntax error:', r.stderr[:500])
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
    body_b.write(sw.encode())
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
