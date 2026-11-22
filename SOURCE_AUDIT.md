# Source and parity audit

Inspected with Python `zipfile` and `openpyxl 3.1.5` before implementation. Both ZIPs were extracted. The additional sample workbook supplied in `inputs` was inspected alongside the named invoice template.

## Inputs

- `Invoice Generator.zip`: `Code.gs`, `Configuration.gs`, `Database.gs`, `Invoice.gs`, `PDFGenerator.gs`, `WhatsApp.gs`, `ndex.html`, `JScript.html`, `Styls.html`, `appsscript.json`.
- `LordLook_GitHubPages_And_AppsScript (1).zip`: GitHub frontend HTML/CSS/JS, seven Apps Script backend/config files and deployment README.
- `LordLook_Invoice_Template.xlsx`: only the `Invoice` worksheet.
- `LordLook_Invoice_sample.xlsx`: `Invoice`, `Settings`, `Products`, `Customers`, `Invoices`, `InvoiceItems`.

## Findings and discrepancies

| Finding | Source evidence | Treatment |
|---|---|---|
| Schema is not declared in Code.gs | `Configuration.gs` owns `SHEET_NAMES` and header arrays; `Database.gs` and `Invoice.gs` use positional arrays | Preserved the actual arrays in `schema.js`, verified against the sample workbook |
| Template is not a database workbook | Named template contains only `Invoice` | Setup requires an existing native Google spreadsheet with the reference and ledger tabs; header CSVs supplied |
| Sample shifts the invoice left | Sample starts in A; named template starts in B | Named template and user screenshot chosen for PDF field layout |
| Totals differ by a row as well as a column | Sample subtotal D26/F26, total D29/F29; named template E27/G27, E30/G30 | Reported explicitly; not claimed to be identical workbooks |
| Three formula gaps | Named template G21:G23 blank; sample corresponding F21:F23 blank | Every app line amount is calculated independently; all item rows work |
| Different whitespace behavior | Original optimized PDFGenerator removes unused rows; GitHub frontend and template retain six slots | PDF retains six minimum rows, then adds wrapped rows/pages |
| Original template initializer can produce a blank sheet | Optimized `ensureInvoiceTemplateSheet_` inserts an empty sheet without constructing it | Browser PDF does not depend on a mutable template sheet |
| Original HTML file-name mismatch | Code asks for `Index`, partials `Styles`/`JavaScript`; ZIP names are `ndex.html`, `Styls.html`, `JScript.html` | Explicit static file imports remove this dependency |
| GitHub frontend transport is broken | `runBackend()` returns no chainable runner, but callers use `.withFailureHandler()` / `.saveInvoiceAndGeneratePdf()` on its return; several calls invoke bootstrap instead of their intended mutation | Replaced with async direct API modules |
| Backend versions disagree | Optimized Invoice.gs exposes `saveInvoiceFast` and background upload; other Invoice.gs exposes synchronous save and payment-status update; Code.gs dispatches methods absent in one version | Replaced dispatch with a single local snapshot and staged queue |
| Currency corruption | Some Apps Script defaults/PDF formats contain `?` instead of the rupee symbol | UI uses ₹; PDF uses browser-font rendering for ₹ and non-Latin strings |
| Settings tax fields were not fully honored | Frontend always emits `taxAmount: 0`, despite TaxMode / TaxRate settings | Inclusive semantics preserved; exclusive calculation now implemented |
| Discount could exceed subtotal | Old code clamps the grand total to zero, leaving a discount larger than subtotal | Invalid discounts are rejected |
| Unsafe default pricing | Invalid SizesJSON falls back to an invented L:799 price; fixed S–XXL editor omits sample XS sizes | Malformed catalog is rejected, prior cache retained, arbitrary size keys preserved |
| Stock is absent | Products header has ProductID, SKU, ProductName, Category, SizesJSON, Active, UpdatedAt | No stock guarantees or invented stock columns |
| Sample history is incomplete | Invoices contains a header only, while InvoiceItems contains historical rows | Do not treat the sample as a complete live-data backup or import those orphan rows into production |
| Sample settings differ from printed template | ContactLine is blank in sample Settings; old sequence is zero; a DriveFolderId exists in the sample | Existing blank contact remains intentional when syncing; old sequence is unused; folder ID is not hardcoded or selected automatically |
| AppLogs missing in sample | Apps Script initializes it; sample omits it | Not required for cashier bootstrap; optional header CSV supplied, no silent log-sheet creation |
| Legacy revisions duplicate normalized rows | Invoice header overwritten while InvoiceItems appends the revision again | Issued invoices read-only; corrections require an administrator workflow |

## Exact column mappings

`Products` (7): ProductID, SKU, ProductName, Category, SizesJSON, Active, UpdatedAt.

`Customers` (7): CustomerID, CustomerName, MobileNumber, Address, TotalOrders, LastInvoiceDate, UpdatedAt.

`Settings` (3): SettingKey, SettingValue, Description.

`Invoices` (20): InvoiceID, InvoiceNumber, InvoiceDate, CustomerID, CustomerName, CustomerPhone, CustomerAddress, PaymentMethod, PaymentStatus, Subtotal, Discount, TaxLabel, TaxAmount, GrandTotal, ItemsJSON, PdfFileId, PdfUrl, IdempotencyKey, CreatedBy, CreatedAt.

`InvoiceItems` (11): ItemRowID, InvoiceID, InvoiceNumber, LineNumber, ProductID, ProductDescription, Size, Quantity, UnitPrice, LineTotal, CreatedAt.

`AppLogs` (6, optional/not written): Timestamp, Level, Action, InvoiceNumber, UserEmail, Details.

The Invoices append includes the Drive file ID in P and `webViewLink` in Q. InvoiceItems has no PDF column in the source schema, so it links by InvoiceID/InvoiceNumber rather than silently adding a column.

## PDF field coverage

| Named template reference | Browser PDF field |
|---|---|
| F2:H7 | Business name, tagline, two address lines, contact, website |
| G10:H11 | Invoice number and date |
| B14:B17 | Bill-to heading, customer name, phone and optional address |
| F14:F15 | Payment-method heading and value |
| B19:G19 | #, ITEM DESCRIPTION, SIZE, QTY, UNIT PRICE, AMOUNT |
| B20:G25 | Minimum six rows; amounts = quantity × unit price |
| G27, G28 | Subtotal and discount |
| E29, G29 | Tax label and additional tax, if exclusive |
| E30:G30 | Black total bar, subtotal − discount + additional tax |
| B33 | Thank-you note |
| F37:F38 | Signature line and caption |
| B41 | Bottom brand |
| Embedded images | Source logo, signature, paid stamp; stamp shown only for PAID |

**Parity boundary:** exact field/header order and reference arithmetic were checked. Pixel-perfect PDF parity is not certified: the reference sources disagree, direct PDF text uses Helvetica/browser font fallback instead of the workbook's exact typography, and this environment could not load the actual jsPDF CDN. Long invoices intentionally paginate rather than shrink all text onto one page. The live HTML preview is a responsive representation, not the authoritative print document; print the saved PDF.
