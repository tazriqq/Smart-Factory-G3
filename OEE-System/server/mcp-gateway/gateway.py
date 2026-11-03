# gateway.py  -  Claude from anywhere: the database through MCP (postgres-mcp, read only), behind a login.
#
# postgres-mcp (service postgres-mcp, --access-mode=restricted, user reader) speaks MCP over SSE inside Docker
# only; this gateway is the one way in (mcp.<domain> through the Cloudflare tunnel and the computer's gateway):
#
#   GET  /sse, POST /messages/   MCP, passed on to postgres-mcp, with a valid token only:
#                                - MCP_TOKEN (server/.env): Claude Code / Claude Desktop send it as a header,
#                                  claude mcp add --transport sse oee-db https://mcp.<domain>/sse --header "Authorization: Bearer <MCP_TOKEN>"
#                                - or a token from the OAuth login below (claude.ai: Settings -> Connectors -> Add
#                                  custom connector -> https://mcp.<domain>/sse)
#   OAuth 2.1 for claude.ai: metadata (RFC 9728 / 8414), dynamic client registration (RFC 7591), authorization code
#   with PKCE S256, refresh tokens. /authorize asks for MCP_OWNER_PASSWORD (server/.env), so only you can let a
#   Claude in; 10 wrong passwords from one address in 10 minutes (or 30 in all) block it for 10 minutes.
#   Redirects only to claude.ai / claude.com and this computer (localhost), so a code never goes anywhere else.
#
# Clients and tokens (only their SHA-256) are kept in /state/oauth.json. Log every Claude out: delete that file
# (docker compose exec mcp-gateway rm /state/oauth.json) and restart the gateway.

import asyncio
import base64
import hashlib
import hmac
import html
import json
import os
import secrets
import time
from urllib.parse import urlencode, urlparse

from aiohttp import ClientSession, ClientTimeout, web

UPSTREAM = os.environ.get("UPSTREAM", "http://postgres-mcp:8000")
PUBLIC = os.environ["MCP_PUBLIC_URL"].rstrip("/")          # e.g. https://mcp.rdeewv.click
TOKEN = os.environ.get("MCP_TOKEN", "")
OWNER_PASS = os.environ.get("MCP_OWNER_PASSWORD", "")
STATE = "/state/oauth.json"
ACCESS_S, REFRESH_S, CODE_S = 3600, 90 * 86400, 300
REDIRECT_HOSTS = {"claude.ai", "claude.com", "localhost", "127.0.0.1"}
PORT = 8099

db = {"clients": {}, "tokens": {}}
codes = {}      # code -> {client, redirect, challenge, exp}
misses = {}     # address -> [times of wrong passwords]


def load():
    global db
    try:
        with open(STATE) as f:
            db = json.load(f)
    except (OSError, ValueError):
        db = {"clients": {}, "tokens": {}}


def save():
    now = time.time()
    db["tokens"] = {k: v for k, v in db["tokens"].items() if v["exp"] > now}
    tmp = STATE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(db, f)
    os.replace(tmp, STATE)


def sha(t):
    return hashlib.sha256(t.encode()).hexdigest()


def issue(client):
    """a new access token and refresh token for this client"""
    access, refresh, now = secrets.token_urlsafe(32), secrets.token_urlsafe(32), time.time()
    db["tokens"][sha(access)] = {"kind": "access", "client": client, "exp": now + ACCESS_S}
    db["tokens"][sha(refresh)] = {"kind": "refresh", "client": client, "exp": now + REFRESH_S}
    save()
    return {"access_token": access, "token_type": "Bearer", "expires_in": ACCESS_S, "refresh_token": refresh}


def authorized(request):
    h = request.headers.get("Authorization", "")
    if not h.startswith("Bearer "):
        return False
    t = h[7:].strip()
    if TOKEN and hmac.compare_digest(t, TOKEN):
        return True
    rec = db["tokens"].get(sha(t))
    return bool(rec and rec["kind"] == "access" and rec["exp"] > time.time())


def addr(request):
    return request.headers.get("CF-Connecting-IP") or request.headers.get("X-Real-IP") or request.remote or "?"


def blocked(a):
    now = time.time()
    for k in list(misses):
        misses[k] = [t for t in misses[k] if now - t < 600]
        if not misses[k]:
            del misses[k]
    return len(misses.get(a, [])) >= 10 or sum(len(v) for v in misses.values()) >= 30


def redirect_ok(uri):
    u = urlparse(uri)
    host = u.hostname or ""
    return (u.scheme == "https" and host in REDIRECT_HOSTS) or (u.scheme == "http" and host in ("localhost", "127.0.0.1"))


def unauthorized():
    return web.json_response({"error": "unauthorized"}, status=401, headers={
        "WWW-Authenticate": f'Bearer resource_metadata="{PUBLIC}/.well-known/oauth-protected-resource"'})


