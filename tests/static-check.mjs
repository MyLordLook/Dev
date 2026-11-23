import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import assert from 'node:assert/strict';
// Node ships Acorn for its own tooling. Use it here without downloading a test dependency.
const source=process.binding('natives')['internal/deps/acorn/acorn/dist/acorn'];
if(!source)throw new Error('This checker requires a Node build with bundled Acorn; use Node 24.');
const context={exports:{},module:{}};vm.runInNewContext(source,context);const acorn=context.exports;
const builtins=new Set('window document navigator localStorage console fetch URL URLSearchParams Blob File AbortSignal CustomEvent Event EventTarget Error DOMException Uint8Array Number String Boolean Object Array Map Set Promise JSON Date Math RegExp Intl performance crypto structuredClone atob btoa setTimeout clearTimeout setInterval clearInterval self caches confirm undefined Infinity NaN encodeURIComponent decodeURIComponent'.split(' '));
let files=0,refs=0;
for(const file of fs.readdirSync('.').filter(f=>f.endsWith('.js'))){
 const text=fs.readFileSync(file,'utf8'),ast=acorn.parse(text,{ecmaVersion:'latest',sourceType:'module',locations:true});
 const root={parent:null,names:new Set(builtins)},scopeMap=new WeakMap(),references=[];
 const scope=parent=>({parent,names:new Set()});
 function declare(pattern,s){if(!pattern)return;if(pattern.type==='Identifier')s.names.add(pattern.name);else if(pattern.type==='RestElement')declare(pattern.argument,s);else if(pattern.type==='AssignmentPattern')declare(pattern.left,s);else if(pattern.type==='ObjectPattern')pattern.properties.forEach(p=>declare(p.type==='RestElement'?p.argument:p.value,s));else if(pattern.type==='ArrayPattern')pattern.elements.forEach(p=>declare(p,s));}
 function walk(node,s,parent=null,key=''){
  if(!node || typeof node!=='object')return;
  if(Array.isArray(node)){node.forEach(n=>walk(n,s,parent,key));return;}
  if(!node.type)return;
  let own=s;
  if(node.type==='FunctionDeclaration')declare(node.id,s);
  if(node.type==='ClassDeclaration')declare(node.id,s);
  if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type)){
    own=scope(s);declare(node.id,own);node.params.forEach(p=>declare(p,own));
  }else if(['BlockStatement','CatchClause','ForStatement','ForOfStatement','ForInStatement'].includes(node.type)){own=scope(s);if(node.param)declare(node.param,own);}
  scopeMap.set(node,own);
  if(node.type==='VariableDeclaration')node.declarations.forEach(d=>declare(d.id,own));
  if(node.type==='ImportDeclaration'){
    node.specifiers.forEach(p=>declare(p.local,own));
    if(node.source.value.startsWith('.'))assert(fs.existsSync(path.resolve(path.dirname(file),node.source.value)),file+': missing import '+node.source.value);
    return;
  }
  if(node.type==='Identifier'){
    const nonRef=(parent?.type==='MemberExpression' && key==='property' && !parent.computed) || ((parent?.type==='Property' || parent?.type==='MethodDefinition') && key==='key' && !parent.computed) || (['FunctionDeclaration','FunctionExpression','ClassDeclaration','ClassExpression'].includes(parent?.type) && key==='id') || (parent?.type==='VariableDeclarator' && key==='id') || (key==='params') || (parent?.type==='CatchClause' && key==='param') || ['ImportSpecifier','ImportDefaultSpecifier','ImportNamespaceSpecifier','ExportSpecifier'].includes(parent?.type);
    if(!nonRef)references.push({name:node.name,scope:own,line:node.loc.start.line});
  }
  for(const [k,v] of Object.entries(node)){if(['loc','start','end','type'].includes(k))continue;walk(v,own,node,k);}
 }
 walk(ast,root);
 const missing=references.filter(r=>{let s=r.scope;while(s){if(s.names.has(r.name))return false;s=s.parent;}return true;});
 assert.deepEqual(missing.map(m=>`${m.name}:${m.line}`),[],file+': unresolved identifiers');
 files++;refs+=references.length;
}
console.log(`PASS Acorn AST parsing, relative import existence, lexical reference checks: ${files} modules, ${refs} references`);
console.log('NOTE This checker covers the delivered syntax; it is not a substitute for a general-purpose linter or live browser tests.');


