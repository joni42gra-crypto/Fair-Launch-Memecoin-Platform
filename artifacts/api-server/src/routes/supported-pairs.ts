import { Router, type IRouter } from "express";
import {
  SearchSupportedPairAssetsQueryParams,
  SearchSupportedPairAssetsResponse,
  type ApiError,
} from "@workspace/api-zod";
import { supportedPairCatalog } from "../data/supported-pair-assets";

const router: IRouter = Router();
const MAX_RESULTS = 50;

function apiError(message: string): ApiError {
  return { error: message };
}

function normalizeSearch(value: string): string {
  return value.normalize("NFKD").toLocaleLowerCase();
}

router.get("/tokens/supported-pairs", (req, res): void => {
  const rawQuery = req.query.query;
  if (rawQuery !== undefined && typeof rawQuery !== "string") {
    res.status(400).json(apiError("Search with a single asset name, ticker, or mint address."));
    return;
  }

  const parsed = SearchSupportedPairAssetsQueryParams.safeParse({
    query: typeof rawQuery === "string" ? rawQuery.trim() : "",
  });
  if (!parsed.success) {
    res.status(400).json(apiError("Search text must contain between 1 and 120 characters."));
    return;
  }

  try {
    const query = normalizeSearch(parsed.data.query ?? "");
    const results = (query ? supportedPairCatalog.assets
      .filter(([ticker, name, mintAddress]) =>
        [ticker, name, mintAddress].some(value => normalizeSearch(value).includes(query)),
      ) : [])
      .slice(0, MAX_RESULTS)
      .map(([ticker, name, mintAddress, category]) => ({
        ticker,
        name,
        mintAddress,
        category,
        iconUrl: null,
        catalogStatus: "listed" as const,
        compatibilityStatus: "not-checked" as const,
      }));

    res.json(SearchSupportedPairAssetsResponse.parse({
      sourceUrl: supportedPairCatalog.sourceUrl,
      sourceLastUpdated: supportedPairCatalog.sourceLastUpdated,
      snapshotCapturedAt: supportedPairCatalog.snapshotCapturedAt,
      totalAssets: supportedPairCatalog.assets.length,
      results,
    }));
  } catch (error) {
    req.log.error({ err: error }, "Supported pair catalog search failed");
    res.status(500).json(apiError("The supported-pair catalog is unavailable. Please try again later."));
  }
});

export default router;
