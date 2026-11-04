# Connect an existing agent to this Home

The owner opens Setup → Manage agent access, creates a named key and selects
only the access needed. Save the key once in the client's secure connection
settings. Never paste it into a chat or store it in a repository. Revoking a key
stops new requests; it cannot undo a request already executing.

Use HTTPS `https://YOUR_HOME/api/mcp`, Streamable HTTP, and `Authorization:
Bearer <key>`. This MCP endpoint is the documented bearer exception to signed
HTTP. Legacy employee keys still use their original signed HTTP routes; no
training update, employee replacement or master-key rotation is required.
The master key is accepted for compatibility, but scoped keys are recommended.

MCP discovery returns the tools that key can use. `home.info` reads version and
actual migration history; `home.guide` describes routes and tools. Capabilities
show code availability; `module_schema.approvals` must be true before tools run.
Apply reviewed migration 008 first. Failure to open the audit trail stops the call.

The tool list covers Home discovery, leads/timeline/notes, pipeline, content
calendar, Brand Playbook, proposals and proposal status. Scope checks happen for
every call, not only discovery. There is no private operator or member-community
integration. No tool approves its own work, publishes, deletes or charges money.

Pipeline moves, article topics and social drafts create approval proposals.
The starter ships no Approvals page. An owner-authorised agent can review the
exact proposal, ask for the owner's decision in Buzz, then use the signed master
HTTP control plane documented in APPROVALS.md. Ordinary scoped/named employee
keys cannot decide; MCP itself exposes no approval-execution tool. Existing
owner sessions remain supported for custom interfaces. Approval claims the
proposal once; repeat decisions refuse. A pipeline change also refuses if the deal moved
since the proposal. Approved articles await writing; social posts remain drafts.
An action stuck in “approved” needs inspection before anyone proposes it again:
a response or receipt failure does not prove the action did not happen.

Keep safe mode on during setup. MCP audit rows may contain business inputs;
only the owner/server can read those tables. The client gets redacted responses.
Keys are Home-specific: keep a separate connection for each client Home and
verify `home.info` before doing client work. Do not reuse global key files across
Homes. The machine-readable guide is the authoritative supported scoped route
list; other signed HTTP routes remain available only to legacy credentials.
