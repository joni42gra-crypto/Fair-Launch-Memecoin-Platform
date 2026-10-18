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
