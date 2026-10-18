# Security

## Trust model

The bridge runs inside the dsh process and executes tools with the permissions
granted to that process. The extension is a client; it cannot escalate beyond
the bridge's own capabilities.

## Transport

- `stdio` is the default. The process is created by the extension and inherits
  its lifetime; no network listener exists.
- `tcp` and `unix` require a token. The first request must be `auth`; the
  comparison uses `timingSafeEqual` and rejects length mismatches early.
- A missing token is a startup error, not a warning: an unauthenticated listener
  is never started.

## Secrets

Provider keys are written to the harness credential service and referenced from
settings by name (`DSH_RPC_KEY_<PROVIDER>`). The RPC surface exposes only
`hasKey`; key material is never returned. If the credential service is
unavailable, keys fall back to process environment variables and are lost on
restart.

## File access

`file.*` and message attachments resolve paths with `realpath` and then check
containment in a registered workspace. Absolute paths are required, so a
relative path cannot be interpreted against an unexpected directory. Reads are
capped at 8 MiB.

## Webview

The chat page runs with a nonce-based CSP:

- no remote scripts;
- `style-src` allows inline styles because the built CSS is inlined;
- `cspSource` is used instead of `'self'` so Remote-SSH resource proxying keeps
  working;
- built assets are inlined, so the page does not depend on external resource
  loading.

## Reporting

Report vulnerabilities privately to the maintainers rather than in a public
issue. Include the version, the transport used, and a minimal reproduction.
