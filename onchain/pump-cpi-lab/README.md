# Stage 4A.3 — real Pump SBF create_v2 test

This independent Cargo workspace does **not** integrate Pump into Launchpad.
No changes to escrow sources, dependencies, its Cargo.lock, Anchor.toml, IDs,
refunds, or the existing escrow workflow are required.

## What is executed

The checksum-pinned `pump.so` from the published `pump-rust-client 0.4.1`
crate is loaded as the Pump program. No native Pump processor is supplied. The
existing dispatcher and accumulator-CPI tests remain. The new `create_v2` test
also loads the checksum-pinned Mayhem SBF from that same crate because its
program account appears in Pump's pinned `create_v2` IDL.

The test registers the Token-2022 10.0.0 and Associated Token Account 8.0.0
processors as native ProgramTest programs. Those are only support processors
for the mint and associated-account CPIs; the Pump program itself is always the
real pinned SBF. No Metaplex program is needed by this `create_v2` IDL layout.

The existing `binary_smoke` test sends eight `0xff` bytes, not matching any
instruction discriminator in the pinned IDL. It still requires all of:

1. The executable account contains exactly the pinned SBF bytes, owned by the
   BPF loader.
2. The program actually executes and consumes compute units.
3. Its logs show Pump invocation and Anchor `InstructionFallbackNotFound`.
4. The result is exactly `InstructionError::Custom(101)`, not a loader failure
   or another error.
5. The executable account is unchanged.

This is an intentionally rejected input, **not** a successful create, buy,
collect, or CPI instruction. No tokens or business accounts are created.
If this binary returns anything else, the test fails and the evidence is saved.
Do not broaden the assertion to "any error".

The new `pump_cpi_probe` test registers a separate native ProgramTest processor
under a test-only Program ID. It constructs the fixed
`init_user_volume_accumulator` instruction from the checksum-pinned official
Pump IDL packaged with `pump-rust-client 0.4.1`; the test checks its
discriminator, account order, and signer/writable roles against that IDL. The
probe calls `solana_program::program::invoke_signed` with one predetermined payer PDA and
validates every account address and role. It cannot accept an arbitrary
instruction, program, recipient, or signer seed.

The probe deliberately does not link `pump-rust-client` into the host test
binary: that published crate's broad `solana-program >=2.1.21` dependency
resolves to Solana 5.1 alongside Agave 3.1's Solana 3 instruction types. The
verified crate remains the source of the pinned binary and IDL; the probe uses
the exact IDL layout with Agave-compatible CPI types.

The test loads the same checksum-verified Pump SBF binary and requires an actual
successful nested Pump invocation. It also verifies the created account's Pump
owner, IDL discriminator, stored user, serialized size, and rent. The payer PDA
starts with synthetic ProgramTest genesis lamports and only pays the exact rent
for this one Pump accumulator; no external funds or RPC are involved. This
creates a disposable Pump state account only in the isolated in-process bank.
It does not create or buy a token.

The `pump_create_v2` test submits the pinned `create_v2` instruction through a
fixed native probe. Both the creator/payer and mint are PDAs derived by the
probe; its CPI signs for them with `invoke_signed`. The test verifies the
instruction discriminator and account layout against the same pinned IDL,
checks the real Pump SBF hash at runtime, and checks the created mint, bonding
curve, Token-2022 metadata, and curve token account. It first executes Pump's
own `initialize` and `toggle_create_v2` instructions in the isolated
ProgramTest bank, so Global state is created by the pinned Pump SBF rather than
hand-constructed fixture data. Mayhem mode is false.

The probe itself is a native ProgramTest processor, not a compiled Launchpad
SBF program. The test therefore verifies the real Pump SBF's behavior when
called by a program-signed PDA, not an integration handler in the Launchpad
escrow program or behavior on a cluster.

## Pinned environment and feature policy

* Host Rust/Cargo: **1.89.0**.
* Agave ProgramTest and feature definitions: **3.1.10**, exact dependencies.
* Runtime features: **all features known to that pinned Agave version**, with
  no deactivations; the complete sorted ID/name list and its SHA-256 are emitted
  to `pump-smoke.json`. This is **not** a claim of production feature parity.
