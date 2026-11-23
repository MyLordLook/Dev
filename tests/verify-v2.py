from pathlib import Path
from html.parser import HTMLParser
import subprocess, re
root=Path(__file__).resolve().parents[1]
def run(args):subprocess.run(args,cwd=root,check=True)
for f in root.glob('*.js'):run(['node','--check',str(f)])
print('PASS Node syntax for all production JavaScript',flush=True)
text='\n'.join(f.read_text(encoding='utf-8') for f in root.glob('*.js'))
assert not re.search(r'google\.script\.run|script\.google\.com/macros',text)
print('PASS Zero Apps Script calls or web app endpoints',flush=True)
class Parser(HTMLParser):
    def __init__(self):super().__init__();self.ids=[];self.paths=[]
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if 'id' in attrs:self.ids.append(attrs['id'])
        for key,value in attrs.items():
            assert not key.startswith('on'),key
            if key in ('src','href') and value.startswith('./'):self.paths.append(value)
p=Parser();p.feed((root/'index.html').read_text(encoding='utf-8'))
assert len(p.ids)==len(set(p.ids))
for f in p.paths:assert (root/f).is_file(),f
refs=set(re.findall(r"\$\('([^']+)'\)",(root/'app.js').read_text(encoding='utf-8')))
dynamic={'address-'+k for k in ['country','pin','city','state','line1','line2','landmark']}
assert not refs-set(p.ids)-dynamic,refs-set(p.ids)-dynamic
assert '<body class="locked">' in (root/'index.html').read_text(encoding='utf-8')
print(f'PASS {len(p.ids)} unique static IDs, controller references resolved, login locked by default',flush=True)
run(['node','tests/static-check.mjs']);run(['node','tests/core.test.mjs']);run(['node','tests/v2.test.mjs'])
print('COMPLETE: V2 local verification. Google/GIS/PDF mocked; live acceptance still required.',flush=True)
