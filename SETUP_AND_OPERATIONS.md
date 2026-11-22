# Setup and exhibition operations

Prepared 22 November 2026. Allow about five minutes for the Console fields after accounts and files are ready; permission propagation, testing and deployment take additional time.

## Hosting decision before live deployment

GitHub Pages explicitly prohibits use primarily facilitating commercial transactions. A live billing application falls within that concern. This package is static and compatible with Pages paths, but is not published. Use an HTTPS static host whose terms permit this use for live billing, and register that host's exact origin in OAuth. The Pages instructions below describe technical staging setup, not approval for commercial production use. No server or paid Google Cloud compute is required by the code.

## Console setup

1. Sign into https://console.cloud.google.com/ with the administrator account. Open the project selector, choose **New Project**, name it **Lord Look Billing**, and create/select it. Standard Sheets and Drive API use does not require attaching a billing account; do not activate a paid service or request paid quota for this setup.
2. Open **APIs & Services > Library**. Search **Google Sheets API**, open it and choose **Enable**. Repeat for **Google Drive API**.
3. Open **Google Auth Platform > Branding > Get started**. Enter **Lord Look Billing**, your monitored support email, choose **External** audience for staff Gmail accounts, enter your developer contact email, accept the required policy acknowledgement and create the configuration. If configuration already exists, edit its Branding and Audience pages.
4. In **Audience**, keep publishing status **Testing**. Under **Test users**, add the exact 17 staff Gmail addresses and the administrator if the administrator will sign in. Save. Adding someone here does not share your files with them.
5. Under **Data Access > Add or remove scopes**, select or manually enter both `https://www.googleapis.com/auth/spreadsheets` and `https://www.googleapis.com/auth/drive`. Update and save. Full Drive is a restricted scope; staff must understand that this authorization is broader than one folder. Production verification rules must be evaluated before changing publishing status.
6. Under **Clients > Create client**, choose **Web application**, name it **Lord Look Browser**, and add **Authorized JavaScript origins**. For the requested Pages staging origin enter `https://<username>.github.io`, replacing the bracketed text with your actual account name. Do not include `/repository-name/`, a trailing path, or a wildcard. Add your permitted production host origin separately. For local testing optionally add `http://localhost` and `http://localhost:8000`. This token-client popup flow needs no redirect URI.
7. Create the client and copy its **Client ID** ending in `.apps.googleusercontent.com`. Never put a client secret, service-account key or OAuth token in this project. The client ID is a public browser identifier.
8. In Google Drive, prepare a native Google Spreadsheet, not an XLSX still in Office editing mode. Use a backup/copy of the authoritative live database with exact tabs and headers from `SOURCE_AUDIT.md`. For an entirely new database, create tabs matching the CSV filenames in `schemas/` and import their contents. Populate Products with your real catalog. Do not import the sample's orphaned historical InvoiceItems as a live database.
9. Share the spreadsheet and destination PDF folder with all staff as **Editor** (or suitable shared-drive roles). Full Drive OAuth scope cannot bypass file permissions. Each cashier must be able to open both resources in Drive. Consumer My Drive uploads can consume the uploading account's storage; check storage and folder visibility on each account.
10. Copy the spreadsheet ID from `/spreadsheets/d/ID/edit` and folder ID from `/folders/ID`. Open the app's **Setup**, enter these IDs and the OAuth client ID, select that physical terminal's assigned C01–C20 counter, and confirm unique assignment. Sign in and select **Sync Catalog**. Verify the header account, counter, catalog time and pending count.

For technical Pages staging, put all application files at the repository root, keep `.nojekyll`, and choose **Settings > Pages > Deploy from a branch > main / root**. Do not commit recovery exports, customer data or test database copies. The app is served at `https://<username>.github.io/<repository>/`; the OAuth origin still excludes the repository path. Local preview: run `python -m http.server 8000` in the application folder and visit `http://localhost:8000`. Opening `index.html` as a file is unsupported.

## Relevant limits and operating budget

| Area | Limit or behavior | Consequence for 17 counters |
|---|---|---|
| Sheets reads | 300/minute/project; 60/minute/user/project | One shift-start batch read per cashier; reconciliation adds reads. Project budget is shared by all staff. |
| Sheets writes | 300/minute/project; 60/minute/user/project, separate from reads | Two successful append requests per invoice give a theoretical ceiling of 150 invoices/minute across the project before other writes, not a throughput promise. |
| Sheets requests | Recommended payload at most 2 MB; processing timeout 180 seconds | App uses small snapshots; requests are atomic individually, not across tabs or Drive. |
| Drive, new quota regime | 1,000,000 quota units/minute/project; 325,000/minute/user/project; daily 1 TB egress and 400,000,000-unit billing threshold | Check the actual project's Console quotas. Projects that used Drive between November 2025 and April 2026 retain previous quotas. |
| Drive method costs | files.create 50 units; files.get, about.get and files.generateIds 5 each; files.list 100 | Uploads and retries consume units. Standard PDF bills should be far below these quotas, subject to actual volume. |
| Drive file/storage limits | Workspace uploads 750 GB/user/day; maximum ordinary uploaded file 5 TB; account storage remains finite | API quota does not provide unlimited file storage. Monitor account storage independently. |
| OAuth Testing | At most 100 listed test users; authorization expires seven days after consent for these scopes | Re-consent before the exhibition and test each staff account. Testing is not a permanent unattended authorization arrangement. |
| Access tokens | Usually approximately one hour; actual `expires_in` is authoritative | App requests renewal below five minutes remaining or after 401. GIS may require a cashier click; cart and queue remain. |
| localStorage | Common limit 5 MiB per origin, separate from 5 MiB sessionStorage | Base64 adds approximately one-third to binary PDF size, plus JSON/text accounting. A queue of image-bearing bills can fill storage quickly. |
| Storage scope | Per browser profile and origin, not a shared database | Seventeen devices do not share counters or queue storage. Repositories on the same hostname share origin storage. Private mode, clearing data or profile loss can destroy pending jobs. |
| Offline lifetime | Cached app/library and reference data must have loaded successfully first | Cached cart math works offline. GIS sign-in and upload require connectivity. Background sync runs only while an app tab is open and runnable. |

