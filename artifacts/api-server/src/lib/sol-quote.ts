export const PYTH_SOL_USD_FEED_ID =
  "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
export const SOL_USD_HERMES_URL =
  "https://pyth.dourolabs.app/hermes/v2/updates/price/latest";
export const QUOTE_USD_CENTS = 1_000n;
export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const MAX_PRICE_AGE_SECONDS = 30;
export const QUOTE_TTL_SECONDS = 20;
export const MAX_CONFIDENCE_BPS = 100;
export const MAX_U64 = (1n << 64n) - 1n;

export class PythQuoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PythQuoteError";
  }
}

/**
 * Converts a Pyth integer price into the minimum whole lamports worth of the
 * requested USD amount. Rounding up ensures the contribution is never below
 * the target due to sub-lamport precision.
 */
export function calculateRequiredLamports(
  usdCents: bigint,
  price: bigint,
  exponent: number,
): bigint {
  if (usdCents <= 0n || price <= 0n || !Number.isInteger(exponent) || exponent < -12 || exponent > 12) {
    throw new PythQuoteError("The Pyth price cannot be used for a contribution quote.");
  }

  let numerator = usdCents * LAMPORTS_PER_SOL;
  let denominator = 100n * price;
  if (exponent < 0) {
    numerator *= 10n ** BigInt(-exponent);
  } else {
    denominator *= 10n ** BigInt(exponent);
  }

  const lamports = (numerator + denominator - 1n) / denominator;
  if (lamports > MAX_U64) {
    throw new PythQuoteError("The required amount exceeds Solana's lamport range.");
  }
  return lamports;
}

export function isAcceptableConfidence(price: bigint, confidence: bigint): boolean {
  return price > 0n && confidence >= 0n &&
    confidence * 10_000n <= price * BigInt(MAX_CONFIDENCE_BPS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    throw new PythQuoteError(`Pyth returned an invalid ${field}.`);
  }
  return value;
}

export async function requestSolUsdQuote(
  apiKey: string,
  fetcher: typeof fetch = fetch,
  nowMs = Date.now(),
): Promise<{
  network: "devnet";
  source: "Pyth Core";
  feedId: string;
  usdCents: 1000;
  price: string;
  confidence: string;
  exponent: number;
  publishTime: number;
  quotedAt: number;
  expiresAt: number;
  requiredLamports: string;
  pythUpdateDataBase64: string;
}> {
  const url = new URL(SOL_USD_HERMES_URL);
  url.searchParams.append("ids[]", `0x${PYTH_SOL_USD_FEED_ID}`);

  const response = await fetcher(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(5_000),
    redirect: "error",
  });
  if (!response.ok) {
    throw new PythQuoteError(`Pyth quote service returned HTTP ${response.status}.`);
  }

  const body: unknown = await response.json();
  if (
    !isRecord(body) ||
    !Array.isArray(body.parsed) ||
    !isRecord(body.binary) ||
    body.binary.encoding !== "hex"
  ) {
    throw new PythQuoteError("Pyth returned an incomplete price update.");
  }
  const parsedFeed = body.parsed[0];
  const binaryData = body.binary.data;
  if (!isRecord(parsedFeed) || !isRecord(parsedFeed.price) || !Array.isArray(binaryData)) {
    throw new PythQuoteError("Pyth returned an incomplete SOL/USD update.");
  }

  const feedId = parsedFeed.id;
  if (typeof feedId !== "string" || feedId.replace(/^0x/, "").toLowerCase() !== PYTH_SOL_USD_FEED_ID) {
    throw new PythQuoteError("Pyth returned a different price feed than SOL/USD.");
  }

  const priceRecord = parsedFeed.price;
  const price = requiredString(priceRecord.price, "price");
  const confidence = requiredString(priceRecord.conf, "confidence interval");
  const exponent = priceRecord.expo;
  const publishTime = priceRecord.publish_time;
  if (
    typeof exponent !== "number" ||
    !Number.isInteger(exponent) ||
    typeof publishTime !== "number" ||
    !Number.isInteger(publishTime)
  ) {
    throw new PythQuoteError("Pyth returned invalid price metadata.");
  }

  const priceBigInt = BigInt(price);
  const confidenceBigInt = BigInt(confidence);
  if (!isAcceptableConfidence(priceBigInt, confidenceBigInt)) {
    throw new PythQuoteError("The SOL/USD price confidence interval is too wide.");
  }
  const quotedAt = Math.floor(nowMs / 1_000);
  const age = quotedAt - publishTime;
  if (age < -5 || age > MAX_PRICE_AGE_SECONDS) {
    throw new PythQuoteError("Pyth's SOL/USD update is stale or has an invalid timestamp.");
  }

  const updateHex = binaryData[0];
  if (
    typeof updateHex !== "string" ||
    updateHex.length < 2 ||
    updateHex.length > 1_000_000 ||
    updateHex.length % 2 !== 0 ||
    !/^[a-f0-9]+$/i.test(updateHex)
  ) {
    throw new PythQuoteError("Pyth did not provide valid signed update data.");
  }

  const requiredLamports = calculateRequiredLamports(
    QUOTE_USD_CENTS,
    priceBigInt,
    exponent,
  );
  const expiresAt = Math.min(
    quotedAt + QUOTE_TTL_SECONDS,
    publishTime + MAX_PRICE_AGE_SECONDS,
  );
  if (expiresAt <= quotedAt) {
    throw new PythQuoteError("The SOL/USD update is too close to its expiry to quote.");
  }

  return {
    network: "devnet",
    source: "Pyth Core",
    feedId: PYTH_SOL_USD_FEED_ID,
    usdCents: 1000,
    price,
    confidence,
    exponent,
    publishTime,
    quotedAt,
    expiresAt,
    requiredLamports: requiredLamports.toString(),
    pythUpdateDataBase64: Buffer.from(updateHex, "hex").toString("base64"),
  };
}
