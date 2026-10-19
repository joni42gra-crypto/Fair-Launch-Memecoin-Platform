---
name: Pump SBF test fixtures
description: Rules for trustworthy isolated Pump create_v2 ProgramTest setup.
---

For isolated Pump SBF tests, create Pump Global state by executing the pinned program's own `initialize` instruction, then enable `create_v2` through its own `toggle_create_v2` instruction. Read the resulting Global fields from the runtime and compare created state against those values; do not fabricate configuration bytes.

**Why:** a manually serialized Global account with invented fee, reserve, or feature values can make the test exercise a configuration Pump itself would never initialize.

**How to apply:** use the exact pinned SBF and IDL for test setup and assertions. Treat the published crate artifact's equivalence to any intended deployed Pump version as a separate, explicitly verified claim.
