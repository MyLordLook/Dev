import {ASSETS} from './assets.js';
import {DEFAULT_SETTINGS} from './defaults.js';
export const LAYOUT = Object.freeze({width:210,height:297,margin:8,right:202,tableTop:118,tableHeader:10,rowMin:8.5,columns:[8,17,83,108,127,165,202],bottom:285});
const GOLD = '#B08D4A';
export function dateDisplay(value) {
  const parts=String(value).split('-');
  if(parts.length!==3) return String(value);
  return `${parts[2]} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(parts[1])-1]} ${parts[0]}`;
}
export function generatePDF(invoice, sourceSettings = {}, PdfClass = window.jspdf?.jsPDF) {
  if(!PdfClass) throw new Error('PDF library is not available. Connect once and reload before starting the shift.');
  const started=performance.now(), s={...DEFAULT_SETTINGS,...sourceSettings};
  for(const key of ['BusinessName','Tagline','AddressLine1','AddressLine2','ContactLine','Website','ThankYouNote','SignatureCaption','BottomBrandText']) {
    const limit={BusinessName:28,Tagline:45,ThankYouNote:90,SignatureCaption:50,BottomBrandText:32}[key] || 100;
    if(String(s[key] || '').length>limit)throw new Error(`Settings.${key} exceeds the invoice layout limit of ${limit} characters.`);
  }
  const doc=new PdfClass({orientation:'portrait',unit:'mm',format:'a4',compress:true,putOnlyUsedFonts:true});
  doc.setProperties({title:'Invoice '+invoice.invoiceNumber,author:s.BusinessName,creator:'Lord Look'});
  const unicodeCache=new Map();
  function write(value,x,y,size=10,style='normal',color='#000000',align='left') {
    const text=String(value ?? '').replace(/[\u2013\u2014]/g,'-');
    doc.setFont('helvetica',style);doc.setFontSize(size);doc.setTextColor(color);
    if(/[^\x20-\x7e\xa0-\xff]/.test(text)) {
      // Browser font fallback preserves rupee and customer names outside the built-in PDF font.
      const key=[text,size,style,color].join('|');let rendered=unicodeCache.get(key);
      if(!rendered) {
        const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
        const px=size*4;ctx.font=`${style==='bold'?'bold ':''}${px}px Arial, sans-serif`;
        canvas.width=Math.max(1,Math.ceil(ctx.measureText(text).width)+8);canvas.height=Math.ceil(px*1.6);
        ctx.font=`${style==='bold'?'bold ':''}${px}px Arial, sans-serif`;ctx.fillStyle=color;ctx.textBaseline='alphabetic';ctx.fillText(text,4,px*1.15);
        rendered={data:canvas.toDataURL('image/png'),w:canvas.width*25.4/288,h:canvas.height*25.4/288};unicodeCache.set(key,rendered);
      }
      const left=align==='right'?x-rendered.w:align==='center'?x-rendered.w/2:x;
      doc.addImage(rendered.data,'PNG',left,y-rendered.h*.72,rendered.w,rendered.h,undefined,'FAST');
    } else doc.text(text,x,y,{align});
  }
  function wrap(value,width,size=10,style='normal') {
    const text=String(value || '').replace(/[\u2013\u2014]/g,'-');
    doc.setFont('helvetica',style);doc.setFontSize(size);
    if(!/[^\x20-\x7e\xa0-\xff]/.test(text)) return doc.splitTextToSize(text,width);
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=`${style==='bold'?'bold ':''}${size*4}px Arial, sans-serif`;
    const lines=[];let current='';
    for(const char of text) {if(char==='\n' || ctx.measureText(current+char).width*25.4/288>width){lines.push(current);current=char==='\n'?'':char;}else current+=char;}
    lines.push(current);return lines;
  }
  function lines(value,x,y,width,size=10,style='normal',color='#000000',align='left') {
    const result=wrap(value,width,size,style);result.forEach((line,i)=>write(line,x,y+i*size*.42,size,style,color,align));return result.length*size*.42;
  }
  const logo=ASSETS.logo;doc.addImage(logo.data,'JPEG',14,21,78,78*logo.height/logo.width,'logo');
  write(s.BusinessName,200,14,18,'bold','#000000','right');
  write(s.Tagline,200,21,10,'italic','#6E6E6E','right');
  let headerY=27;
  for(const key of ['AddressLine1','AddressLine2','ContactLine','Website']) headerY+=lines(s[key],200,headerY,101,8.5,'normal',key==='ContactLine'?'#1155CC':'#3A3A3A','right')+1;
  if(s.GSTIN) headerY+=lines('GSTIN: '+s.GSTIN,200,headerY,101,8,'normal','#3A3A3A','right');
  const offset=Math.max(0,headerY+9-61);
  write('INVOICE',9,61+offset,24,'bold');
  write('Invoice #:',123,62+offset,9,'bold','#6E6E6E');lines(invoice.invoiceNumber,201,62+offset,56,9,'normal','#000000','right');
  write('Invoice Date:',123,69+offset,9,'bold','#6E6E6E');write(dateDisplay(invoice.invoiceDate),201,69+offset,10,'normal','#000000','right');
  write('BILL TO',9,89+offset,10,'bold',GOLD);write('PAYMENT METHOD',126,89+offset,10,'bold',GOLD);
  const nameHeight=lines(invoice.customerName,9,96+offset,105,11,'bold');
  write(invoice.customerPhone,9,96+offset+nameHeight+1,9,'normal','#3A3A3A');
  const addressHeight=lines(invoice.customerAddress,9,102+offset+nameHeight,105,8.5,'normal','#3A3A3A');
  lines(invoice.paymentMethod,126,96+offset,74,9);write(invoice.orderType ? invoice.orderType+' ORDER' : invoice.paymentStatus,126,104+offset,9,'bold','#6E6E6E');
  let y=offset+Math.max(LAYOUT.tableTop,108+nameHeight+addressHeight);
  function tableHeader() {
    doc.setFillColor('#000000');doc.rect(8,y,194,10,'F');
    const labels=['#','ITEM DESCRIPTION','SIZE','QTY','UNIT PRICE','AMOUNT'];
    const x=[11,18,85,115,145,183];labels.forEach((v,i)=>write(v,x[i],y+6.5,8.5,'bold','#FFFFFF',i>2?'center':'left'));
    y+=10;
  }
  function continuation() {
    doc.addPage();write(s.BusinessName,9,15,12,'bold');write(invoice.invoiceNumber+' / continued',201,15,9,'normal','#3A3A3A','right');y=25;tableHeader();
  }
  if(y>180) continuation(); else tableHeader();
  const slots=Math.max(6,invoice.items.length);
  for(let i=0;i<slots;i++) {
    const item=invoice.items[i], desc=wrap(item ? [item.description,[item.sku,item.material,item.productType,item.gsm?item.gsm+' GSM':'',item.color].filter(Boolean).join(' / ')].filter(Boolean).join('\n') : '',63,9.5), size=wrap(item?.size || '',22,9);
    const height=Math.max(8.5,desc.length*4.1+3,size.length*4+3);
    if(y+height>265) continuation();
    doc.setFillColor(i%2?'#F4EFE3':'#FFFFFF');doc.rect(8,y,194,height,'F');
    write(i+1,12,y+5.7,9,'normal','#3A3A3A','center');
    if(item) {
      desc.forEach((v,j)=>write(v,18,y+5.7+j*4.1,9.5));size.forEach((v,j)=>write(v,85,y+5.7+j*4,9));
      write(item.qty,116,y+5.7,9,'normal','#3A3A3A','center');
      write(Number(item.unitPrice).toFixed(2),161,y+5.7,9,'normal','#3A3A3A','right');write(Number(item.amount).toFixed(2),198,y+5.7,9,'bold','#000000','right');
    }
    y+=height;
  }
  if(y+111>290) {doc.addPage();write(s.BusinessName+' / '+invoice.invoiceNumber,9,16,12,'bold');y=23;}
  let totalsY=doc.getNumberOfPages()===1?Math.max(192,y+10):y+10;
  write('Subtotal',153,totalsY,10,'normal','#3A3A3A','right');write(invoice.subtotal.toFixed(2),198,totalsY,10,'normal','#000000','right');
  write('Discount',153,totalsY+8,10,'normal','#3A3A3A','right');write(invoice.discount.toFixed(2),198,totalsY+8,10,'normal','#000000','right');
  write('Delivery charges',153,totalsY+16,10,'normal','#3A3A3A','right');write(Number(invoice.deliveryCharges || 0).toFixed(2),198,totalsY+16,10,'normal','#000000','right');
  write(invoice.taxLabel,153,totalsY+24,9,'normal','#3A3A3A','right');if(invoice.taxAmount)write(invoice.taxAmount.toFixed(2),198,totalsY+24,10,'normal','#000000','right');
  doc.setFillColor('#000000');doc.rect(101,totalsY+28,101,11,'F');write('TOTAL DUE',154,totalsY+35.3,12,'bold','#FFFFFF','right');write('₹'+invoice.grandTotal.toFixed(2),198,totalsY+35.3,12,'bold','#FFFFFF','right');
  const footerY=totalsY+55;
  lines(s.ThankYouNote,9,footerY,114,9.5,'bold',GOLD);
  if(!invoice.orderType && invoice.paymentStatus==='PAID') {const stamp=ASSETS.paidStamp;doc.addImage(stamp.data,'JPEG',17,footerY+5,48,48*stamp.height/stamp.width,'paid');}
  const sig=ASSETS.signature;doc.addImage(sig.data,'JPEG',143,footerY+3,28,28*sig.height/sig.width,'signature');
  doc.setDrawColor('#3A3A3A');doc.line(126,footerY+26,193,footerY+26);
  write(s.SignatureCaption,126,footerY+31,8,'italic','#6E6E6E');write(s.BottomBrandText,105,Math.min(289,footerY+45),9,'bold',GOLD,'center');
  const totalPages=doc.getNumberOfPages();
  if(totalPages>1) for(let p=1;p<=totalPages;p++){doc.setPage(p);write(`${p} / ${totalPages}`,201,294,7,'normal','#6E6E6E','right');}
  const blob=doc.output('blob'), pdfBase64=doc.output('datauristring').split(',')[1];
  return {blob,pdfBase64,fileName:invoice.invoiceNumber+'.pdf',elapsedMs:performance.now()-started,pages:totalPages};
}
