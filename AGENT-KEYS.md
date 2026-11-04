# Agent keys — Starter 3.0

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
Current signed-HTTP coverage: discovery, Analytics, events and Money. MCP
separately exposes the reviewed tools documented in MCP.md. Other signed-HTTP
module routes remain unavailable to minted keys; do not migrate a legacy agent to a new key
until all routes it uses are supported and verified. An events-only key cannot
read leads, perform payments, mint keys or invoke worker ticks.

Tests execute the actual auth module with synthetic credentials and provider
boundaries. They cover old signing without database access, minted self-signing,
wrong signatures, route confinement and unchanged owner login. They do not
substitute for the actual unchanged-Simon rehearsal required before release.

Owner approval management is a separate signed master/admin control plane,
documented in APPROVALS.md. It is not granted by approvals:propose or by naming
an employee key “owner”. Keep that credential confined to the owner-authorised
connection; decisions require the owner's explicit instruction for that proposal.
