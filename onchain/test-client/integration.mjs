import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const rpcUrl = process.env.ESCROW_RPC_URL ?? "http://127.0.0.1:18999";
const connection = new Connection(rpcUrl, "confirmed");
const source = await readFile(
  path.resolve(here, "../programs/launchpad-escrow/src/lib.rs"),
  "utf8",
);
const programId = new PublicKey(source.match(/declare_id!\("([^"]+)"\)/)?.[1]);
const fixtures = JSON.parse(
  await readFile(path.join(here, "fixtures/addresses.json"), "utf8"),
);
const SOL_USD_PRICE = 10_000_000_000n;
const SOL_USD_CONFIDENCE = 10_000_000n;
const SOL_USD_EXPONENT = -8;
const EXPECTED_LAMPORTS = 100_000_000n;
const CAMPAIGN_SPACE = 76;
const PARTICIPANT_SPACE = 125;

function discriminator(name) {
  return createHash("sha256")
    .update(`global:${name}`)
    .digest()
    .subarray(0, 8);
}

function u64(value) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(value));
  return out;
}

function i64(value) {
  const out = Buffer.alloc(8);
  out.writeBigInt64LE(BigInt(value));
  return out;
}

function i32(value) {
  const out = Buffer.alloc(4);
  out.writeInt32LE(Number(value));
  return out;
}

function instruction(name, keys, args = []) {
  return new TransactionInstruction({
    programId,
    keys,
    data: Buffer.concat([discriminator(name), ...args]),
  });
}

function campaignAddress(creator, id) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("campaign"), creator.toBuffer(), u64(id)],
    programId,
  )[0];
}

function participantAddress(campaign, wallet) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("participant"), campaign.toBuffer(), wallet.toBuffer()],
    programId,
  )[0];
}

function vaultAddress(campaign) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), campaign.toBuffer()],
    programId,
  )[0];
}

function parseCampaign(accountInfo) {
  assert.ok(accountInfo, "campaign account must exist");
  const data = accountInfo.data;
  assert.equal(data.length, CAMPAIGN_SPACE);
  return {
    startedAt: data.readBigInt64LE(48),
    endsAt: data.readBigInt64LE(56),
    participantCount: data.readUInt8(64),
    refundedCount: data.readUInt8(65),
    status: data.readUInt8(66), // Borsh enum: Open=0, Successful=1, Failed=2.
    totalLamports: data.readBigUInt64LE(67),
  };
}

function parseParticipant(accountInfo) {
  assert.ok(accountInfo, "participant receipt must exist");
  const data = accountInfo.data;
  assert.equal(data.length, PARTICIPANT_SPACE);
  return {
    amountLamports: data.readBigUInt64LE(72),
    price: data.readBigInt64LE(80),
    confidence: data.readBigUInt64LE(88),
    exponent: data.readInt32LE(96),
    publishTime: data.readBigInt64LE(100),
    quoteExpiresAt: data.readBigInt64LE(108),
    joinedAt: data.readBigInt64LE(116),
  };
}

async function clockUnixTimestamp() {
  const clock = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, "confirmed");
  assert.ok(clock, "Clock sysvar must be available");
  return clock.data.readBigInt64LE(32);
}

async function sendInstruction(signer, ix) {
  const blockhash = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({
    feePayer: signer.publicKey,
    recentBlockhash: blockhash.blockhash,
  }).add(ix);
  tx.sign(signer);
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    preflightCommitment: "confirmed",
    maxRetries: 3,
  });
  const confirmation = await connection.confirmTransaction(
    { signature, ...blockhash },
    "confirmed",
  );
  if (confirmation.value.err) {
    throw new Error(
      `${ix.programId.toBase58()} transaction failed: ${JSON.stringify(confirmation.value.err)}`,
    );
  }
  return signature;
}

