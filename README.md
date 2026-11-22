# Lord Look client-side billing migration

This package contains the complete static application, source audit, setup instructions and executable tests. No Sheet ID, folder ID or OAuth Client ID is embedded in the application. Enter your real values in the first-run Setup dialog.

**Release status: implemented and locally tested; live acceptance is outstanding.** Google authorization, actual Sheets/Drive calls, actual jsPDF rendering and the 150 ms PDF target were not verified in this environment. The test fixtures are explicitly simulated and are never loaded by `index.html`. Do not replace the exhibition's working system until the acceptance checks in `SETUP_AND_OPERATIONS.md` pass on the actual devices.

## Files

| File | Responsibility |
|---|---|
| `index.html`, `styles.css` | Responsive black/gold/cream billing interface, Setup dialog, persistent account/counter/catalog/queue indicators |
| `config.js` | Validated local configuration, atomic-with-Web-Locks sequence allocation, India date handling |
| `auth.js` | GIS token client, memory-only bearer token, expiry and 401 renewal, user-click fallback |
| `api.js` | Single batch catalog load, schema checks, Drive multipart uploads, staged append queue and reconciliation |
| `pdf-generator.js` | Direct jsPDF A4 drawing, six minimum item rows, wrapped multi-page invoices, source branding images |
| `app.js` | Local cart, search, customer lookup, discounts, snapshots, history, recovery export and sharing |
| `schema.js` | Exact source column order, calculations, safe USER_ENTERED values and template cell map |
| `assets.js`, `defaults.js` | Branding extracted from the supplied workbook; no remote image dependencies |
| `sw.js` | Offline application shell and pinned jsPDF CDN cache; never caches Google API responses or bearer tokens |
| `schema/` | Header-only CSV files and source-derived Settings defaults for preparing an empty database |
| `tests/` | Python orchestration, Acorn parsing/reference checks, core simulations and Chrome browser checks |
| `VERIFICATION_OUTPUT.txt` | Captured verification output from this environment |

## Run locally

From this directory, run `python -m http.server 8080 --bind 127.0.0.1`, then open `http://localhost:8080`. Do not open `index.html` through a `file://` URL. OAuth local development requires registering `http://localhost` and `http://localhost:8080` as authorized origins. Use a separate test spreadsheet and folder for acceptance.

No build step or npm install is needed to use the application. Initial internet access is required for Google sign-in, catalog sync and the pinned jsPDF script. Wait for the initial load and verify an offline reload before beginning a shift. The service worker cannot sync Google jobs while the page is closed; reopen and sign in to resume.

For automated checks, run `node tests/core.test.mjs`. With Python `openpyxl` installed, run `python tests/verify.py PATH_TO_ORIGINAL_INPUTS`; omit the path to skip source-file comparison. For the browser suite, install Playwright and Chrome, then run `node tests/browser.test.mjs`. Alternatively set `LORDLOOK_PLAYWRIGHT` to an installed Playwright module directory. The AST checker uses the Acorn bundled in Node 24.

## Deliberate behavior changes

- Issued invoices are immutable in the cashier UI. Reprinting cannot resubmit or revise a bill.
- Product, customer-master and Settings administration opens the real Google Sheet. This avoids replacing Apps Script's server lock with unsafe browser read-modify-write operations.
- New billing contacts are stored in the invoice snapshot and added to the derived customer directory at catalog sync. The application does **not** increment `Customers.TotalOrders`, mutate existing customer rows, or append `AppLogs`. Existing master customers still autofill. Legacy customer counters therefore are not a current sales report; calculate counts from `Invoices`.
- Inclusive tax retains the source's `TaxAmount = 0` meaning: tax added to the total. Included GST is calculated separately, not added again. Exclusive tax is calculated after discount using `TaxMode` and `TaxRate`.
- Existing prices remain frozen in the active cart during Sync Catalog. New items use the refreshed catalog. Branding/tax settings are frozen for the active invoice once its settings snapshot exists.
- The schema has no inventory quantity or stock reservation. This app cannot prevent overselling.
- The PDF is generated locally, then the complete queue entry is durably stored before the PDF is handed to the customer. This intentionally closes the original print-before-persist data-loss window.
- New numbers use `INV-Cxx-YYMMDD-SEQ`. Internal `InvoiceID` and `IdempotencyKey` use the same random UUID-based identity; they are separate from the human invoice number.

## Important hosting constraint

The output is technically compatible with static hosting, including GitHub Pages paths. However, GitHub explicitly prohibits using Pages for websites primarily directed at facilitating commercial transactions. A live cashier invoice generator raises this restriction. Use a host whose terms permit this workload or obtain clarification from GitHub before using Pages for live billing. Nothing has been published by this task.

See the full findings and boundaries in `SOURCE_AUDIT.md`, `DEBUGGING_REPORT.md`, and `SETUP_AND_OPERATIONS.md`.