# ---------------------------------------------------------------- OAuth

async def protected_resource(_request):
    return web.json_response({"resource": PUBLIC, "authorization_servers": [PUBLIC], "bearer_methods_supported": ["header"]})


async def auth_server(_request):
    return web.json_response({
        "issuer": PUBLIC, "authorization_endpoint": PUBLIC + "/authorize", "token_endpoint": PUBLIC + "/token",
        "registration_endpoint": PUBLIC + "/register", "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"], "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": ["none"]})


async def register(request):
    try:
        m = await request.json()
    except ValueError:
        return web.json_response({"error": "invalid_client_metadata"}, status=400)
    uris = m.get("redirect_uris") or []
    if not isinstance(uris, list) or not uris or not all(isinstance(u, str) and redirect_ok(u) for u in uris):
        return web.json_response({"error": "invalid_redirect_uri", "error_description": "claude.ai, claude.com or localhost only"}, status=400)
    if len(db["clients"]) > 200:
        return web.json_response({"error": "too many clients"}, status=429)
    cid = secrets.token_urlsafe(16)
    name = str(m.get("client_name") or "MCP client")[:80]
    db["clients"][cid] = {"redirect_uris": uris, "name": name, "at": time.time()}
    save()
    return web.json_response({"client_id": cid, "client_name": name, "redirect_uris": uris, "token_endpoint_auth_method": "none",
                              "grant_types": ["authorization_code", "refresh_token"], "response_types": ["code"]}, status=201)


PAGE = """<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Smart Factory · MCP login</title><style>
:root{{color-scheme:light dark;--bg:#f7f7f5;--fg:#1d1d1b;--mut:#6b6b66;--line:#d8d8d2;--acc:#2f6fdb;--bad:#c0392b}}
@media (prefers-color-scheme:dark){{:root{{--bg:#1b1b1a;--fg:#ececea;--mut:#a3a39d;--line:#3a3a37;--acc:#6d9cf0;--bad:#ef7b6e}}}}
body{{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}}
form{{max-width:380px;width:100%;border:1px solid var(--line);border-radius:10px;padding:24px}}h1{{font-size:18px;margin:0 0 4px}}
p{{color:var(--mut);margin:0 0 16px;font-size:13px}}input[type=password]{{width:100%;box-sizing:border-box;padding:10px;border:1px solid var(--line);border-radius:6px;background:transparent;color:inherit;font-size:15px}}
button{{margin-top:14px;width:100%;padding:10px;border:0;border-radius:6px;background:var(--acc);color:#fff;font-size:15px;cursor:pointer}}.err{{color:var(--bad)}}
</style></head><body><form method="post" action="/authorize"><h1>Smart Factory · database (read only)</h1>
<p><b>{name}</b> ขอเข้าอ่าน database ของไลน์ผ่าน MCP · จะส่งกลับไปที่ <b>{host}</b></p>{err}
<label>รหัสเจ้าของ (MCP_OWNER_PASSWORD ใน server/.env)<br><input type="password" name="password" autofocus required></label>
{hidden}<button type="submit">อนุญาต</button></form></body></html>"""


