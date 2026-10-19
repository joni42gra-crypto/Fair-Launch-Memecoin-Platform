# Stage 4A.2 — real Pump SBF binary smoke test

This independent Cargo workspace does **not** integrate Pump into Launchpad.
No changes to escrow sources, dependencies, its Cargo.lock, Anchor.toml, IDs,
refunds, or the existing escrow workflow are required.

## What is executed

Only the checksum-pinned `pump.so` from the published `pump-rust-client 0.4.1`
crate is added to ProgramTest. No native Pump processor is supplied.
ProgramTest's bundled System/SPL infrastructure remains unchanged. PumpSwap,
Pump Fees, Mayhem and other packaged binaries are **not** loaded in this stage:
the unknown-instruction dispatcher test needs no business accounts or CPI.

An in-process transaction sends eight `0xff` bytes, not matching any instruction
discriminator in the pinned IDL. Passing requires all of:

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

## Pinned environment and feature policy

* Host Rust/Cargo: **1.89.0**.
* Agave ProgramTest and feature definitions: **3.1.10**, exact dependencies.
* Runtime features: **all features known to that pinned Agave version**, with
  no deactivations; the complete sorted ID/name list and its SHA-256 are emitted
  to `pump-smoke.json`. This is **not** a claim of production feature parity.
* No custom compute budget, CPI depth, account-lock, or loaded-data limits.
* No Anchor program is built in this stage. The existing Anchor 1.0.2,
  Agave CLI 3.1.10 and platform-tools v1.52 remain untouched. This stage does not
  claim to verify the compiler that originally built the published Pump binary.

The manifest pins package, executable, IDL, expected Program ID and scope.
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
cargo test --locked --test binary_smoke --no-run
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
Logs and `pump-smoke.json` are saved as a GitHub Actions artifact.

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

This stage confirms neither PDA signatures nor CPI compatibility, creation,
trading, migration, Creator Fees, escrow settlement, or rewards.
The Launchpad ID `DqZiBhjX49fyGPL3RkTw2PJeuo9aASPCrPcnaw485Zod`
is **not loaded or used** in this stage because there is no test probe yet.
A later, separately approved probe may use it only inside an isolated bank.
No creator/payer identity assumption is made.

Do not add PumpSwap/Pump Fees, a probe, `invoke_signed`, create/buy/collect calls,
or program deployment until the next stage is approved.

Source: <https://docs.rs/crate/pump-rust-client/0.4.1/source/artifacts/>
