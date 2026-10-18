import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateRequiredLamports,
  isAcceptableConfidence,
  requestSolUsdQuote,
} from "../src/lib/sol-quote.ts";

test("calculates exact $10 contribution at a $100 SOL price", () => {
  assert.equal(calculateRequiredLamports(1_000n, 10_000_000_000n, -8), 100_000_000n);
});

test("rounds upward when the exact USD amount is between lamports", () => {
  assert.equal(calculateRequiredLamports(1_000n, 300_000_000n, -8), 3_333_333_334n);
});

test("handles positive Pyth exponents without floating-point arithmetic", () => {
  assert.equal(calculateRequiredLamports(1_000n, 1n, 1), 1_000_000_000n);
});

test("rejects non-positive values and unreasonable exponents", () => {
  assert.throws(() => calculateRequiredLamports(1_000n, 0n, -8));
  assert.throws(() => calculateRequiredLamports(1_000n, 1n, -13));
  assert.throws(() => calculateRequiredLamports(1_000n, 1n, -12));
});

test("limits Pyth confidence interval to one percent of the price", () => {
  assert.equal(isAcceptableConfidence(10_000n, 100n), true);
  assert.equal(isAcceptableConfidence(10_000n, 101n), false);
  assert.equal(isAcceptableConfidence(0n, 0n), false);
});

test("parses a fresh official-feed response into a short-lived exact quote", async () => {
  let requestedUrl = "";
  let authorization = "";
  const fakeFetcher = async (input, init) => {
    requestedUrl = String(input);
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return Response.json({
      parsed: [{
        id: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
        price: { price: "10000000000", conf: "1000000", expo: -8, publish_time: 1_000 },
      }],
      binary: { encoding: "hex", data: ["deadbeef"] },
    });
  };

  const quote = await requestSolUsdQuote(
    "test-only-placeholder",
    fakeFetcher,
    1_000_000,
  );
  assert.match(requestedUrl, /ids%5B%5D=0x/);
  assert.equal(authorization, "Bearer test-only-placeholder");
  assert.equal(quote.network, "devnet");
  assert.equal(quote.requiredLamports, "100000000");
  assert.equal(quote.quotedAt, 1_000);
  assert.equal(quote.expiresAt, 1_020);
  assert.equal(quote.pythUpdateDataBase64, "3q2+7w==");
});
