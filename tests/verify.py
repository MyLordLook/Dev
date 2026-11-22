"""Run from the codebase root. Optional original inputs folder enables source parity checks."""
from pathlib import Path
from html.parser import HTMLParser
import subprocess, re, json, sys, zipfile
root=Path(__file__).resolve().parent.parent
results=[]
def record(message):
    results.append('PASS '+message);print(results[-1])
for p in root.glob('*.js'):
    subprocess.run(['node','--check',str(p)],check=True,capture_output=True,text=True)
record('Node/V8 syntax check for every production JavaScript file')
code='\n'.join(p.read_text(encoding='utf-8-sig') for p in root.glob('*.js'))
for pattern in [r'google\.script\.run',r'script\.google\.com',r'HtmlService',r'SpreadsheetApp',r'UrlFetchApp',r'NextInvoiceSequence',r'getLastRow\(']:
    assert not re.search(pattern,code),pattern
record('Zero Apps Script calls, Web App URLs, or shared sequence / last-row numbering references')
class HTML(HTMLParser):
    def __init__(self):super().__init__();self.ids=[];self.paths=[];self.inline=[]
    def handle_starttag(self,tag,attrs):
        d=dict(attrs)
        if 'id' in d:self.ids.append(d['id'])
        self.inline += [k for k in d if k.startswith('on')]
        if tag in ['script','link']:
            p=d.get('src',d.get('href',''))
            if p.startswith('./'):self.paths.append(p)
html=HTML();html.feed((root/'index.html').read_text(encoding='utf-8'))
assert len(html.ids)==len(set(html.ids));assert not html.inline
for p in html.paths:assert(root/p).is_file(),p
app=(root/'app.js').read_text(encoding='utf-8')
refs=set(re.findall(r"\$\('([^']+)'\)",app));assert not refs-set(html.ids),refs-set(html.ids)
record(f'HTML: {len(html.ids)} unique IDs, {len(refs)} controller ID references resolved, no inline handlers, all local resources exist')
subprocess.run(['node','tests/static-check.mjs'],cwd=root,check=True)
if len(sys.argv)>1:
    import openpyxl
    folder=Path(sys.argv[1]).resolve();wb=openpyxl.load_workbook(folder/'LordLook_Invoice_sample.xlsx',data_only=False)
    z=zipfile.ZipFile(folder/'Invoice Generator.zip');gs=z.read('Configuration.gs').decode('utf-8')
    headers=json.loads(subprocess.check_output(['node','--input-type=module','-e',"import {HEADERS} from './schema.js'; console.log(JSON.stringify(HEADERS))"],cwd=root,text=True))
    names={'Products':'productHeaders','Customers':'customerHeaders','Invoices':'invoiceHeaders','InvoiceItems':'itemHeaders'}
    for tab,var in names.items():
        match=re.search(r'var '+var+r'\s*=\s*\[\[?\s*(.*?)\]\s*\]',gs,re.S)
        assert match,var
        original=re.findall(r"'([^']+)'",match.group(1))
        assert original==headers[tab],tab
        assert [c.value for c in wb[tab][1]]==headers[tab],tab
    assert [c.value for c in wb['Settings'][1]]==headers['Settings']
    record('1:1 database header parity: Products 7, Customers 7, Settings 3, Invoices 20, InvoiceItems 11')
    template=openpyxl.load_workbook(folder/'LordLook_Invoice_Template.xlsx',data_only=False)['Invoice']
    expected={'G20':'=IF(OR(E20="",F20=""),"",E20*F20)','G27':'=SUM(G20:G25)','G30':'=G27-G28+G29'}
    for cell,formula in expected.items():assert template[cell].value==formula,(cell,template[cell].value)
    labels=['#','ITEM DESCRIPTION','SIZE','QTY','UNIT PRICE','AMOUNT']
    assert [template.cell(19,c).value for c in range(2,8)]==labels
    assert len(template._images)==3
    record('Template: six exact table headers, three arithmetic formulas, three source images verified')
    assert template['G21'].value is None and template['G22'].value is None and template['G23'].value is None
    record('Known source discrepancy confirmed: template G21:G23 formulas missing; app computes all line amounts')
    assert wb['Invoice']['D26'].value=='Subtotal' and template['E27'].value=='Subtotal'
    record('Known layout discrepancy confirmed: sample subtotal D26/F26 versus template E27/G27')
else: print('SKIP Original workbook/ZIP comparison: supply the inputs folder as argument.')
subprocess.run(['node','tests/core.test.mjs'],cwd=root,check=True)
print('VERIFICATION COMPLETE. Live Google OAuth/API and actual jsPDF rendering are separate acceptance checks.')