* ProgramTest runtime limits (compute maximum, CPI depth, account locks, loaded
  data) are not overridden. The create transaction includes the 400,000-unit
  Compute Budget instruction used by the pinned SDK's create_v2 integration
  example; this is a transaction instruction, not a replacement runtime.
* No Anchor program is built in this stage. The existing Anchor 1.0.2,
  Agave CLI 3.1.10 and platform-tools v1.52 remain untouched. This stage does not
  claim to verify the compiler that originally built the published Pump binary.

The manifest pins the package, Pump and Mayhem executables, Pump IDL, expected
Program IDs, and test scope.
Package verification happens **before** opening its archive; executable and IDL
verification happen **before** writing them into the external temporary cache.
The archive is never extracted wholesale, and unrelated files/keys are never
copied. Artifacts are not executed by preparation.

## Allowed local checks

Use the already installed Rust 1.89.0 with the same CARGO_HOME/RUSTUP_HOME as the
escrow tools, but this lab's own manifest/lock:

```sh
cd onchain/pump-cpi-lab
cargo fmt --all -- --check
python3 scripts/lab.py verify-config
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_*.py' -v
python3 scripts/lab.py prepare
cargo test --locked --test binary_smoke --test pump_cpi_probe --no-run
cargo test --locked --test pump_create_v2 --no-run
```

Python 3.11+ is required (`tomllib`); no third-party Python packages are used.
The default artifact cache is `/tmp/launchpad-pump-lab-0.4.1`. Any configured
cache must be outside the repository. All generated `target/` directories are
already ignored by the repository's existing Git rules.
The Python unit tests verify rejection of a corrupt download, external RPC
configuration, and an in-repository artifact cache. Their invalid byte inputs
are never used as mock programs or evidence of SBF compatibility.

Do **not** run the runtime test in Replit. The test requires the dedicated
GitHub Actions context and executes the existing io_uring preflight before
starting ProgramTest. There is no skip or io_uring bypass flag.

## Dedicated CI

Workflow: **Pump SBF binary smoke test**, file
`.github/workflows/pump-cpi-probe.yml`. It runs on pushes affecting this lab,
its workflow, or the shared preflight, and also supports `workflow_dispatch`.
A user push to a feature branch can therefore test that branch without first
merging the new workflow into the default branch.
Once the workflow also exists on the default branch, a manual run is available:
Actions → Pump SBF binary smoke test → Run workflow → select the intended ref.
No push or workflow dispatch is performed by this lab or during implementation.

The job uses Ubuntu 24.04, runs the unchanged io_uring preflight before build,
selects host Rust explicitly, verifies the locked configuration, downloads and
checks artifacts, then runs the test. A failed command stops the job; evidence
upload uses `always()` but does not convert a failed test into success.
Logs, `pump-smoke.json`, and `pump-create-v2.json` are saved as a GitHub
Actions artifact.

**Existing workflow interaction:** the unchanged escrow workflow matches
`onchain/**` on push. A future push of this directory can therefore also trigger
that workflow. This stage does not alter those triggers or launch that suite.

No RPC client, external cluster, deployed wallet or real funds are used.
Common RPC environment variables are rejected rather than silently ignored.
Artifact downloads and Cargo registry access are build/preparation traffic,
not Solana RPC; the runtime uses in-process BanksClient.

## Boundaries and next gate

Published binary provenance is not a proof of equality with currently deployed
Devnet/Mainnet programs. Initial ELF inspection is not a runtime pass.

This stage is intended to confirm `create_v2` against the pinned Pump SBF in an
isolated in-process bank. It does not test buying, migration to PumpSwap,
Creator Fees, escrow settlement, rewards, or the Launchpad escrow program. The
Launchpad ID `DqZiBhjX49fyGPL3RkTw2PJeuo9aASPCrPcnaw485Zod` remains unloaded and
unused. No deployment, Devnet/Mainnet RPC, or real transaction is performed.

Do not add buying, settlement, or fee distribution without a separately
reviewed stage and a green runtime result for this one.

Source: <https://docs.rs/crate/pump-rust-client/0.4.1/source/artifacts/>
