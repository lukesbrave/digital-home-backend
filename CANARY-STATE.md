# Starter 3 isolated canary

Luke authorised this test-site deployment on 2026-11-03. No production domains,
member databases, send credentials, live Stripe keys or scheduled jobs.
Build/deploy only from the dedicated root checkout after committing/pushing this
configuration branch. Bootstrap exists only to establish the two cross-bindings.
All private keys are local ignored files and Worker secrets, never git.

Status: deployed and verified on 2026-11-03 with Luke's approval.

- Deployment root: `/Users/carterzuzu/Projects/starter3-canary-backend`.
- Branch: `codex/starter3-canary-2026-11-03`.
- Deployed application/config commit: `2a9ed7f`; release source: `8e7008c`.
- Cloudflare version: `d6ff4ab4-e145-4448-8b20-0ad473534ff6`.
- URL: https://starter3-canary-backend.luke-9ffworkersdev.workers.dev
- Source test database: `iotldbnwtnzpwpyhwgmo`; recovery remains separate.
- Owner/session, scoped access/approval, authoritative lead capture, Analytics,
  public media and desktop/mobile browser checks passed.
- Test-only Stripe, safe mode on, social off, no mail credentials or crons.
- Full acceptance receipts are committed to Auto Agency's shared PLANS directory.
- Installed Studio runtime upgrade remains a release gate; the read-only file
  preservation audit is not a runtime upgrade proof. No Starter release published.

Later documentation commits record this deployment without redeploying code.
