export const HEADERS = Object.freeze({
  Products: ['ProductID','SKU','ProductName','Category','SizesJSON','Active','UpdatedAt','ClothMaterial','ProductType','GSM','ColorsJSON','MRPBySizeJSON'],
  Customers: ['CustomerID','CustomerName','MobileNumber','Address','TotalOrders','LastInvoiceDate','UpdatedAt','Country','PinCode','AddressLine1','AddressLine2','Landmark','City','State'],
  Settings: ['SettingKey','SettingValue','Description'],
  Invoices: ['InvoiceID','InvoiceNumber','InvoiceDate','CustomerID','CustomerName','CustomerPhone','CustomerAddress','PaymentMethod','PaymentStatus','Subtotal','Discount','TaxLabel','TaxAmount','GrandTotal','ItemsJSON','PdfFileId','PdfUrl','IdempotencyKey','CreatedBy','CreatedAt','OrderType','DeliveryCharges','Country','PinCode','AddressLine1','AddressLine2','Landmark','City','State'],
  InvoiceItems: ['ItemRowID','InvoiceID','InvoiceNumber','LineNumber','ProductID','ProductDescription','Size','Quantity','UnitPrice','LineTotal','CreatedAt','SKU','ClothMaterial','ProductType','GSM','Color','MRP'],
  AppLogs: ['Timestamp','Level','Action','InvoiceNumber','UserEmail','Details','EventID']
});
export const TEMPLATE_MAP = Object.freeze({businessName:'F2',tagline:'F3',addressLine1:'F4',addressLine2:'F5',contact:'F6',website:'F7',invoiceNumber:'G10',invoiceDate:'G11',customerName:'B15',customerPhone:'B16',customerAddress:'B17',paymentMethod:'F15',headers:'B19:G19',items:'B20:G25',subtotal:'G27',discount:'G28',taxLabel:'E29',taxAmount:'G29',grandTotal:'G30',thankYou:'B33',signature:'F38',brand:'B41'});
export function assertHeaders(name, values) {
  const expected = HEADERS[name];
  if (!values?.[0] || expected.some((h,i) => values[0][i] !== h)) throw new Error(`Schema mismatch in ${name}. Expected: ${expected.join(', ')}`);
}
export const sheetText = value => typeof value === 'string' ? "'" + value : value;
export const safeRows = rows => rows.map(row => row.map(sheetText));
export function money(value, label = 'Amount') {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 10000000) throw new Error(`${label} must be between 0 and 10,000,000.`);
  return Math.round((n + Number.EPSILON) * 100);
}
export function calculate(items, discountValue, discountMode, settings, deliveryCharges = 0) {
  let subtotal = 0;
  const clean = items.map((item, i) => {
    const qty = Number(item.qty), price = money(item.unitPrice, 'Unit price');
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > 9999) throw new Error('Quantity must be a whole number between 1 and 9999.');
    if (!String(item.description).trim() || String(item.description).length > 300) throw new Error('Each description must contain 1–300 characters.');
    if (String(item.size).length > 20) throw new Error('Size is too long.');
    if (item.mrp != null && money(item.mrp, 'MRP') < price) throw new Error('Selling price exceeds MRP.');
    const amount = price * qty; subtotal += amount;
    return {...item, description: String(item.description).trim(), lineNumber: i+1, qty, unitPrice: price/100, amount: amount/100};
  });
  if (!Number.isSafeInteger(subtotal) || subtotal > 1000000000) throw new Error('Invoice exceeds the supported total of INR 10,000,000.');
  const rawDiscount = money(discountValue, 'Discount');
  if (discountMode === 'PCT' && rawDiscount > 10000) throw new Error('Discount cannot exceed 100%.');
  const discount = discountMode === 'PCT' ? Math.round(subtotal * rawDiscount / 10000) : rawDiscount;
  if (discount > subtotal) throw new Error('Discount cannot exceed subtotal.');
  const rate = Number(settings.TaxRate ?? 5), mode = String(settings.TaxMode || 'INCLUSIVE').toUpperCase();
  if (!Number.isFinite(rate) || rate < 0 || rate > 100 || !['INCLUSIVE','EXCLUSIVE'].includes(mode)) throw new Error('Invalid TaxRate or TaxMode in Settings.');
  const delivery = money(deliveryCharges, 'Delivery charges');
  const taxable = subtotal - discount;
  const tax = mode === 'EXCLUSIVE' ? Math.round(taxable * rate / 100) : 0;
  if(taxable+tax+delivery>1000000000)throw new Error('Invoice total exceeds INR 10,000,000.');
  return {items:clean, subtotal:subtotal/100, discount:discount/100, taxAmount:tax/100, deliveryCharges:delivery/100, grandTotal:(taxable+tax+delivery)/100,
    taxLabel: mode === 'INCLUSIVE' ? `Tax (GST ${rate}%) included` : `Tax (GST ${rate}%)`,
    includedTax: mode === 'INCLUSIVE' ? Math.round(taxable * rate / (100+rate))/100 : 0};
}
export function makeRows(inv) {
  if (JSON.stringify(inv.items).length > 45000) throw new Error('Line item snapshot exceeds the supported Sheets cell size. Split this invoice.');
  return {
    Invoices: [[inv.id,inv.invoiceNumber,inv.invoiceDate,inv.customerId,inv.customerName,inv.customerPhone,inv.customerAddress,inv.paymentMethod,inv.paymentStatus,inv.subtotal,inv.discount,inv.taxLabel,inv.taxAmount,inv.grandTotal,JSON.stringify(inv.items),'','',inv.idempotencyKey,inv.createdBy,inv.createdAt,inv.orderType || '',inv.deliveryCharges || 0,...['country','pin','line1','line2','landmark','city','state'].map(k=>inv.deliveryAddress?.[k] || '')]],
    InvoiceItems: inv.items.map(it => [inv.id+'-L'+it.lineNumber,inv.id,inv.invoiceNumber,it.lineNumber,it.productId,it.description,it.size,it.qty,it.unitPrice,it.amount,inv.createdAt,it.sku || '',it.material || '',it.productType || '',it.gsm || '',it.color || '',it.mrp ?? ''])
  };
}
export function rowToInvoice(r) {
  let items; try { items = JSON.parse(r[14] || '[]'); } catch { throw new Error('Invalid ItemsJSON for invoice ' + r[1]); }
  let date = r[2];
  if (typeof date === 'number') date = new Date(Date.UTC(1899,11,30) + date * 86400000).toISOString().slice(0,10);
  return {id:r[0],invoiceNumber:r[1],invoiceDate:String(date || ''),customerId:r[3],customerName:r[4],customerPhone:String(r[5] || ''),customerAddress:r[6] || '',paymentMethod:r[7],paymentStatus:r[8],subtotal:Number(r[9]),discount:Number(r[10]),taxLabel:r[11],taxAmount:Number(r[12]),grandTotal:Number(r[13]),items,pdfFileId:r[15] || '',pdfUrl:r[16] || '',idempotencyKey:r[17],createdBy:r[18],createdAt:r[19],orderType:r[20] || '',deliveryCharges:Number(r[21] || 0),deliveryAddress:{country:r[22] || '',pin:String(r[23] || ''),line1:r[24] || '',line2:r[25] || '',landmark:r[26] || '',city:r[27] || '',state:r[28] || ''}};
}
