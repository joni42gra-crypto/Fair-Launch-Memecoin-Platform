import { readFile, writeFile } from "node:fs/promises";
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

function groupForIssuer(issuer) {
  const normalizedIssuer = issuer.toLocaleLowerCase();
  if (normalizedIssuer.includes("(xstocks)")) return "xstocks";
  if (normalizedIssuer.includes("backpack")) return "backpack";
  return "crypto";
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

  const assetGroups = { xstocks: [], backpack: [] };
  const assets = rows.slice(1).map((row) => {
    if (row.length !== 5) throw new Error("An official catalog row has an unexpected number of columns.");
    const [ticker, name, issuer, listingProvider, mintAddress] = row;
    if (!ticker || !name || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mintAddress)) {
      throw new Error(`An official catalog row has invalid data for ${ticker || "unknown asset"}.`);
    }
    const group = groupForIssuer(issuer);
    if (group !== "crypto") assetGroups[group].push(mintAddress);
    return [ticker, name, mintAddress, categoryFor(ticker, issuer, listingProvider)];
  });

  const mintAddresses = new Set(assets.map((asset) => asset[2]));
  const groupedMints = [...assetGroups.xstocks, ...assetGroups.backpack];
  if (
    assets.length === 0 ||
    mintAddresses.size !== assets.length ||
    new Set(groupedMints).size !== groupedMints.length ||
    groupedMints.some((mintAddress) => !mintAddresses.has(mintAddress))
  ) {
    throw new Error("The official catalog is empty or contains duplicate mint addresses.");
  }

  const pageText = cellText(html);
  const sourceDate = pageText.match(/Last updated:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i)?.[1];
  if (!sourceDate) throw new Error("Could not read the official page's last-updated date.");
  return { assets, sourceDate, assetGroups };
}

async function main() {
  const response = await fetch(sourceUrl, {
    headers: { accept: "text/html" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Official documentation returned HTTP ${response.status}.`);

  const { assets, sourceDate, assetGroups } = extractCatalog(await response.text());
  if (process.argv.includes("--check")) {
    const currentSource = await readFile(outputPath, "utf8");
    const currentAssetsMatch = currentSource.match(
      /assets:\s*(\[[\s\S]*?\])\s+satisfies readonly SupportedPairRow\[\],/,
    );
    const currentDate = currentSource.match(/sourceLastUpdated:\s*"([^"]+)"/)?.[1];
    const currentAssets = currentAssetsMatch
      ? JSON.parse(currentAssetsMatch[1].replace(/,\s*\]/g, "]"))
      : null;
    const currentGroups = {};
    for (const group of ["xstocks", "backpack"]) {
      const match = currentSource.match(new RegExp(`${group}:\\s*(\\[[\\s\\S]*?\\])`));
      currentGroups[group] = match ? JSON.parse(match[1].replace(/,\s*\]/g, "]")) : null;
    }
    if (
      !currentAssets ||
      JSON.stringify(currentAssets) !== JSON.stringify(assets) ||
      JSON.stringify(currentGroups) !== JSON.stringify(assetGroups) ||
      currentDate !== sourceDate
    ) {
      throw new Error("The checked-in snapshot differs from the official page. Review the changes, then run update:supported-pairs.");
    }
    console.log(`Snapshot matches all ${assets.length} official rows and issuer groups; page updated ${sourceDate}.`);
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
    `export type PairAssetGroup = "xstocks" | "backpack" | "crypto";\n\n` +
    `export type SupportedPairRow = readonly [\n  ticker: string,\n  name: string,\n  mintAddress: string,\n  category: PairAssetCategory,\n];\n\n` +
    `export type SupportedPairAssetGroups = {\n  xstocks: readonly string[];\n  backpack: readonly string[];\n};\n\n` +
    `export const supportedPairCatalog = {\n` +
    `  sourceUrl: ${JSON.stringify(sourceUrl)},\n` +
    `  sourceLastUpdated: ${JSON.stringify(sourceDate)},\n` +
    `  snapshotCapturedAt: ${JSON.stringify(new Date().toISOString().slice(0, 10))},\n` +
    `  assets: ${JSON.stringify(assets, null, 2)} satisfies readonly SupportedPairRow[],\n` +
    `  assetGroups: ${JSON.stringify(assetGroups, null, 2)} satisfies SupportedPairAssetGroups,\n` +
    `};\n`;
  await writeFile(outputPath, file, "utf8");
  console.log(`Updated ${assets.length} records from ${sourceUrl} (page updated ${sourceDate}).`);
}

main().catch((error) => {
  console.error(`Supported pair catalog update failed: ${error instanceof Error ? error.message : "unknown error"}`);
  process.exitCode = 1;
});
