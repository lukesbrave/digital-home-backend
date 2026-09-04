# Agent rules

Read `CLAUDE.md` for setup, architecture and conventions. This file adds the rules for how agents work inside the repo.

## Worktrees

Agents that change files in this repo work in a git worktree, never on the default branch. Keep the worktrees inside the repo so the human's project folder stays exactly as it was handed over.

- Create worktrees at `.worktrees/<task>` inside this repo, never as a sibling folder. `.worktrees/` is gitignored.
- Name the folder after the task, in a few words, e.g. `.worktrees/hero-copy`. One worktree per branch.
- Continuing recent work? Reuse the existing worktree instead of creating another.
- When a branch is merged, remove its worktree and delete the branch in the same turn: `git worktree remove .worktrees/<task> && git branch -d <branch>`.
- Do not run `npm install` inside a worktree unless the task has to build or run tests. Editing and reviewing never need it.
- Never nest a clone or another repo inside a worktree.
