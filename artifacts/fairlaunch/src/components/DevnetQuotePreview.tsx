import { useEffect, useState } from "react";
import { useGetDevnetSolQuote } from "@workspace/api-client-react";

function formatLamports(lamports: string): string {
  const value = BigInt(lamports);
  const whole = value / 1_000_000_000n;
  const fractional = (value % 1_000_000_000n)
    .toString()
    .padStart(9, "0")
    .replace(/0+$/, "");
  return `${whole}${fractional ? `.${fractional}` : ""}`;
}

export function DevnetQuotePreview() {
  const quoteQuery = useGetDevnetSolQuote({
    query: {
      queryKey: ["devnet-sol-quote"],
      enabled: false,
      retry: false,
      refetchOnWindowFocus: false,
    },
  });
  const [now, setNow] = useState(Date.now());
  const quote = quoteQuery.data;
  const expired = !!quote && quote.expiresAt * 1_000 <= now;
  const errorStatus = (quoteQuery.error as (Error & { status?: number }) | null)?.status;

  useEffect(() => {
    if (!quote) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [quote]);

  return (
    <section className="devnet-quote-card" aria-label="Devnet contribution quote">
      <div className="devnet-quote-heading">
        <span className="section-kicker">Devnet · Pyth Core</span>
        <span className="devnet-quote-tag">QUOTE PREVIEW</span>
      </div>
      {quote && !quoteQuery.error ? (
        <div className="devnet-quote-result" aria-live="polite">
          <div>
            <span className="field-hint">Required amount for $10</span>
            <strong>{formatLamports(quote.requiredLamports)} SOL</strong>
            <span className="field-hint">Rounded up to the next lamport</span>
          </div>
          <span className={`devnet-quote-expiry ${expired ? "is-expired" : ""}`}>
            {expired ? "Quote expired" : `Valid for ${Math.ceil((quote.expiresAt * 1_000 - now) / 1_000)}s`}
          </span>
        </div>
      ) : quoteQuery.error ? (
        <p className="devnet-quote-error" role="status">
          {errorStatus === 503
            ? "Live quote unavailable. Add PYTH_API_KEY in Replit Secrets to enable Pyth quotes."
            : "Pyth quote could not be verified. No sample or fallback price is shown."}
        </p>
      ) : (
        <p className="devnet-quote-copy">
          Fetch a short-lived SOL/USD price quote. This does not reserve an amount or create a transaction.
        </p>
      )}
      <button
        className="button button-outline button-wide devnet-quote-button"
        type="button"
        onClick={() => void quoteQuery.refetch()}
        disabled={quoteQuery.isFetching}
        data-testid="button-devnet-quote"
      >
        {quoteQuery.isFetching
          ? "Fetching Pyth quote…"
          : quote && !expired
            ? "Refresh quote"
            : "Get live Devnet quote"}
      </button>
      <p className="devnet-quote-disclaimer">
        Preview only. No transaction is built or sent. A future entry will also need separate account rent and network fees; rent is recoverable, fees are not.
      </p>
    </section>
  );
}
