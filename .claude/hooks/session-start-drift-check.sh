#!/usr/bin/env bash
# SessionStart hook — prevents trusting stale context.
#
# Surfaces, before Claude reads CLAUDE.md or anything else:
#   1. Whether the current branch is behind its origin remote
#   2. Whether origin/main has advanced beyond HEAD (and what landed)
#   3. The "Last updated" date from documents/status-board.md
#
# Never blocks: every command's exit code is suppressed, and the whole script
# returns 0 even when git is offline, there's no remote, status-board.md is
# missing, etc. Output goes to stdout, which Claude Code reads into context.
#
# Background: written 2026-05-16 after a session built F7.7 from scratch
# without realizing it had already shipped from a parallel session.

set +e
cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" 2>/dev/null || exit 0

{
  git fetch origin --quiet 2>/dev/null

  CURRENT=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)

  # Current branch vs its upstream
  if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
    BEHIND_REMOTE=$(git rev-list --count HEAD..@{u} 2>/dev/null || echo 0)
    if [ "${BEHIND_REMOTE:-0}" -gt 0 ]; then
      echo "Local $CURRENT is $BEHIND_REMOTE commits behind origin/$CURRENT."
    fi
  fi

  # Whether origin/main has moved while you were away (skip if already on main —
  # that case is covered by the upstream check above)
  if [ "$CURRENT" != "main" ]; then
    BEHIND_MAIN=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)
    if [ "${BEHIND_MAIN:-0}" -gt 0 ]; then
      echo "origin/main is $BEHIND_MAIN commits ahead of HEAD. Recent main commits:"
      git log HEAD..origin/main --oneline 2>/dev/null | head -10
    fi
  fi

  # Status-board freshness — the line read here is the source of truth, not
  # the "In progress" prose in CLAUDE.md.
  if [ -f documents/status-board.md ]; then
    LU=$(grep -i '^\*\*Last updated:' documents/status-board.md | head -1)
    [ -n "$LU" ] && echo "Status board: $LU"
  fi
} 2>/dev/null

exit 0
