import assert from 'node:assert/strict';
import {calculate,makeRows,rowToInvoice,HEADERS} from '../schema.js';
import {ADDRESS_DEFAULTS,STATES,validateAddress,validateContact} from '../delivery.js';
let passed=0;function test(name,fn){fn();passed++;console.log('PASS '+name);}
const items=[{productId:'P1',description:'Test item',size:'M',qty:1,unitPrice:799,sku:'SKU1',material:'Cotton',productType:'EMB',gsm:240,color:'Navy'}];
test('36 unique states and required offline defaults',()=>{assert.equal(STATES.length,36);assert.equal(new Set(STATES).size,36);validateAddress({...ADDRESS_DEFAULTS},'OFFLINE');});
test('PIN always required, six digits for India',()=>{assert.throws(()=>validateAddress({...ADDRESS_DEFAULTS,pin:''},'OFFLINE'));assert.throws(()=>validateAddress({...ADDRESS_DEFAULTS,pin:'12345'},'OFFLINE'));});
test('Online requires both lines; offline permits blank lines',()=>{assert.throws(()=>validateAddress({...ADDRESS_DEFAULTS},'ONLINE'));validateAddress({...ADDRESS_DEFAULTS,line1:'12 House',line2:'Street'},'ONLINE');});
test('Name/mobile and custom country/postal text limits',()=>{assert.throws(()=>validateContact('','9876543210'));assert.throws(()=>validateContact('Name','123'));assert.equal(validateContact('Name','+91 9876543210'),'919876543210');validateAddress({...ADDRESS_DEFAULTS,country:'Custom',pin:'1234'},'OFFLINE');});
test('Delivery added after discount without changing existing inclusive tax',()=>{const c=calculate(items,100,'FLAT',{TaxMode:'INCLUSIVE',TaxRate:5},40);assert.equal(c.grandTotal,739);assert.equal(c.deliveryCharges,40);assert.equal(c.taxAmount,0);});
test('Reject invalid delivery charges and excessive total',()=>{for(const n of [-1,NaN,Infinity])assert.throws(()=>calculate(items,0,'FLAT',{},n));assert.throws(()=>calculate(items,0,'FLAT',{},10000000));});
test('V2 schema round-trip preserves order, structured address and product attributes',()=>{
 const inv={...calculate(items,100,'FLAT',{},40),id:'TEST_ID',invoiceNumber:'INV-C01-261123-001',invoiceDate:'2026-11-23',customerId:'C1',customerName:'Test',customerPhone:'9876543210',customerAddress:'Test address',paymentMethod:'Cash',paymentStatus:'',createdBy:'test@example.test',createdAt:'2026-11-23T00:00:00Z',idempotencyKey:'TEST_ID',orderType:'ONLINE',deliveryAddress:{...ADDRESS_DEFAULTS,line1:'House',line2:'Street'}};
 const rows=makeRows(inv);assert.equal(rows.Invoices[0].length,HEADERS.Invoices.length);assert.equal(rows.InvoiceItems[0].length,HEADERS.InvoiceItems.length);
 const back=rowToInvoice(rows.Invoices[0]);assert.equal(back.orderType,'ONLINE');assert.equal(back.deliveryAddress.pin,'625020');assert.equal(back.deliveryCharges,40);assert.equal(back.items[0].color,'Navy');assert.equal(rows.InvoiceItems[0][14],240);
});
test('Original MRP and discounted selling price survive invoice serialization',()=>{
 const inv={...calculate([{...items[0],mrp:999,unitPrice:799}],0,'FLAT',{}),deliveryAddress:{}};
 const rows=makeRows(inv);
 assert.equal(rows.InvoiceItems[0][16],999);
 assert.equal(rows.InvoiceItems[0][8],799);
 assert.equal(rowToInvoice(rows.Invoices[0]).items[0].mrp,999);
 assert.throws(()=>calculate([{...items[0],mrp:699}],0,'FLAT',{}));
});
console.log(`RESULT ${passed} additional V2 checks passed.`);
