# Starter 3 isolated canary

Luke authorised this test-site deployment on 2026-11-03. No production domains,
member databases, send credentials, live Stripe keys or scheduled jobs.
Build/deploy only from the dedicated root checkout after committing/pushing this
configuration branch. Bootstrap exists only to establish the two cross-bindings.
All private keys are local ignored files and Worker secrets, never git.

Status: configuration prepared; not deployed.
