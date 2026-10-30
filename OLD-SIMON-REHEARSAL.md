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

Correction after isolated repair on 2026-10-30: Docker Desktop launches with
appropriate execution permission; the earlier missing-executable interpretation
was incorrect for Docker. Archived native Buzz binaries and lab images are absent.
The separate Auto Agency worktree `starter3-buzz-rehearsal-2026-10-30` contains
`tools/starter3-buzz-lab`, rebuilding exact archived Buzz source b8aa0233 and
cloning the old home/database/storage. No original lab volume was written.

The selected installed Simon is case 20260910-033002, mission training
2026-09-10.1, model alias sonnet. This is distinct from the October published
source audit above. All 76 training files match the original; manifest SHA-256
`4c5f8938bf095574ecc53d1e07f37eff6d8a16ec308c0401ff2be990a8ba41ab`.
Card/system prompt matches its archived snapshot; SHA-256
`131c71bb74b7188e04713885c764678144ee23b451028ac8b917941c272fca88`.
Cloned database, Redis and storage health checks pass with no host ports.

Saved login status reports present, but an actual tool-free model connection
fails authentication. Luke must personally sign into the isolated cloned home;
see the harness README. No production login may be copied to bypass this.
The actual old-Simon upgrade/recovery conversation remains NOT RUN. A rebuilt
container relay/ACP conversation will be real Buzz execution but is distinct
from native desktop UI/import acceptance; do not conflate them. No employee
training was changed, and no release was published.

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