async function sendContributionBatch(campaign, wallets) {
  const signatures = [];
  for (let index = 0; index < wallets.length; index += 12) {
    const batch = wallets.slice(index, index + 12);
    const blockhash = await connection.getLatestBlockhash("confirmed");
    const now = await clockUnixTimestamp();
    const quoteExpiry = now + 19n;
    const transactions = batch.map((wallet) => {
      const ix = contributeInstruction(wallet, campaign, "valid", {
        quoteExpiresAt: quoteExpiry,
      });
      const tx = new Transaction({
        feePayer: wallet.publicKey,
        recentBlockhash: blockhash.blockhash,
      }).add(ix);
      tx.sign(wallet);
      return tx;
    });

    const batchSignatures = await Promise.all(
      transactions.map((tx) =>
        connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: true,
          maxRetries: 5,
        }),
      ),
    );
    const confirmations = await Promise.all(
      batchSignatures.map((signature) =>
        connection.confirmTransaction(
          { signature, ...blockhash },
          "confirmed",
        ),
      ),
    );
    for (const confirmation of confirmations) {
      assert.equal(
        confirmation.value.err,
        null,
        `contribution batch failed: ${JSON.stringify(confirmation.value.err)}`,
      );
    }
    signatures.push(...batchSignatures);
  }
  return signatures;
}

