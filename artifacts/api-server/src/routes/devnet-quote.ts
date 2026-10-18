import { Router, type IRouter } from "express";
import {
  ApiError,
  GetDevnetSolQuoteResponse,
} from "@workspace/api-zod";
import { requestSolUsdQuote } from "../lib/sol-quote.js";

const router: IRouter = Router();
type SolQuote = Awaited<ReturnType<typeof requestSolUsdQuote>>;
let cachedQuote: SolQuote | undefined;
let inFlightQuote: Promise<SolQuote> | undefined;

function apiError(message: string): ApiError {
  return { error: message };
}

async function getFreshQuote(apiKey: string): Promise<SolQuote> {
  const now = Math.floor(Date.now() / 1_000);
  if (cachedQuote && cachedQuote.expiresAt > now) return cachedQuote;
  if (!inFlightQuote) {
    inFlightQuote = requestSolUsdQuote(apiKey)
      .then(quote => {
        cachedQuote = quote;
        return quote;
      })
      .finally(() => {
        inFlightQuote = undefined;
      });
  }
  return inFlightQuote;
}

router.get("/devnet/sol-quote", async (req, res): Promise<void> => {
  const apiKey = process.env.PYTH_API_KEY?.trim();
  if (!apiKey) {
    res.status(503).json(apiError(
      "Pyth price quotes are not configured. Add PYTH_API_KEY in Replit Secrets to enable live Devnet quotes.",
    ));
    return;
  }

  try {
    const quote = GetDevnetSolQuoteResponse.parse(await getFreshQuote(apiKey));
    res.json(quote);
  } catch (error) {
    req.log.error({ err: error }, "Devnet Pyth SOL/USD quote request failed");
    res.status(502).json(apiError(
      "A fresh SOL/USD quote could not be verified with Pyth. No estimated or sample price is available; try again later.",
    ));
  }
});

export default router;
