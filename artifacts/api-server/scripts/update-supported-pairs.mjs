import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const sourceUrl = "https://pump.fun/docs/custom-pairs";
const outputPath = fileURLToPath(new URL("../src/data/supported-pair-assets.ts", import.meta.url));
const expectedHeader = [
  "Symbol",
  "Asset name",
  "Issuer",
  "Listing provider",
  "Solana contract address",
];

function decodeEntities(value) {
  return value
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, entity) => {
      const codePoint = entity[0].toLowerCase() === "x"
        ? Number.parseInt(entity.slice(1), 16)
        : Number.parseInt(entity, 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
    })
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cellText(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function categoryFor(ticker, issuer, listingProvider) {
  const source = `${issuer} ${listingProvider}`.toLocaleLowerCase();
  if (ticker === "SOL") return "native";
  if (ticker === "USDC" || source.includes("stablecoin")) return "stablecoin";
  if (source.includes("xstocks") || source.includes("backpack securities")) return "tokenized-stock";
  if (source.includes("launched on pump.fun")) return "pumpfun-coin";
  if (source.includes("memecoin")) return "memecoin";
  if (source.includes("community token")) return "community";
  if (source.includes("protocol governance") || source.includes("protocol token")) return "protocol";
  if (source.includes("platform token")) return "platform";
  if (source.includes("paxos trust")) return "tokenized-asset";
  if (
    source.includes("wrapped") ||
    source.includes("wormhole portal") ||
    source.includes("near omni bridge") ||
    source.includes("hex trust") ||
    source.includes("wxmr")
  ) return "wrapped";
  if (source.includes("native network token")) {
    return listingProvider.toLocaleLowerCase() === "n/a" ? "native" : "wrapped";
  }
  return "other";
}

function extractCatalog(html) {
  const table = html.match(
    /<table\b(?=[^>]*\baria-labelledby=["']supported-pair-assets["'])[^>]*>([\s\S]*?)<\/table>/i,
  );
  if (!table) throw new Error("Could not find the official Supported Pair Assets table.");

  const rows = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(([, row]) =>
    [...row.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map(([, cell]) => cellText(cell)),
  );
  if (JSON.stringify(rows[0]) !== JSON.stringify(expectedHeader)) {
    throw new Error("The official table columns changed. Review the page before updating the catalog.");
  }

  const assets = rows.slice(1).map((row) => {
    if (row.length !== 5) throw new Error("An official catalog row has an unexpected number of columns.");
    const [ticker, name, issuer, listingProvider, mintAddress] = row;
    if (!ticker || !name || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mintAddress)) {
      throw new Error(`An official catalog row has invalid data for ${ticker || "unknown asset"}.`);
    }
    return [ticker, name, mintAddress, categoryFor(ticker, issuer, listingProvider)];
  });

  const mintAddresses = new Set(assets.map((asset) => asset[2]));
  if (assets.length === 0 || mintAddresses.size !== assets.length) {
    throw new Error("The official catalog is empty or contains duplicate mint addresses.");
  }

  const pageText = cellText(html);
  const sourceDate = pageText.match(/Last updated:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i)?.[1];
  if (!sourceDate) throw new Error("Could not read the official page's last-updated date.");
  return { assets, sourceDate };
}

async function main() {
  const response = await fetch(sourceUrl, {
    headers: { accept: "text/html" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Official documentation returned HTTP ${response.status}.`);

  const { assets, sourceDate } = extractCatalog(await response.text());
  if (process.argv.includes("--check")) {
    console.log(`Official table verified: ${assets.length} assets; page updated ${sourceDate}. Snapshot unchanged.`);
    return;
  }

  const categories = [
    "native",
    "stablecoin",
    "tokenized-stock",
    "tokenized-asset",
    "wrapped",
    "protocol",
    "platform",
    "community",
    "memecoin",
    "pumpfun-coin",
    "other",
  ];
  const file = `export type PairAssetCategory =\n${categories.map((category) => `  | ${JSON.stringify(category)}`).join("\n")};\n\n` +
    `export type SupportedPairRow = readonly [\n  ticker: string,\n  name: string,\n  mintAddress: string,\n  category: PairAssetCategory,\n];\n\n` +
    `export const supportedPairCatalog = {\n` +
    `  sourceUrl: ${JSON.stringify(sourceUrl)},\n` +
    `  sourceLastUpdated: ${JSON.stringify(sourceDate)},\n` +
    `  snapshotCapturedAt: ${JSON.stringify(new Date().toISOString().slice(0, 10))},\n` +
    `  assets: ${JSON.stringify(assets, null, 2)} satisfies readonly SupportedPairRow[],\n` +
    `};\n`;
  await writeFile(outputPath, file, "utf8");
  console.log(`Updated ${assets.length} records from ${sourceUrl} (page updated ${sourceDate}).`);
}

main().catch((error) => {
  console.error(`Supported pair catalog update failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