async function transactionFee(signature) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const transaction = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (transaction?.meta) return BigInt(transaction.meta.fee);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Could not load transaction metadata for ${signature}`);
}

async function expectRejected(label, work) {
  let error;
  try {
    await work();
  } catch (caught) {
    error = caught;
  }
  assert.ok(error, `${label}: expected the transaction to be rejected`);
  return error;
}

async function fundWallets(wallets) {
  for (let index = 0; index < wallets.length; index += 10) {
    const batch = wallets.slice(index, index + 10);
    const signatures = await Promise.all(
      batch.map((wallet) =>
        connection.requestAirdrop(wallet.publicKey, 300_000_000),
      ),
    );
    await Promise.all(
      signatures.map((signature) =>
        connection.confirmTransaction(signature, "confirmed"),
      ),
    );
  }
}

async function startCampaign(creator, id) {
  const campaign = campaignAddress(creator.publicKey, id);
  const signature = await sendInstruction(
    creator,
    instruction(
      "start_campaign",
      [
        { pubkey: creator.publicKey, isSigner: true, isWritable: true },
        { pubkey: campaign, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      [u64(id)],
    ),
  );
  return { campaign, signature };
}

function getFixture(name) {
  const mapping = {
    valid: fixtures.valid,
    "wrong-feed": fixtures.wrongFeed,
    stale: fixtures.stale,
    partial: fixtures.partial,
    "zero-price": fixtures.zeroPrice,
    "wide-confidence": fixtures.wideConfidence,
    "future-price": fixtures.tooFarInFuture,
    "wrong-owner": fixtures.wrongOwner,
  };
  const fixture = mapping[name];
  assert.ok(fixture, `unknown local oracle fixture: ${name}`);
  return fixture;
}

function contributeInstruction(wallet, campaign, fixtureName, overrides = {}) {
  const fixture = getFixture(fixtureName);
  const quotedPrice = BigInt(overrides.price ?? fixture.price);
  const quotedConfidence = BigInt(overrides.confidence ?? fixture.confidence);
  const quotedExponent = Number(overrides.exponent ?? fixture.exponent);
  const quotedPublishTime = BigInt(
    overrides.publishTime ?? fixture.publishTime,
  );
  const quoteExpiresAt = BigInt(
    overrides.quoteExpiresAt ?? 0n,
  );
  const expectedLamports = BigInt(
    overrides.expectedLamports ?? EXPECTED_LAMPORTS,
  );
  return instruction(
    "contribute",
    [
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: campaign, isSigner: false, isWritable: true },
      {
        pubkey: participantAddress(campaign, wallet.publicKey),
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: vaultAddress(campaign),
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: new PublicKey(fixture.address),
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: SystemProgram.programId,
        isSigner: false,
        isWritable: false,
      },
    ],
    [
      i64(quotedPrice),
      u64(quotedConfidence),
      i32(quotedExponent),
      i64(quotedPublishTime),
      i64(quoteExpiresAt),
      u64(expectedLamports),
    ],
  );
}

function finalizeFailureInstruction(caller, campaign) {
  return instruction("finalize_failure", [
    { pubkey: caller.publicKey, isSigner: true, isWritable: false },
    { pubkey: campaign, isSigner: false, isWritable: true },
  ]);
}

async function currentContribution(wallet, campaign, fixtureName = "valid", extra = {}) {
  const now = await clockUnixTimestamp();
  return sendInstruction(
    wallet,
    contributeInstruction(wallet, campaign, fixtureName, {
      quoteExpiresAt: now + 19n,
      ...extra,
    }),
  );
}

async function rejectOracleCases(wallet, campaign) {
  const cases = [
    ["wrong supported feed ID", "wrong-feed", {}],
    ["stale Pyth publish time", "stale", {}],
    ["partial rather than full verification", "partial", {}],
    ["zero price", "zero-price", {}],
    ["confidence above 1%", "wide-confidence", {}],
    ["price timestamp too far in the future", "future-price", {}],
    ["wrong account owner", "wrong-owner", {}],
    ["displayed quote differs from Pyth", "valid", { price: SOL_USD_PRICE + 1n }],
    ["incorrect expected lamports", "valid", { expectedLamports: EXPECTED_LAMPORTS + 1n }],
  ];

  const now = await clockUnixTimestamp();
  for (const [label, fixture, overrides] of cases) {
    await expectRejected(label, () =>
      sendInstruction(
        wallet,
        contributeInstruction(wallet, campaign, fixture, {
          quoteExpiresAt: now + 19n,
          ...overrides,
        }),
      ),
    );
    assert.equal(
      await connection.getAccountInfo(
        participantAddress(campaign, wallet.publicKey),
        "confirmed",
      ),
      null,
      `${label}: rejected instruction must not leave a participant receipt`,
    );
  }

  await expectRejected("already-expired quote", () =>
    sendInstruction(
      wallet,
      contributeInstruction(wallet, campaign, "valid", {
        quoteExpiresAt: now,
      }),
    ),
  );
  await expectRejected("quote TTL over 20 seconds", () =>
    sendInstruction(
      wallet,
      contributeInstruction(wallet, campaign, "valid", {
        quoteExpiresAt: now + 21n,
      }),
    ),
  );
  console.log("PASS invalid feed, age, verification, price, confidence, quote and owner checks");
}

async function run() {
  const creator = Keypair.generate();
  const participants = Array.from({ length: 104 }, () => Keypair.generate());
  const [repeatWallet, secondWallet] = participants;
  const successWallets = participants.slice(2, 102);
  const participant101 = participants[102];
  const invalidPriceWallet = participants[103];
  assert.equal(
    new Set(successWallets.map((wallet) => wallet.publicKey.toBase58())).size,
    100,
  );
  await fundWallets([creator, ...participants]);

  const duplicateCampaign = await startCampaign(creator, 1n);
  const firstSharedQuoteSignature = await currentContribution(
    repeatWallet,
    duplicateCampaign.campaign,
  );
  const secondSharedQuoteSignature = await currentContribution(
    secondWallet,
    duplicateCampaign.campaign,
  );
  assert.ok(firstSharedQuoteSignature && secondSharedQuoteSignature);
  const duplicateBefore = await connection.getBalance(
    vaultAddress(duplicateCampaign.campaign),
    "confirmed",
  );
  await expectRejected("same wallet contributes twice", () =>
    currentContribution(repeatWallet, duplicateCampaign.campaign),
  );
  assert.equal(
    await connection.getBalance(vaultAddress(duplicateCampaign.campaign), "confirmed"),
    duplicateBefore,
  );
  const duplicateState = parseCampaign(
    await connection.getAccountInfo(duplicateCampaign.campaign, "confirmed"),
  );
  assert.equal(duplicateState.participantCount, 2);
  console.log("PASS one fresh PriceUpdateV2 can serve distinct wallets; same-wallet replay is rejected");

  const successCampaign = await startCampaign(creator, 2n);
  const successStarted = parseCampaign(
    await connection.getAccountInfo(successCampaign.campaign, "confirmed"),
  );
  assert.equal(successStarted.endsAt - successStarted.startedAt, 3_600n);
  const firstSuccessWallet = successWallets[0];
  const firstBalanceBefore = await connection.getBalance(
    firstSuccessWallet.publicKey,
    "confirmed",
  );
  const rentForReceipt = await connection.getMinimumBalanceForRentExemption(
    PARTICIPANT_SPACE,
    "confirmed",
  );
  const contributionSignatures = await sendContributionBatch(
    successCampaign.campaign,
    successWallets,
  );
  const firstSignature = contributionSignatures[0];
  const firstReceipt = participantAddress(
    successCampaign.campaign,
    firstSuccessWallet.publicKey,
  );
  const firstReceiptInfo = await connection.getAccountInfo(firstReceipt, "confirmed");
  const firstReceiptData = parseParticipant(firstReceiptInfo);
  assert.equal(firstReceiptData.amountLamports, EXPECTED_LAMPORTS);
  assert.equal(firstReceiptData.price, SOL_USD_PRICE);
  assert.equal(firstReceiptData.confidence, SOL_USD_CONFIDENCE);
  assert.equal(firstReceiptData.exponent, SOL_USD_EXPONENT);
  assert.equal(firstReceiptData.publishTime, BigInt(fixtures.valid.publishTime));
  const contributionFee = await transactionFee(firstSignature);
  const firstBalanceAfter = await connection.getBalance(
    firstSuccessWallet.publicKey,
    "confirmed",
  );
  assert.equal(
    BigInt(firstBalanceBefore - firstBalanceAfter),
    EXPECTED_LAMPORTS + BigInt(rentForReceipt) + contributionFee,
    "wallet debit must equal the saved lamports plus receipt rent and network fee",
  );

  const successState = parseCampaign(
    await connection.getAccountInfo(successCampaign.campaign, "confirmed"),
  );
  assert.equal(successState.participantCount, 100);
  assert.equal(successState.status, 1);
  assert.equal(successState.totalLamports, EXPECTED_LAMPORTS * 100n);
  const successVault = vaultAddress(successCampaign.campaign);
  assert.equal(
    BigInt(await connection.getBalance(successVault, "confirmed")),
    EXPECTED_LAMPORTS * 100n,
  );
  console.log("PASS 100 unique participants reach success with exact recorded deposits");

  const vaultBefore101 = await connection.getBalance(successVault, "confirmed");
  await expectRejected("101st participant", () =>
    currentContribution(participant101, successCampaign.campaign),
  );
  assert.equal(
    await connection.getBalance(successVault, "confirmed"),
    vaultBefore101,
  );
  assert.equal(
    parseCampaign(
      await connection.getAccountInfo(successCampaign.campaign, "confirmed"),
    ).participantCount,
    100,
  );
  await expectRejected("failed campaign finalization after success", () =>
    sendInstruction(
      creator,
      finalizeFailureInstruction(creator, successCampaign.campaign),
    ),
  );

  const receiptRent = BigInt(firstReceiptInfo.lamports);
  const successfulVaultBeforeReceiptClose = await connection.getBalance(
    successVault,
    "confirmed",
  );
  const successWalletBeforeReceiptClose = await connection.getBalance(
    firstSuccessWallet.publicKey,
    "confirmed",
  );
  const closeSuccessReceipt = instruction("close_success_receipt", [
    { pubkey: firstSuccessWallet.publicKey, isSigner: true, isWritable: true },
    { pubkey: successCampaign.campaign, isSigner: false, isWritable: false },
    { pubkey: firstReceipt, isSigner: false, isWritable: true },
  ]);
  const closeSignature = await sendInstruction(
    firstSuccessWallet,
    closeSuccessReceipt,
  );
  const closeFee = await transactionFee(closeSignature);
  assert.equal(await connection.getAccountInfo(firstReceipt, "confirmed"), null);
  assert.equal(
    BigInt(
      (await connection.getBalance(firstSuccessWallet.publicKey, "confirmed")) -
        successWalletBeforeReceiptClose,
    ),
    receiptRent - closeFee,
  );
  assert.equal(
    await connection.getBalance(successVault, "confirmed"),
    successfulVaultBeforeReceiptClose,
    "closing a successful receipt must not withdraw campaign funds",
  );
  console.log("PASS the successful campaign has no withdrawal path; receipt closure leaves escrow untouched");

  const invalidCampaign = await startCampaign(creator, 3n);
  await rejectOracleCases(invalidPriceWallet, invalidCampaign.campaign);
  assert.equal(
    parseCampaign(
      await connection.getAccountInfo(invalidCampaign.campaign, "confirmed"),
    ).participantCount,
    0,
  );
  console.log("PASS validator scenarios for unique deposits, the 100-wallet cap, and oracle checks");
}

await run();
