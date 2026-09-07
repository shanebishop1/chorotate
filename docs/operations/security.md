# Security

- Production access requires a valid Google session and an active household allowlist entry with the same normalized email and user ID. State-changing requests must come from the configured origin.
- Local sign-in exists only in Vite development builds on `127.0.0.1`, with `APP_ENV=local`, `LOCAL_AUTH_ENABLED=true`, and SMS disabled. Production builds cannot enable it. Do not expose the development server through a tunnel or proxy.
- Keep phone numbers, consent, and suppression state in D1 only. Do not put them in source, logs, screenshots, or browser payloads.
- Store `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `TEXTBELT_API_KEY` with `wrangler secret put`, never in Git or local environment examples.
- Production bootstrap and contact scripts accept private mode-`0600` files and use temporary mode-`0600` SQL/config files. Deploy and verification commands suppress provider output and do not print private values.
- CI runs without production credentials. `npm run doctor` and `npm run scan:secrets` check for unsafe tracked files and known secret patterns.

If a secret is exposed, rotate it with its provider, revoke affected sessions, and rerun the release checks. See the [operator runbook](operator-runbook.md) for setup and deployment.
