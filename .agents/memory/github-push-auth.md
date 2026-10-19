---
name: GitHub push authentication
description: Verify GitHub write access from this workspace before pushing changes.
---

An active connection notice does not by itself prove that this workspace's Git CLI can push. Check the actual branch state and CLI authentication result; retain local commits if remote authentication fails.

**Why:** a normal push was rejected as unauthenticated while the integration context still described GitHub as active, and its status listing showed it was not bound.

**How to apply:** never force-push or claim changes reached GitHub based only on connection metadata. Confirm a normal push succeeds before reporting remote updates.
