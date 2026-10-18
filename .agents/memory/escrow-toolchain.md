---
name: Local escrow toolchain
description: Preserve the Solana program ID during builds and account for local validator limits in this Replit environment.
---

Anchor CLI 1.0.2 `anchor build` may run program-ID synchronization and rewrite `declare_id!` and `Anchor.toml` from a generated deploy keypair. When the existing program ID must remain unchanged, use direct `cargo build-sbf` and verify the ID afterward.

**Why:** the user explicitly prohibited changing the current program ID.

**How to apply:** do not run `anchor build` blindly for local checks; inspect generated keypairs and use direct SBF compilation when no ID change is allowed.

Agave 3.1.10's `solana-test-validator` panics in the current Replit host because `io_uring_supported()` is false. Do not change kernel settings or substitute an unverified validator release to bypass this.

**Why:** the requested toolchain must be supported safely; the validator fails before RPC startup here.

**How to apply:** run the integration suite on a host with io_uring support. Keep local tools under the ignored workspace `.local/share`, because this host's `$HOME/.local/share` was cleared during a runtime refresh.