def page(q, name, err=""):
    keep = ("client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "scope", "resource")
    hidden = "".join(f'<input type="hidden" name="{k}" value="{html.escape(str(q.get(k, "")))}">' for k in keep)
    host = urlparse(q.get("redirect_uri", "")).hostname or "?"
    body = PAGE.format(name=html.escape(name), host=html.escape(host), hidden=hidden, err=f'<p class="err">{html.escape(err)}</p>' if err else "")
    return web.Response(text=body, content_type="text/html", headers={"Cache-Control": "no-store", "X-Frame-Options": "DENY"})


def check_request(q):
    """the client and its redirect, or an error text"""
    c = db["clients"].get(q.get("client_id", ""))
    if not c:
        return None, "unknown client_id"
    if q.get("redirect_uri") not in c["redirect_uris"]:
        return None, "redirect_uri is not the registered one"
    if q.get("response_type", "code") != "code" or q.get("code_challenge_method") != "S256" or not q.get("code_challenge"):
        return None, "needs response_type=code and PKCE (S256)"
    return c, ""


async def authorize_get(request):
    q = dict(request.query)
    c, err = check_request(q)
    if not c:
        return web.Response(text=err, status=400)
    return page(q, c["name"])


async def authorize_post(request):
    q = dict(await request.post())
    q["response_type"] = "code"
    c, err = check_request(q)
    if not c:
        return web.Response(text=err, status=400)
    a = addr(request)
    if blocked(a):
        return page(q, c["name"], "ใส่รหัสผิดหลายครั้งเกินไป ลองใหม่ใน 10 นาที")
    if not OWNER_PASS or not hmac.compare_digest(str(q.get("password", "")), OWNER_PASS):
        misses.setdefault(a, []).append(time.time())
        print(f"mcp-gateway: wrong owner password from {a}", flush=True)
        await asyncio.sleep(1)
        return page(q, c["name"], "รหัสไม่ถูกต้อง")
    code = secrets.token_urlsafe(32)
    codes[code] = {"client": q["client_id"], "redirect": q["redirect_uri"], "challenge": q["code_challenge"], "exp": time.time() + CODE_S}
    print(f"mcp-gateway: login allowed for {c['name']} from {a}", flush=True)
    sep = "&" if "?" in q["redirect_uri"] else "?"
    raise web.HTTPFound(q["redirect_uri"] + sep + urlencode({"code": code, **({"state": q["state"]} if q.get("state") else {})}))


async def token(request):
    f = dict(await request.post())
    bad = lambda e, s=400: web.json_response({"error": e}, status=s, headers={"Cache-Control": "no-store"})
    if f.get("grant_type") == "authorization_code":
        rec = codes.pop(f.get("code", ""), None)
        if not rec or rec["exp"] < time.time() or rec["client"] != f.get("client_id") or rec["redirect"] != f.get("redirect_uri"):
            return bad("invalid_grant")
        verifier = f.get("code_verifier", "")
        want = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        if not verifier or not hmac.compare_digest(want, rec["challenge"]):
            return bad("invalid_grant")
        return web.json_response(issue(rec["client"]), headers={"Cache-Control": "no-store"})
    if f.get("grant_type") == "refresh_token":
        key = sha(f.get("refresh_token", ""))
        rec = db["tokens"].get(key)
        if not rec or rec["kind"] != "refresh" or rec["exp"] < time.time() or rec["client"] != f.get("client_id", rec["client"]):
            return bad("invalid_grant")
        del db["tokens"][key]            # a refresh token works once: a new one comes with the new access token
        return web.json_response(issue(rec["client"]), headers={"Cache-Control": "no-store"})
    return bad("unsupported_grant_type")


# ---------------------------------------------------------------- MCP (SSE), passed on

async def sse(request):
    if not authorized(request):
        return unauthorized()
    session = request.app["http"]
    async with session.get(UPSTREAM + "/sse", headers={"Accept": "text/event-stream"}) as up:
        resp = web.StreamResponse(status=up.status, headers={"Content-Type": "text/event-stream", "Cache-Control": "no-cache",
                                                              "X-Accel-Buffering": "no"})
        await resp.prepare(request)
        try:
            async for chunk in up.content.iter_any():
                await resp.write(chunk)
        except (ConnectionResetError, asyncio.CancelledError):
            pass                     # Claude went away: so does its session upstream
        return resp


async def sse_post(request):
    # a client trying the newer streamable HTTP first: say who may come in (401), else that this server is SSE (405)
    return unauthorized() if not authorized(request) else web.Response(status=405, headers={"Allow": "GET"})


async def messages(request):
    if not authorized(request):
        return unauthorized()
    body = await request.read()
    async with request.app["http"].post(UPSTREAM + "/messages/", params=request.query, data=body,
                                        headers={"Content-Type": request.headers.get("Content-Type", "application/json")}) as up:
        return web.Response(status=up.status, body=await up.read(), content_type=up.content_type)


async def start(app):
    app["http"] = ClientSession(timeout=ClientTimeout(total=None, sock_connect=5))


async def stop(app):
    await app["http"].close()


def main():
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    load()
    app = web.Application(client_max_size=1024 * 1024)
    app.on_startup.append(start)
    app.on_cleanup.append(stop)
    r = app.router
    r.add_get("/.well-known/oauth-protected-resource", protected_resource)
    r.add_get("/.well-known/oauth-protected-resource/{tail:.*}", protected_resource)
    r.add_get("/.well-known/oauth-authorization-server", auth_server)
    r.add_get("/.well-known/oauth-authorization-server/{tail:.*}", auth_server)
    r.add_get("/.well-known/openid-configuration", auth_server)
    r.add_post("/register", register)
    r.add_get("/authorize", authorize_get)
    r.add_post("/authorize", authorize_post)
    r.add_post("/token", token)
    r.add_get("/sse", sse)
    r.add_post("/sse", sse_post)
    r.add_post("/messages/", messages)
    print(f"mcp-gateway: listening on {PORT}, public {PUBLIC}, static token {'on' if TOKEN else 'off'}, "
          f"OAuth login {'on' if OWNER_PASS else 'off (MCP_OWNER_PASSWORD empty)'}", flush=True)
    web.run_app(app, port=PORT, print=None)


if __name__ == "__main__":
    main()
