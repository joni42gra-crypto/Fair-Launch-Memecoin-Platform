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

Agave's SBF builder may invoke Cargo through rustup to read Cargo metadata before compiling. Install and select host Rust `1.89.0`, set both `rustup default 1.89.0` and `RUSTUP_TOOLCHAIN=1.89.0`, and pass the same `CARGO_HOME`, `RUSTUP_HOME`, and toolchain selection into `cargo-build-sbf`. Its explicit `+solana` override still selects the platform-tools SBF compiler.

**Why:** GitHub Actions failed when rustup had no default Cargo toolchain, before the pinned SBF compiler could build the program.

**How to apply:** in the builder's exact child environment, verify `rustc --version`, `cargo --version`, and `rustup show active-toolchain`, then run locked Cargo metadata before invoking the pinned SBF builder.

Anchor 1.0.2 and Pyth receiver SDK 2.0.0 use the Solana 3 instruction/CPI interface. Pyth's `pythnet-sdk` accepts an extremely broad `solana-program >=1.13.6` range, so an unconstrained lock can select Solana `solana-program` 5.x, whose instruction 4 type is incompatible with the 3.x CPI crate. Pin the transitive `solana-program` to 3.0.0 in the escrow program's normal dependencies; this is independent of host-only ProgramTest dependencies.

**Why:** a fresh SBF build failed inside `solana-program` with a mismatched `Instruction` type, while `cargo tree -e normal,build` showed the cause in the Pyth on-chain graph, not the host ProgramTest graph.

**How to apply:** when changing Anchor/Pyth versions, inspect both `cargo tree -e normal,build` and `cargo tree -e dev`; keep the Pyth SDK's Solana program type generation aligned with Anchor and rebuild the actual SBF target.

Agave 3.1.10's local validator does not expose a `warpSlot` RPC method. Its `--warp-slot` option and `ProgramTestContext::warp_to_slot` advance slots, but `Bank::warp_from_parent` preserves the parent's Unix timestamp. For deadline tests, use `ProgramTestContext::set_sysvar(&Clock)` against the built SBF program; use slot warping only when a fresh blockhash is needed.

**Why:** slot advancement alone does not make a time-based on-chain deadline pass.

**How to apply:** keep tests deterministic by setting `Clock.unix_timestamp` directly in Agave's in-process ProgramTest bank rather than waiting for wall-clock time or calling a validator RPC method.
