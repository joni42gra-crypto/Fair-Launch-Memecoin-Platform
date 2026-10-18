import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PublicKey } from "@solana/web3.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "fixtures");
const accountsDir = path.join(fixturesDir, "accounts");
const SOL_USD_FEED_ID =
  "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
const PYTH_RECEIVER_PROGRAM_ID = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ";
const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
const PRICE = 10_000_000_000n; // $100.00 with exponent -8.
const CONFIDENCE = 10_000_000n; // 0.1%, within the program's 1% bound.
const EXPONENT = -8;
const ACCOUNT_SPACE = 134; // PriceUpdateV2::LEN; Full has one unused padding byte.
const accountDiscriminator = createHash("sha256")
  .update("account:PriceUpdateV2")
  .digest()
  .subarray(0, 8);
const now = BigInt(Math.floor(Date.now() / 1000));

function i64(value) {
  const out = Buffer.alloc(8);
  out.writeBigInt64LE(BigInt(value));
  return out;
}

function u64(value) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(value));
  return out;
}

function makePriceUpdate({
  feedId = SOL_USD_FEED_ID,
  price = PRICE,
  confidence = CONFIDENCE,
  exponent = EXPONENT,
  publishTime = now + 3n,
  verification = "full",
}) {
  const verificationBytes =
    verification === "full" ? Buffer.from([1]) : Buffer.from([0, 5]);
  const data = Buffer.concat([
    accountDiscriminator,
    Buffer.alloc(32), // write_authority
    verificationBytes,
    Buffer.from(feedId, "hex"),
    i64(price),
    u64(confidence),
    (() => {
      const out = Buffer.alloc(4);
      out.writeInt32LE(exponent);
      return out;
    })(),
    i64(publishTime),
    i64(publishTime),
    i64(price),
    u64(confidence),
    u64(0), // posted_slot
  ]);

  if (data.length > ACCOUNT_SPACE) {
    throw new Error(`PriceUpdateV2 fixture is too large: ${data.length} bytes`);
  }
  return Buffer.concat([data, Buffer.alloc(ACCOUNT_SPACE - data.length)]);
}

function fixtureAddress(name) {
  const seed = createHash("sha256").update(`launchpad-local-test:${name}`).digest();
  return new PublicKey(seed).toBase58();
}

async function writeFixture(name, { owner = PYTH_RECEIVER_PROGRAM_ID, ...price }) {
  const address = fixtureAddress(name);
  const data = makePriceUpdate(price);
  const dump = {
    pubkey: address,
    account: {
      lamports: 1_000_000_000,
      data: [data.toString("base64"), "base64"],
      owner,
      executable: false,
      rentEpoch: 0,
    },
  };

  await writeFile(path.join(accountsDir, `${name}.json`), `${JSON.stringify(dump)}\n`);
  return {
    address,
    price: String(price.price ?? PRICE),
    confidence: String(price.confidence ?? CONFIDENCE),
    exponent: price.exponent ?? EXPONENT,
    publishTime: String(price.publishTime ?? now + 3n),
  };
}

await mkdir(accountsDir, { recursive: true });
const accounts = {
  valid: await writeFixture("valid", {}),
  wrongFeed: await writeFixture("wrong-feed", {
    feedId: "00".repeat(32),
  }),
  stale: await writeFixture("stale", {
    publishTime: now - 60n,
  }),
  partial: await writeFixture("partial", {
    verification: "partial",
  }),
  zeroPrice: await writeFixture("zero-price", {
    price: 0n,
  }),
  wideConfidence: await writeFixture("wide-confidence", {
    confidence: 100_000_001n,
  }),
  tooFarInFuture: await writeFixture("future-price", {
    publishTime: now + 120n,
  }),
  wrongOwner: await writeFixture("wrong-owner", {
    owner: SYSTEM_PROGRAM_ID,
  }),
};

await writeFile(
  path.join(fixturesDir, "addresses.json"),
  `${JSON.stringify(accounts, null, 2)}\n`,
);
console.log(`Generated ${Object.keys(accounts).length} local PriceUpdateV2 fixtures.`);
