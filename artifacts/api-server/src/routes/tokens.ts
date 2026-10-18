import { Router, type IRouter } from "express";
import {
  SearchSolanaTokensQueryParams,
  SearchSolanaTokensResponse,
  type ApiError,
} from "@workspace/api-zod";

const router: IRouter = Router();
const JUPITER_SEARCH_URL = "https://api.jup.ag/tokens/v2/search";
const SEARCH_TIMEOUT_MS = 8_000;
const MAX_RESULTS = 20;

function apiError(message: string): ApiError {
  return { error: message };
}

class TokenSearchError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "TokenSearchError";
  }
}

function toHttpsIconUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

async function searchJupiter(query: string) {
  const apiKey = process.env.JUPITER_API_KEY?.trim();
  if (!apiKey) {
    throw new TokenSearchError(
      503,
      "Jupiter search is not configured. Add JUPITER_API_KEY in Replit → Tools → Secrets, then restart the API Server.",
    );
  }

  const url = new URL(JUPITER_SEARCH_URL);
  url.searchParams.set("query", query);

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new TokenSearchError(504, "Jupiter token search timed out. Try again.");
    }
    throw new TokenSearchError(
      502,
      "Jupiter token search is unavailable. Check the connection and try again.",
    );
  }

  if (upstream.status === 401 || upstream.status === 403) {
    throw new TokenSearchError(
      502,
      "Jupiter rejected the server API key. Check JUPITER_API_KEY in Replit Secrets.",
    );
  }
  if (upstream.status === 429) {
    throw new TokenSearchError(
      503,
      "Jupiter search is temporarily rate limited. Wait a moment and try again.",
    );
  }
  if (!upstream.ok) {
    throw new TokenSearchError(
      502,
      "Jupiter token search could not be completed. Try again later.",
    );
  }

  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    throw new TokenSearchError(502, "Jupiter returned an unreadable search response.");
  }
  if (!Array.isArray(payload)) {
    throw new TokenSearchError(502, "Jupiter returned an unexpected search response.");
  }

  const results = payload
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const token = item as Record<string, unknown>;
      if (
        typeof token.id !== "string" ||
        !token.id ||
        typeof token.name !== "string" ||
        !token.name ||
        typeof token.symbol !== "string" ||
        !token.symbol
      ) {
        return [];
      }
      return [{
        mintAddress: token.id,
        name: token.name,
        ticker: token.symbol,
        iconUrl: toHttpsIconUrl(token.icon),
      }];
    })
    .slice(0, MAX_RESULTS);

  if (payload.length > 0 && results.length === 0) {
    throw new TokenSearchError(502, "Jupiter returned token data in an unexpected format.");
  }

  return SearchSolanaTokensResponse.parse({ results });
}

router.get("/tokens/search", async (req, res): Promise<void> => {
  if (typeof req.query.query !== "string") {
    res.status(400).json(apiError("Enter a token name, ticker, or mint address."));
    return;
  }

  const parsed = SearchSolanaTokensQueryParams.safeParse({ query: req.query.query.trim() });
  if (!parsed.success) {
    res.status(400).json(apiError("Search text must contain between 1 and 120 characters."));
    return;
  }

  try {
    res.json(await searchJupiter(parsed.data.query));
  } catch (error) {
    if (error instanceof TokenSearchError) {
      req.log.warn({ statusCode: error.statusCode }, "Jupiter token search unavailable");
      res.status(error.statusCode).json(apiError(error.message));
      return;
    }
    req.log.error({ err: error }, "Jupiter token search failed unexpectedly");
    res.status(502).json(apiError("Jupiter token search is temporarily unavailable. Try again later."));
  }
});

export default router;
