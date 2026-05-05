# Dev server bind address

**Always bind dev servers to `0.0.0.0`, never to `localhost` / `127.0.0.1` / `::1`.**

This session runs inside a Kubernetes pod. The user's "Open live preview"
link routes through a Service to the pod's port `3000`. A dev server bound
to a loopback address is invisible to that Service — kube-proxy can only
forward traffic to interfaces reachable on the pod's network namespace, and
loopback is not one of them. The result is a 502 from the preview ingress.

The `HOST=0.0.0.0` and `HOSTNAME=0.0.0.0` env vars are pre-set on this
container, which most Node frameworks (Next.js reads `HOSTNAME`, many
Express-based apps read `HOST`) honor automatically. Vite ignores them and
needs an explicit flag.

When you start a dev server, double-check the bind address. Concrete
flags / settings by stack:

| Stack | Right way | Wrong way (binds loopback) |
|---|---|---|
| Next.js | `next dev` (HOSTNAME=0.0.0.0 already set) or `next dev -H 0.0.0.0` | `next dev -H localhost` |
| Vite | `vite --host 0.0.0.0` or `vite --host` | `vite` (defaults to localhost) |
| Express / Fastify / raw Node | `app.listen(3000, '0.0.0.0')` | `app.listen(3000)` (varies — many default to all, but some default to localhost) |
| Rails | `bin/rails s -b 0.0.0.0` | `bin/rails s` (Rails 7+ binds localhost by default) |
| Django | `python manage.py runserver 0.0.0.0:3000` | `python manage.py runserver 3000` |
| Python http.server | `python -m http.server 3000 --bind 0.0.0.0` (or default — it binds 0.0.0.0 already) | n/a |

After starting, **always verify** with:

```sh
ss -tnlp 2>/dev/null || netstat -tnlp 2>/dev/null
```

You want a row showing `0.0.0.0:3000` or `*:3000`. If you see `127.0.0.1:3000`
or `::1:3000`, the preview won't work — restart the server with the right
flag.

Also: the dev server must run as a **persistent background process** that
survives the bash invocation that started it. Use `nohup … &` plus
`disown`, or a process manager (`pm2`, `forever`), or run it under
`tmux`/`screen` if available. Foregrounded servers die when the bash call
returns and the preview goes blank again.
