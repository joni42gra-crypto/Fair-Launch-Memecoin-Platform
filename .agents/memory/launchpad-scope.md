---
name: Launchpad scope
description: User guardrails for changes to the existing Solana Launchpad.
---

«Обнови существующий сайт Solana Launchpad. Не создавай новый проект и не удаляй работающие функции.»

«Пока реализуй только интерфейс и проверку полей. Не имитируй реальный запуск токена и не отправляй транзакции.»

**Why:** the user asked and repeated that existing functionality must be preserved during the redesign.

**How to apply:** keep visual changes in the existing product and preserve its working actions and data. Do not treat client-side validation or demo proposal saving as an actual Pump.fun launch or verified eligibility. Real SDK integration and server validation require an explicit later request.

The proposal creation interface must be in English («и все это на английском»).

**Why:** the user requested English when approving the canvas concept for integration into the working site.

**How to apply:** use English for visible text, validation messages, accessibility labels and notices in the proposal creation flow.

The rest of the site must match Propose's overall concept, including tab placement and sidebar navigation, not just its colors. Leave Propose itself unchanged during that migration.

**Why:** the user clarified «расположение вкладок тоже должно быть как в propose вся общая концепция» after a color-only migration left horizontal navigation.

**How to apply:** use Propose as the reference for the desktop sidebar, top bar and responsive navigation as well as visual styling.

Phantom connection is read-only: request the public address only. Do not request signatures, send transactions, or implement Pump.fun account sign-in without an officially supported third-party mechanism.

**Why:** the user explicitly limited this integration to wallet connection and prohibited transactions, secrets, and unverified Pump.fun authentication.

**How to apply:** keep Phantom integration to connect/disconnect and account-change events; treat Pump.fun's first-party login as separate from third-party authorization.

## Devnet escrow settlement boundary

Successful campaign contributions remain in the program vault until a separate settlement policy is explicitly approved. Do not add an admin withdrawal or Pump.fun purchase path by assumption; returning participant-account rent is separate from withdrawing campaign funds.

**Why:** no successful-campaign beneficiary or settlement rule was specified, so the safest prototype does not introduce a custody exit.

**How to apply:** keep failed-campaign refunds limited to each recorded participant, and retain the no-withdrawal rule for successful campaigns until the user approves a reviewed settlement design.
