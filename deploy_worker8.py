import requests, json, io, uuid, subprocess

with open('/tmp/cf_token.txt') as f:
    token = f.read().strip()

ACCOUNT = '1e344b17f9e359523dcdbf6c7f229ccf'
headers = {'Authorization': f'Bearer {token}'}

with open('/Users/lordy/projects/mafia-automated-assembly/worker-fetch.js') as f:
    source = f.read()

# Replace the export wrapper manually
# Original:
# export default {
#   async fetch(request, env) {
#     const url = ... (4-space indent)
#     
#     if (method === 'OPTIONS') {
#       return new Response(null, { headers: corsHeaders(origin) });
#     }
#
#     try {           (4-space indent)
#       const path = url.pathname;  (6-space indent)
#       ...routes...
#       return json({ error: 'Not found' }, 404, origin);  (6-space)
#     } catch (err) {   (4-space)
#       return json({ error: ... }, 500, origin);  (6-space)
#     }  (4-space)
#   }  (2-space)
# };  (0-space)

old_start = "export default {\n  async fetch(request, env) {\n    const url = new URL(request.url);\n    const origin = request.headers.get('Origin') || '*';\n    const method = request.method;\n\n    if (method === 'OPTIONS') {\n      return new Response(null, { headers: corsHeaders(origin) });\n    }\n\n    try {\n      const path = url.pathname;"

new_start = """let GAME_KV;

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

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

  const path = url.pathname;"""

# Replace
sw = source.replace(old_start, new_start)

# Now fix the bottom: remove '  }\n};' at the end
# The very end of the file should be:
# ...\n      return json({ error: 'Not found' }, 404, origin);\n    } catch (err) {\n      return json({ error: err.message || 'Internal error' }, 500, origin);\n    }\n  }\n};
# We want to change "  }\n};" to "}"

# Remove the last "  }" (closing fetch) and "};" (closing export)
# sw ends with:
# ...
#       return json({ error: 'Not found' }, 404, origin);
#     } catch (err) {              <- original indent 4
#       return json({ error: ... }
#     }                           <- original indent 4
#   }                             <- original indent 2 (closing fetch)
# };                              <- original indent 0 (closing export)
# 
# We want:
# ...
#       return json({ error: 'Not found' }, 404, origin);
#   } catch (err) {               <- indent 2
#     return json({ error: ... }  <- indent 4
#   }                             <- indent 2
# }                               <- indent 0 (closing handleRequest)

# Find the last occurrence of the closing pattern
old_end_sub = "\n    } catch (err) {\n      return json({ error: err.message || 'Internal error' }, 500, origin);\n    }\n  }\n};"

new_end_sub = "\n  } catch (err) {\n    return json({ error: err.message || 'Internal error' }, 500, origin);\n  }\n}"

sw = sw.replace(old_end_sub, new_end_sub)

# Replace env.GAME_KV
sw = sw.replace('env.GAME_KV', 'GAME_KV')

# Verify syntax
with open('/tmp/worker-sw.js', 'w') as f:
    f.write(sw)

r = subprocess.run(['node', '--check', '/tmp/worker-sw.js'], capture_output=True, text=True, timeout=5)
if r.returncode != 0:
    print('Syntax error:', r.stderr[:600])
else:
    print('✅ JS syntax valid (' + str(len(sw.split('\n'))) + ' lines)')
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
        r3 = requests.post(
            'https://api.cloudflare.com/client/v4/accounts/' + ACCOUNT + '/workers/scripts/mafia-game/subdomain',
            headers=headers, json={'enabled': True})
        print('Subdomain:', '✅' if r3.json().get('success') else '⚠️')
        
        # Test the API
        print('Testing...')
        r4 = requests.get('https://mafia-game.lionbabycrypto.workers.dev/api/rooms/TEST01')
        print('API:', r4.status_code, r4.json().get('roomCode', r4.json().get('error', '?')))
    else:
        print('❌', json.dumps(res.get('errors')))
