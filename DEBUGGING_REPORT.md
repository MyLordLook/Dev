# Debugging report

The exact command output is captured in `VERIFICATION_OUTPUT.txt`. Tests use synthetic identifiers only in `tests/`; production configuration remains empty until supplied by the operator.

## Bugs found and fixed in the migration

1. **Uncertain item writes could not resume.** The queue stopped on a job's global `review` flag after its already-complete Invoices stage, never reaching InvoiceItems reconciliation. It now checks completion of the current stage. The lost-item-response regression test passes.
2. **Setup could disable billing in its own tab.** The app released and immediately reacquired its Web Lock before the browser had finished releasing it. It now awaits the old lock task. Chrome caught this as a disabled product-search input after successful Setup.
3. **Dynamically rendered controls escaped the secondary-tab lock.** Initial inputs were disabled, but regenerated product buttons/cart fields were enabled. Dynamic controls are now disabled and draft writes are guarded. Browser checks assert all builder controls are disabled in the secondary tab.
4. **Scanner Enter prevention was deferred.** Wrapping the key handler in a microtask could let the browser submit the form before `preventDefault()`. Enter prevention now runs synchronously. The browser test confirms exactly one item and no invoice submission.
5. **Concurrent token refresh callers could receive a premature reauthorization error.** Token access now joins the in-progress authorization promise before applying the retry cooldown. Three concurrent near-expiry callers cause one renewal.
6. **Account identity could change during token renewal.** Jobs now pin their expected account on every Google request, checked after token acquisition, before transmitting a write. A wrong-account test confirms zero outbound requests.
7. **External scripts could delay offline startup.** GIS and jsPDF CDN scripts load asynchronously, allowing the cached UI to start even when those hosts cannot be reached. A missing PDF library produces an explicit save error rather than issuing an incomplete invoice.
8. **Long branding lines could overlap invoice metadata.** PDF metadata, customer details and table start move down when the company header wraps. Overlong branding settings are rejected instead of silently clipped.
9. **Oversized item snapshots could exceed a Sheets cell limit.** ItemsJSON is capped conservatively at 45,000 characters and advises splitting the invoice.
10. **Damaged startup storage could prevent recovery export.** Recovery actions are bound before reading potentially damaged cached data. Billing remains blocked rather than replacing unreadable data silently.

## Source defects removed or guarded

- Broken chainable Apps Script transport and mismatched HTML partial names.
- Mock/sample customers, dates and prices appearing as live startup data.
- Shared sequence increments and last-row assumptions.
- Transient in-memory background saves without a persistent queue.
- Upload retries that could create duplicate PDFs: use a persisted pre-generated Drive ID and verify a 409 response's existing file.
- Append retries that could duplicate bills after lost responses: reconcile exact IDs/rows, hold unknown/partial/conflicting outcomes for review.
- Unsafe HTML interpolation of customer/product text: escape dynamic markup and use event delegation.
- USER_ENTERED formula injection and phone/date coercion: prefix all string cells with an apostrophe; keep numeric money/quantities numeric.
- CSV quote/formula handling: quote and escape every field and neutralize formula-leading strings.
- Floating-point summation, invalid quantities and excessive discounts: calculate in integer paise and validate bounds.
- Invented default price after corrupt SizesJSON, zero-price fallback mistakes, and missing XS support.
- Off-page long invoices, missing amount formulas and conditional stamp handling.
- Reprinting that could mutate/resubmit an issued invoice.

## Verification performed

- Python inspected both archives and both workbooks using `zipfile`/`openpyxl`.
- Node/V8 parsed every production module; Acorn parsed ASTs, checked lexical references and local imports.
- Python checked HTML IDs, controller references, local resource paths and absence of Apps Script/shared numbering calls.
- Original Apps Script arrays and sample workbook headers were compared with `schema.js`.
- Reference formulas, headers and three embedded source images were checked; known workbook discrepancies were asserted explicitly.
- Core tests exercised tax/discount boundaries, formula escaping, storage failure, simulated concurrent locks, OAuth renewal/denied scopes, offline jobs, upload idempotency, staged reconciliation and PDF A4 coordinate bounds.
- Real headless Chrome exercised setup, SKU/size lookup, reference total, mobile width, real Web Locks, offline saving/reloading, cart retention and 17 isolated counter profiles.

## What the results do not establish

- Google APIs and GIS were simulated; no staff consent, production folder permissions, actual append behavior or live rate limits were tested.
- The jsPDF CDN could not resolve (`ENOTFOUND` / `ERR_NAME_NOT_RESOLVED`). A clearly labeled PDF command recorder tested coordinate and control-flow logic. It is not jsPDF and its test blobs are not production PDFs.
- The actual ₹ glyph, Tamil/browser-font fallback, printed output, exact fonts and visual pagination must be inspected using real jsPDF on a connected device.
- No actual PDF generation timing is reported as meeting 150 ms. The UI measures elapsed generation time on the cashier device; capture cold and warm timings during acceptance.
- Local lookup latency depends on catalog size, device and rendering. No universal 10 ms guarantee is made.
- The 17-profile number test assumes distinct assigned counter IDs. It does not prevent two independent devices being misconfigured with the same counter or storage being cleared.
- `values.append` plus Drive uploads is not an atomic cross-service transaction. A bill can temporarily exist in Drive/Invoices while InvoiceItems is pending. Its queue state remains visible.
- Static/schema tests do not establish 1:1 visual template parity or full legacy feature parity. Deliberate administration/revision/customer-counter changes are listed in README.

The runtime also initially lacked `openpyxl` on PATH. The installed primary Python runtime supplied version 3.1.5. An inspection-helper issue with openpyxl image-anchor string representations was fixed by reading anchor row/column fields directly. Test harness issues (the simulated account field name and Acorn UMD initialization) were corrected before the final runs; they were not product fixes.
