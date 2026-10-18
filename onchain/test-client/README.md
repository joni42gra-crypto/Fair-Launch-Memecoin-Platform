# Local escrow integration tests

Run from the repository root on a compatible Linux host:

```sh
pnpm --filter @workspace/launchpad-escrow-tests test
```

## Supported host

Anza's [validator requirements](https://docs.anza.xyz/operations/requirements)
state that Agave is built and run on Ubuntu 24.04. Anchor 1.0 targets Solana
3.x and [recommends Agave 3.1.10](https://www.anchor-lang.com/docs/updates/release-notes/1-0-0).
Use a full Ubuntu 24.04 x86_64 host or VM, not a restricted container. The
standard GitHub-hosted `ubuntu-24.04` runner is documented as a VM; `ubuntu-slim`
is a container and does not support some low-level kernel operations. The
preflight below verifies the actual syscall/features rather than assuming an
OS label guarantees them.

The Agave 3.1.10 source checks for `IORING_FEAT_NODROP` and
`IORING_FEAT_SQPOLL_NONFIXED` when setting up its filesystem operations. The
test runner probes those exact kernel features before compiling or starting the
validator and fails early if they are unavailable. This check does not alter
kernel settings.

## Pinned local setup on Ubuntu 24.04

Prerequisites: x86_64 Ubuntu 24.04, Python 3, Node.js 24, and Corepack.

```sh
mkdir -p .local/share/launchpad-tools
curl --proto '=https' --tlsv1.2 -fsSL \
  https://release.anza.xyz/v3.1.10/install \
  -o /tmp/agave-v3.1.10-install.sh
sh /tmp/agave-v3.1.10-install.sh v3.1.10 \
  --no-modify-path \
  --data-dir "$PWD/.local/share/solana/install"

curl --proto '=https' --tlsv1.2 -fsSL \
  https://sh.rustup.rs \
  -o /tmp/rustup-install.sh
RUSTUP_HOME="$PWD/.local/share/launchpad-tools/rustup" \
CARGO_HOME="$PWD/.local/share/launchpad-tools/rustup-cargo" \
  sh /tmp/rustup-install.sh -y --no-modify-path --default-toolchain none

corepack prepare pnpm@10.26.1 --activate
pnpm install --frozen-lockfile
python3 onchain/test-client/check-io-uring.py
pnpm --filter @workspace/launchpad-escrow-tests test
```

The script builds the program directly with Agave's `cargo-build-sbf` when its
artifact is missing or stale (not `anchor build`), loads it at the ID already
declared in the Rust program, creates synthetic
`PriceUpdateV2` accounts, starts `solana-test-validator` bound to
`127.0.0.1:18999`, runs the tests, and removes the temporary ledger and
fixtures. It does not connect to Devnet or Mainnet.

The fixture accounts let the tests exercise the program's owner, full-verification
flag, exact SOL/USD feed ID, publish-time, positive-price, confidence, quote
snapshot, and lamport checks. They are **not** genuine Pyth updates and do not
test Wormhole guardian signatures or the Pyth Receiver program's on-chain
verification instruction. Do not treat these fixtures as evidence of live-oracle
authenticity.

The suite sends only local-validator transactions. It covers 100 unique
participants, a rejected 101st participant, duplicate wallet contributions,
reuse of one fresh oracle account across distinct wallets, the one-hour
deadline, early and late finalization, refund-recipient binding, exact saved
lamports, rent/fee accounting, repeat-refund rejection, invalid/stale oracle
samples, and the fact that closing a successful receipt does not withdraw the
campaign vault.

The program uses Anchor 1.0.2 and Pyth SDK 2.0.0. Its SBF build uses Agave
3.1.10, platform-tools v1.52, and Rust 1.89.0. The SBF build is invoked
directly so Anchor does not auto-sync or rewrite the existing program ID.
Set `ESCROW_ALWAYS_BUILD=1` to force a rebuild.

The local test tools are kept under the ignored workspace directory
`.local/share/` so they survive a Replit runtime refresh without being committed
or included in deployment images.

The current Replit host fails this preflight with `Operation not permitted`
for `io_uring_setup`. No integration assertions were executed here. Do not
bypass this by changing kernel settings or replacing the pinned validator with
an unverified version.