Standard API use is currently documented at no additional cost. Google also documents planned charges for exceeding quota thresholds later in 2026; do not interpret this package as an everlasting free-service guarantee. Check the linked quota pages and Console before the event. No billing account is configured by this app.

## Numbering, retries and data safety

Assign one counter to one durable browser profile/device for the entire day. The same C04 on two devices can issue the same visible invoice number: localStorage cannot coordinate devices. Web Locks serialize sequence allocation across tabs of the same origin/profile; browsers without Web Locks fail closed. Never clear storage, change device, restore a stale backup or reuse a counter while it has same-day issued numbers. If a terminal fails, reserve a previously unused counter and preserve the old device for recovery. Sequence gaps after cancelled/failed generation are intentional; numbers are never rolled back.

Each saved bill first persists its PDF and row snapshot as one queue entry. If storage is full, the app does not report success or clear the cart. Export recovery data and resolve capacity before continuing. The popup is opened from the Generate click, but the completed PDF is handed over only after durable enqueue. This intentionally prioritizes bill preservation over showing a PDF for an unrecorded job.

PDF upload uses a persisted Drive-generated ID, allowing the same ID to be retried. Sheets append has no idempotency key or uniqueness constraint. If an append response is lost, the app reads back the invoice and compares complete expected rows. Matching rows advance the job; absent, partial or conflicting rows stop in **Review**. It does not blindly append again. An administrator must inspect both Invoices and InvoiceItems after in-flight requests have settled before explicitly authorizing a retry. The UI imposes a three-minute minimum before this action, but this is not a proof of exactly-once delivery. Keep an audit record of manual decisions. Drive and the two Sheets appends are not a distributed transaction.

All textual USER_ENTERED values are escaped to preserve phone/SKU text and prevent formula injection. Invoice history is immutable in this UI. Products and Customers administration opens the source Sheet; calculated Customers.TotalOrders/LastInvoiceDate and AppLogs are not updated by this migration. Customer lookup additionally derives recent customers from invoice snapshots. No stock availability claim is made: the supplied schema contains no inventory quantity column. All editors can change the underlying spreadsheet, so file sharing is not role-based cashier isolation.

## Shift checklist and acceptance gate

Before live use, perform these checks on a separate test spreadsheet and folder, then verify production configuration:

1. Load online on every terminal; sign in as the assigned staff member, grant both scopes, sync the catalog, verify unique counter assignment and confirm actual jsPDF is available. Confirm each staff upload is visible to the administrator.
2. Generate the source example (799 subtotal, 100 discount, inclusive tax, 699 due). Inspect the real PDF against the workbook for logo, signature, paid stamp, rupee symbol, customer fields, totals and printing. Repeat with unpaid, long descriptions/addresses, non-Latin text and at least 60 lines. Field mapping was checked locally; actual jsPDF pixel fidelity remains unverified.
3. Measure actual search/math and PDF generation on the slowest cashier device, cold and warm. Targets below 10 ms and 150 ms are acceptance targets, not universal guarantees. Raster text/images and long bills increase PDF time and size.
4. Turn Wi-Fi off, create several bills, reload the cached page, verify the persisted queue/cart, restore Wi-Fi and confirm one PDF and exactly the intended header/items per bill. Repeat across 17 real terminals. Check Google project quotas during catch-up.
5. Test expired authorization and a blocked popup; use Sign in when requested and verify the active cart is unchanged. Test denied scope, wrong account, revoked folder access, full storage, damaged local data and recovery export.
6. Simulate a lost append response in a controlled test and verify Review behavior; do not use the retry override until both destination tabs have been checked. Export recovery data before destructive browser maintenance.
7. At shift end leave tabs open until pending count is zero; reconcile row counts, totals and PDF links. Preserve exported recovery data securely if any job remains unresolved. The export contains customer data and PDFs, but no bearer token. There is no automatic recovery import in this version; administrator recovery is deliberate to prevent stale sequence/job replay.

## Official references

- Sheets quotas and pricing: https://developers.google.com/workspace/sheets/api/limits
- Drive quotas and pricing: https://developers.google.com/workspace/drive/api/guides/limits
- Enable APIs: https://developers.google.com/workspace/guides/enable-apis
- Consent setup: https://developers.google.com/workspace/guides/configure-oauth-consent
- OAuth test audience: https://support.google.com/cloud/answer/15549945
- Browser client origins: https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid
- Token model and user interaction: https://developers.google.com/identity/oauth2/web/guides/use-token-model
- Drive permission model: https://developers.google.com/workspace/drive/api/guides/manage-sharing
- Storage quotas: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- No localStorage locking guarantee: https://html.spec.whatwg.org/multipage/webstorage.html
- Pages restrictions: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits

## Values to supply

Your OAuth Web Client ID, native Google Spreadsheet ID, destination Drive Folder ID, actual HTTPS hosting origin, and a unique terminal-to-counter assignment list. Add the staff emails yourself in Console and Drive sharing; no passwords, client secrets or access tokens are needed here.
