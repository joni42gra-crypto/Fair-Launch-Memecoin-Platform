# Devnet contribution escrow prototype

This folder contains an un-deployed Anchor program. It is source code for local
verification and a future Devnet-only test; it has not been deployed and this
project does not send Solana transactions.

## Price and quote rules

- The server requests SOL/USD from the official Pyth Core Hermes endpoint,
  `https://pyth.dourolabs.app/hermes/v2/updates/price/latest`, using
  `PYTH_API_KEY` from Replit Secrets. The key is read only by the API server.
- The server rejects a wrong feed ID, non-positive or malformed prices, updates
  older than 30 seconds, timestamps more than 5 seconds in the future, and
  confidence intervals above 1% of the price. It never fabricates a quote.
- The API marks quotes valid for at most 20 seconds and never past the Pyth
  update's 30-second freshness boundary. If the quote expires, the client must
  fetch a fresh one and show its exact amount again before any future wallet
  approval. The expiry field itself is not a server signature; financial
  enforcement comes from the on-chain Pyth freshness check and amount
  recalculation.
- For Pyth price `P × 10^exponent` USD, the required amount is
  `ceil(1000 × 1,000,000,000 × 10^(-exponent) / (100 × P))` lamports when the
  exponent is negative; positive exponents scale the denominator instead.
  All operations use integers, round upward, and reject values outside `u64`.
- The browser quote is informational. The program independently checks the
  Pyth `PriceUpdateV2` account, full verification level, feed ID, price,
  confidence, exponent, publish time, freshness, quote lifetime, and expected
  lamports before accepting a contribution. The intended future client flow is
  to post the included Pyth update and contribute atomically.

## Campaign and escrow rules

- `start_campaign` starts the one-hour clock on-chain.
- The campaign PDA serializes contribution updates. It permits at most 100
  participants; each wallet has a unique participant PDA, so a second
  contribution from the same wallet fails.
- Each participant's amount and Pyth snapshot are stored on-chain at join time.
- Reaching 100 marks the campaign successful. There is deliberately no
  successful-campaign withdrawal or token-purchase instruction, so funds remain
  locked until a separate settlement design is explicitly approved.
- A successful participant may close their receipt PDA to recover its account
  rent. This instruction cannot access or transfer lamports from the campaign
  vault.
- If the deadline passes below 100 participants, anyone can finalize failure.
  Each participant can then claim their exact recorded amount once. The claim
  closes that wallet's participant PDA and returns its rent reserve, making a
  replay fail because the unique account no longer exists. The transaction fee
  is not refunded.
- The API server is never the custodian and is not the authority for campaign
  state or refunds.

## Local checks and limits

Run `cargo test --manifest-path onchain/Cargo.toml --workspace` with Rust 1.89
or newer. The current Pyth Receiver SDK 2.0.0 requires a newer compiler than the
workspace's preinstalled stable Rust 1.88. This environment's Rust 1.90 nightly
was used for the native tests. Official references: [Pyth Hermes
updates](https://docs.pyth.network/price-feeds/core/fetch-price-updates),
[Pyth Solana pull integration](https://docs.pyth.network/price-feeds/core/use-real-time-data/pull-integration/solana),
and the [Pyth Core feed ID
list](https://docs.pyth.network/price-feeds/core/price-feeds/price-feed-ids).
No SBF build, validator-based program test, Devnet deployment, or transaction
has been run.

Before any Devnet collection, add `PYTH_API_KEY` to Replit Secrets and complete
an SBF build, local-validator integration tests (including concurrent joins,
failed campaigns, repeated refunds, and 100th-participant races), a security
review, and an explicit user-approved settlement design for successful
campaigns. The program ID in `Anchor.toml` is a placeholder and must be
regenerated with a deploy keypair before deployment.
