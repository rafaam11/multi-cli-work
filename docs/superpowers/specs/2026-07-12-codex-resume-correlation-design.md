# Codex Resume Correlation Design

## Problem

Codex creates its transcript asynchronously. The current tracker stops after ten seconds, so a valid Codex tab can be saved without its provider conversation ID and cannot be resumed.

## Decision

Keep the existing `codex resume <conversation-id>` launch command. Extend only the background transcript-correlation window to two minutes (300 polls at 400 ms by default). It still ends immediately when the transcript appears or the app shuts down.

## Verification

Add a tracker regression test in which the transcript appears after the old ten-second boundary, then run the affected Vitest suites, type-check, and production build.
