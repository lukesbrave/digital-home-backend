# Agent keys — Starter 3.0 candidate

Optional owner-managed keys, separate from upgrading an existing Simon.
Existing master/env keys and their signing mode remain valid. Do not rotate them
or enable API_PER_KEY_SIGNING as an upgrade side effect. No employee/card/training
update is required for the legacy protocol.

After reviewed migration 004, the owner can use `/api/settings/agent-keys`:
GET lists metadata, POST accepts `{name, scopes, note?}`, DELETE accepts `id` or
`name`. Only an admin session or signed master key may manage keys. Mint returns
plaintext once; never log the response, paste it into chat or commit it. The DB
stores a hash and a short display prefix. Revocation retains the audit row.

Minted requests sign METHOD:pathname:timestamp:body with the minted key itself.
They still require signatures if a legacy Home explicitly disabled signing.
Scopes are checked centrally against reviewed method/path pairs; unknown routes
are denied. Read the live `/api/home/guide` for supported route/scope pairs.
Current coverage: discovery, Analytics, events and Money. Vocabulary for other
modules is reserved but not yet wired; do not migrate a legacy agent to a new key
until all routes it uses are supported and verified. An events-only key cannot
read leads, perform payments, mint keys or invoke worker ticks.

Tests execute the actual auth module with synthetic credentials and provider
boundaries. They cover old signing without database access, minted self-signing,
wrong signatures, route confinement and unchanged owner login. They do not
substitute for the actual unchanged-Simon rehearsal required before release.
