export class PdfRecorder {
  static last=null;
  constructor(){this.commands=[];this.page=1;this.pages=1;this.size=10;PdfRecorder.last=this;}
  setProperties(){} setFont(){} setFontSize(v){this.size=v;} setTextColor(){} setFillColor(){} setDrawColor(){}
  text(text,x,y,options){this.commands.push({type:'text',text,x,y,options,page:this.page});}
  rect(x,y,w,h){this.commands.push({type:'rect',x,y,w,h,page:this.page});}
  line(x,y,x2,y2){this.commands.push({type:'line',x,y,x2,y2,page:this.page});}
  addImage(data,type,x,y,w,h){this.commands.push({type:'image',x,y,w,h,page:this.page});}
  addPage(){this.page=++this.pages;}setPage(page){this.page=page;}getNumberOfPages(){return this.pages;}
  splitTextToSize(text,width){const n=Math.max(1,Math.floor(width/(this.size*.2)));return String(text).match(new RegExp('.{1,'+n+'}','g')) || [''];}
  output(kind){const data='%PDF-1.4\n% Test adapter only; not an actual jsPDF render.\n';return kind==='blob'?new Blob([data],{type:'application/pdf'}):'data:application/pdf;base64,'+btoa(data);}
}
