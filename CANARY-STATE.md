# Starter 3 isolated canary

Luke authorised this test-site deployment on 2026-11-03. No production domains,
member databases, send credentials, live Stripe keys or scheduled jobs.
Build/deploy only from the dedicated root checkout after committing/pushing this
configuration branch. Bootstrap exists only to establish the two cross-bindings.
All private keys are local ignored files and Worker secrets, never git.

Status: deployed and verified on 2026-11-04 after Luke explicitly requested removal of the Approvals shell.

- Deployment root: `/Users/carterzuzu/Projects/starter3-canary-backend`.
- Branch: `codex/starter3-canary-2026-11-03`.
- Deployed application/config commit: `c4cb0e4`; release source: `98427fe`.
- Cloudflare version: `fa96b7d7-3741-4cb4-8676-e45769c10b7e`.
- URL: https://starter3-canary-backend.luke-9ffworkersdev.workers.dev
- Source test database: `iotldbnwtnzpwpyhwgmo`; recovery remains separate.
- Owner/session, scoped access/approval, authoritative lead capture, Analytics,
  public media and desktop/mobile browser checks passed.
- Test-only Stripe, safe mode on, social off, no mail credentials or crons.
- Full acceptance receipts are committed to Auto Agency's shared PLANS directory.
- Separate Studio 1.7.2 schema/data/runtime preservation completed on 2026-11-04;
  no Studio was installed into this core canary. No Starter release published.
- Before this deployment, the live build matched `2a9ed7f` and 13 served assets
  matched the root checkout. Luke requested the exact page/navigation removal.
- `/crm/approvals` now returns 404 and the browser shows no Approvals navigation.
  Queue/detail/decision APIs accept admin sessions or the signed master connection;
  scoped/named employee keys cannot approve. Scoped MCP proposals/status remain.
- Deployed synthetic proposal/review/approve/reject, duplicate and signature/key
  refusal checks pass. Audit attributes agent decisions to the agent connection.
  No native Buzz approval plugin or human-chat attestation is claimed.
- Latest core suite: 298 passed; production build passed; no SQL/config changes.
  Screenshot and local/deployed owner-flow receipts are in shared PLANS evidence.

Later documentation commits record this deployment without redeploying code.
