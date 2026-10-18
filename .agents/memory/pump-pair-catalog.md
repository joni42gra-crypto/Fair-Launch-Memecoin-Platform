---
name: Pump.fun pair catalog
description: Official supported-pair source, snapshot refresh, and compatibility limits.
---

Use Pump.fun's official Supported Pair Assets table at `https://pump.fun/docs/custom-pairs` as the catalog source. It is a human-readable documentation table; no documented stable API or SDK for downloading the list was found. Do not substitute undocumented site endpoints or a broad third-party token list.

The table does not publish asset categories or icons. Treat categories as local display groupings and use a neutral icon fallback. A catalog entry proves only that the asset was in the published snapshot, not that it is currently eligible for a real launch.

Pump.fun also documents a one-hop exception for certain Pump.fun coins launched against a Supported Pair Asset. Without a reliable official verifier for an arbitrary mint's original launch pair, keep compatibility as “Not checked”; never infer approval from a catalog hit or a valid mint format.

**Why:** the user asked to restrict pair search to official published assets while keeping real launch eligibility unverified unless it can be confirmed authoritatively.

**How to apply:** refresh snapshots only from the official documentation page and review changes; keep catalog membership and launch compatibility as separate statuses, and do not add real launch or transaction behavior without a later explicit request.
