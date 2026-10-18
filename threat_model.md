# Threat Model

## Project Overview

Solana Launchpad is a React/Vite application with an Express API, a Postgres
workspace package, a read-only Phantom connection, and browser-only demo
commitments. A separate Anchor source prototype models a future $10-per-wallet
Devnet escrow with Pyth SOL/USD prices and refunds. The escrow is not deployed;
the app currently does not construct or send Solana transactions.

## Assets

- **Pyth API credential** — enables the server to request price updates; exposure
  could consume the account's quota. It must stay in Replit Secrets and never be
  returned or logged.
- **Escrowed SOL and campaign records** — if the program is later deployed,
  campaign state, wallet-specific quote snapshots, and vault lamports must be
  governed by on-chain rules, not by the web server.
- **Wallet addresses and quote data** — wallet addresses are public identifiers;
  signed Pyth update data and quoted amounts are public and must not be treated
  as authorization.
- **Existing demo proposals and browser state** — changes to Devnet preparation
  must not turn current local demo actions into claims of a real launch or
  payment.

## Trust Boundaries

- **Browser to API** — request parameters, wallet state, and displayed values are
  untrusted. The quote endpoint accepts no client-supplied price.
- **API to Pyth Hermes** — the server holds the Pyth key and validates the
  returned SOL/USD feed, freshness, timestamp, confidence, and signed update
  bytes. This API is only a quote source; it cannot custody funds.
- **Wallet to Solana program** — a future contribution requires the wallet to
  sign. The program checks the Pyth receiver-owned account and independently
  recalculates the exact amount.
- **Devnet to Mainnet** — this work is restricted to Devnet design. No program
  has been deployed and no transaction has been sent.

## Scan Anchors

- Production web/API entry points: `artifacts/fairlaunch` and `artifacts/api-server`.
- High-risk future code: `artifacts/api-server/src/routes/devnet-quote.ts` and
  `onchain/programs/launchpad-escrow/src/lib.rs`.
- The quote route is public and read-only; no contribution or refund API exists.
- `onchain/` contains an un-deployed program prototype. Browser proposal storage
  and demo commitments are not financial records.

## Threat Categories

### Spoofing

An attacker can alter browser state or pass a different wallet address. Any
future deposit must require the contributor's on-chain signature and derive the
participant account from the campaign and signer. The current quote endpoint
does not authorize a campaign action.

### Tampering

A client could change the displayed SOL/USD rate, quote amount, deadline, or
participant count. The program must derive campaign timing and counts from its
own state, read a fresh fully verified Pyth `PriceUpdateV2`, compare the quoted
snapshot, and recalculate the $10 amount using integer lamports before transfer.
The endpoint rejects malformed, stale, wrong-feed, low-confidence, or
out-of-range quotes.

### Repudiation

Campaign and participant accounts provide on-chain state. Contribution and
refund events record the wallet, amount, and price snapshot; a refund closes the
wallet's unique participant PDA, preventing a second claim. Native unit tests
do not replace validator integration tests or an audit.

### Information Disclosure

`PYTH_API_KEY` must remain server-side and must never appear in client bundles,
logs, or API payloads. Quote bytes and wallet addresses are public by design.
Errors returned to the client must not include credentials or upstream
authorization headers.

### Denial of Service

The quote request has a fixed upstream host and a five-second timeout; valid
quotes are cached only until their expiration to coalesce repeated requests.
The endpoint remains public, so production use must include provider-appropriate
rate limits and monitoring. Solana account rent and transaction fees may still
be used to spam failed attempts; fees are not refundable.

### Elevation of Privilege

The escrow prototype has no administrator withdrawal instruction. A failed
campaign allows only each recorded participant to claim its saved amount after
the deadline; a successful campaign currently has no withdrawal or purchase
path. A successful participant can close only their own receipt account to
recover account rent, not funds from the escrow vault. No server role can
override on-chain state. Successful-fund settlement must be designed and
reviewed before enabling real collection.
