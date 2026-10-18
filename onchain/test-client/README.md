# Local escrow integration tests

Run from the repository root:

```sh
pnpm --filter @workspace/launchpad-escrow-tests test
```

The script builds the program directly with `cargo build-sbf` when its artifact
is missing or stale (not `anchor build`), loads it at the ID already declared
in the Rust program, creates synthetic
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

Some container kernels do not support the `io_uring` capability required by
Agave 3.1.10's test validator. On such a host, the validator panics before RPC
startup and the integration tests cannot run; do not try to bypass this by
changing kernel settings or replacing the pinned validator with an unverified
version.
