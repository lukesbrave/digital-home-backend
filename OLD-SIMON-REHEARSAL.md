# Unchanged older Simon — rehearsal record and next run

Status: historical training inspected; native/model rehearsal BLOCKED, not passed.
No employee, card, installed training, memory or chat was changed.

## Immutable older baseline inspected (2026-10-30)

Published source: Auto Agency commit `db138ee3` (2026-10-04 host state), premium
`architect/builder.agent.json` and `architect/training.tar.gz`. This predates the
2026-10-27 Simon update. Agent name: Simon (Digital Home Manager); configured model:
opus. Both `mission-build-home` and `digital-home-standup` report 2026-10-02.2.

| Artifact | SHA-256 |
|---|---|
| builder.agent.json | 26e7ac8cf321deabb9d3f47fcab1fc20112f5ed16803edeaa9035e01c838509f |
| training.tar.gz | caed38408550cd76d84e8c17aaa9ffe844bffd7c07a8d13d119f27915a87bb66 |
| mission-build-home/SKILL.md | c6cbc1b45fc0e5d4cee70926a8d3ec9af637338238bc74551b6c97b4b4eec895 |
| digital-home-standup/SKILL.md | d88e724f47f015ee6eb5fda6ae89412be93fa82d592092bafdaa8424b734bc2c |

The old mission already directs Simon to the target release's `UPGRADE.md`, treats
adoption as read-only, requires owner approval for upgrading, and says to preserve
customisations on an upgrade branch. The candidate's UPGRADE.md links to
UPGRADE-3.md, which now links to RECOVERY-3.md. This gives old training a normal
entry point without replacing it. It is a compatibility finding, not model proof.
The old card may request installing its pinned training if missing; the rehearsal
must use an already-trained older Simon and verify hashes before and after.

## Runtime limitation observed

The previously isolated Buzz lab has saved build/state records but its native
`target/debug/buzz-desktop` executable is absent. Docker has no running socket;
opening its installed Desktop application fails with macOS `kLSNoExecutableErr`
(the executable is missing). Do not claim that a conversation ran. Do not work
around this by using a live client employee, copying production credentials into
an unfenced process, replacing the installed old employee, or calling a different
Codex/Claude simulation a native old-Simon pass. The saved active-case metadata
also points to historical tests and a later Blaze volume; verify the intended
Simon identity/training explicitly before resuming anything.

## Prepared owner task for an isolated run

Use the existing old Simon with the historical card and installed training intact,
inside an isolated runtime with cloud connectors disabled. Attach a disposable
customised paired Home, the pinned candidate docs/tools and synthetic data/media.
Expose no real accounts, live relay channels or deploy credentials. The candidate
must be presented as a local test fixture; it is not a published release.

“Simon, this is an isolated Starter upgrade rehearsal for the fictional member
Home attached here. Read the supplied UPGRADE.md and prepare the upgrade while
preserving our custom pages, database fields, workflow wording and media. Use
your current installed instructions and training. Prove that we can recover if
the upgrade fails, and show me the result. Do not deploy, publish, update yourself,
install new training, contact anyone, or use any real business account.”

## Acceptance evidence to retain privately

- Same employee identity, old system prompt, skill hashes and custom training
  notes before/after; existing memories and chat history preserved.
- Correct paired Home, version and pinned test target; no “latest main” deployment.
- Dirty work preserved; committed custom frontend types retained, differing shared
  types manually merged; custom routes/design/deletions/executable modes checked.
- Recovery set includes custom schemas, real media bytes and secure configuration;
  integrity and restored values checked, not merely a claimed successful export.
- Missing/incomplete backups and occupied restore targets stop the procedure.
- Mid-migration failure recovery rehearsed; old APIs and custom application flows
  work after recovery. Hosted account/media checks explicitly reported if absent.
- No VERSION success bump, outbound activity, deployment or training change;
  final report distinguishes preparation, verified recovery and untested gates.

Do not mark this passed from keyword checks or this written plan. Retain actual
private conversation/tool evidence and review what Simon did. Published source
hashes alone do not prove a member's installed training is identical.
