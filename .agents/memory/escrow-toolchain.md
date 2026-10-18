---
name: Local escrow toolchain
description: Preserve the Solana program ID during builds and account for local validator limits in this Replit environment.
---

Anchor CLI 1.0.2 `anchor build` may run program-ID synchronization and rewrite `declare_id!` and `Anchor.toml` from a generated deploy keypair. When the existing program ID must remain unchanged, use direct `cargo build-sbf` and verify the ID afterward.

**Why:** the user explicitly prohibited changing the current program ID.

**How to apply:** do not run `anchor build` blindly for local checks; inspect generated keypairs and use direct SBF compilation when no ID change is allowed.

Agave 3.1.10's `solana-test-validator` requires `IORING_FEAT_NODROP` and `IORING_FEAT_SQPOLL_NONFIXED`; this Replit host denies `io_uring_setup` with `EPERM` despite its Linux 6.18 kernel. Do not change kernel settings or substitute an unverified validator release to bypass this.

**Why:** the requested toolchain must be supported safely; the validator cannot start under this host's syscall policy.

**How to apply:** preflight both required io_uring features, then run integration tests on an Ubuntu 24.04 VM that permits them. Keep local tools under the ignored workspace `.local/share`, because this host's `$HOME/.local/share` was cleared during a runtime refresh.
