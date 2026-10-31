const preservation = {"photoInnerHash": "cca1848d04f2131f6bacda927d189b06c83b1823521d251bf894b7a68cfe493c", "photoJSHash": "deeae50d3afb80d7e0a187b5ecc82f2dfe9683194bc47c1262ea4b07853e3819", "photoCSSHash": "409648150f0bf6c585035105fbd433a8499720f59451fc6d6520ab53e61f49c4"};
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const project=path.resolve(__dirname,'../public');
const html=fs.readFileSync(path.resolve(__dirname,'../../../docs/jig/index.html'),'utf8');
const app=fs.readFileSync(path.join(project,'landing/app.js'),'utf8');
const source=fs.readFileSync(path.join(project,'landing/examples-carousel.js'),'utf8');
const css=fs.readFileSync(path.join(project,'landing/examples-carousel.css'),'utf8');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const nodes=[],stack=[];
const voids=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
for(const token of html.matchAll(/<!--[\s\S]*?-->|<\/?([a-zA-Z][\w:-]*)([^<>]*?)\/?>/g)){
 if(!token[1])continue;const tag=token[1].toLowerCase();
 if(token[0].startsWith('</')){for(let i=stack.length-1;i>=0;i--)if(nodes[stack[i]].tag===tag){const node=nodes[stack[i]];node.closeStart=token.index;node.closeEnd=token.index+token[0].length;stack.length=i;break;}continue;}
 const attrs={};for(const attr of token[2].matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g))attrs[attr[1]]=attr[2]??attr[3]??attr[4]??'';
 const index=nodes.length;nodes.push({tag,attrs,ancestors:[...stack],openStart:token.index,openEnd:token.index+token[0].length});if(!voids.has(tag)&&!token[0].endsWith('/>'))stack.push(index);
}
const byId=id=>nodes.find(node=>node.attrs.id===id);
const hasClass=(node,name)=>node.attrs.class?.split(/\s+/).includes(name);
const within=(node,parent)=>node.ancestors.includes(nodes.indexOf(parent));
const text=node=>html.slice(node.openEnd,node.closeStart??node.openEnd).replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').trim();
const carouselNode=byId('examples-carousel');assert(carouselNode,'Real HTML contains the examples carousel');
assert.equal(carouselNode.attrs['aria-roledescription'],'carousel');assert(carouselNode.attrs['aria-label']);
const listNode=nodes.find(node=>hasClass(node,'examples-tabs')&&within(node,carouselNode));
assert.equal(listNode.attrs.role,'tablist');assert.equal(listNode.attrs['aria-orientation'],'horizontal');
const tabNodes=nodes.filter(node=>node.attrs.role==='tab'&&within(node,listNode));assert.equal(tabNodes.length,3);
assert.deepEqual(tabNodes.map(text),['Photos','Support','Kitchen rota'],'Examples progress from photos to support, then kitchen');
const panelNodes=tabNodes.map(tab=>byId(tab.attrs['aria-controls']));
assert.equal(tabNodes.filter(tab=>tab.attrs['aria-selected']==='true').length,1);
assert.equal(panelNodes.filter(panel=>!Object.hasOwn(panel.attrs,'hidden')).length,1);
assert.equal(tabNodes[0].attrs['aria-selected'],'true');
for(const [i,tab] of tabNodes.entries()){assert.equal(tab.tag,'button');assert.equal(tab.attrs.type,'button');assert.equal(panelNodes[i].attrs.role,'tabpanel');assert.equal(panelNodes[i].attrs['aria-labelledby'],tab.attrs.id);}
const photoNode=byId('photo-demo');assert(within(photoNode,panelNodes[0]));assert(!photoNode.attrs.class.split(/\s+/).includes('section-width'),'Nested photo section does not shrink twice');
assert.equal(sha(html.slice(photoNode.openEnd,photoNode.closeStart).replaceAll('/landing/assets/', 'assets/')),preservation.photoInnerHash,'Approved three-phase photo DOM is preserved');
assert.equal(sha(fs.readFileSync(path.join(project,'landing/photo-demo.js'))),preservation.photoJSHash,'Photo controller is unchanged');
assert.equal(sha(fs.readFileSync(path.join(project,'landing/photo-demo.css'))),preservation.photoCSSHash,'Photo styling is unchanged');
assert(/\.examples-panel\[hidden\]\{display:none!important\}/.test(css),'Inactive panels use real display:none, allowing photo visibility to pause naturally');
assert(!/setTimeout|setInterval|requestAnimationFrame|IntersectionObserver|scrollIntoView|\.focus\(/.test(source),'Carousel itself never auto-rotates, scrolls, or steals focus');
const scripts=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match=>match[1].replace(/^\/landing\//,''));assert(scripts.indexOf('app.js')<scripts.indexOf('examples-carousel.js'));
const previousNode=nodes.find(node=>hasClass(node,'previous-example-button')&&within(node,carouselNode));
const nextNode=nodes.find(node=>hasClass(node,'next-example-button')&&within(node,carouselNode));
assert(previousNode&&nextNode);assert.equal(previousNode.attrs.type,'button');assert.equal(nextNode.attrs.type,'button');
assert(!nodes.some(node=>within(node,carouselNode)&&(hasClass(node,'next-example')||hasClass(node,'previous-example'))),'Navigation avoids existing page CTA classes');
const announcementNode=nodes.find(node=>hasClass(node,'examples-announcement')&&within(node,carouselNode));assert.equal(announcementNode.attrs['aria-live'],'polite');
assert(!Object.hasOwn(carouselNode.attrs,'aria-live'),'Photo motion is not inside a live region');

let focused=null,clicks=0;
class Element{
 constructor(attrs={},content=''){this.attributes={...attrs};this.textContent=content;this.hidden=Object.hasOwn(attrs,'hidden');this.tabIndex=Number(attrs.tabindex??0);this.listeners=new Map();this.classList={contains:name=>attrs.class?.split(/\s+/).includes(name)??false};}
 getAttribute(key){return this.attributes[key]??null;}
 setAttribute(key,value){this.attributes[key]=String(value);}
 addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);}
 dispatch(type,options={}){const event={...options,prevented:false,preventDefault(){this.prevented=true;}};for(const fn of this.listeners.get(type)??[])fn(event);return event;}
 click(){clicks++;return this.dispatch('click');}
 focus(){focused=this;}
}
const tabs=tabNodes.map(node=>new Element(node.attrs,text(node))),panels=panelNodes.map(node=>new Element(node.attrs));
const previous=new Element(previousNode.attrs),next=new Element(nextNode.attrs),count=new Element(),announcement=new Element();
const tablist=new Element(listNode.attrs);tablist.querySelectorAll=selector=>{assert.equal(selector,'[role="tab"]');return tabs;};
const carousel=new Element(carouselNode.attrs);carousel.querySelectorAll=selector=>{assert.equal(selector,'.examples-tabs [role="tab"]');return tabs;};
carousel.querySelector=selector=>({'.previous-example-button':previous,'.next-example-button':next,'.example-count':count,'.examples-announcement':announcement})[selector]??null;
const ids=new Map([['examples-carousel',carousel],['copy-start',new Element()],['copy-status',new Element()]]);tabs.forEach((tab,i)=>{ids.set(tabNodes[i].attrs.id,tab);ids.set(panelNodes[i].attrs.id,panels[i]);});
const document={querySelectorAll:selector=>{assert.equal(selector,'[role="tablist"]');return [tablist];},getElementById:id=>ids.get(id)??null};
const context=vm.createContext({document,setTimeout(){throw Error('Carousel must not schedule automatic navigation');}});
vm.runInContext(app,context,{filename:'app.js'});vm.runInContext(source,context,{filename:'examples-carousel.js'});
function selected(index){assert.equal(panels.filter(panel=>!panel.hidden).length,1);tabs.forEach((tab,i)=>{assert.equal(tab.getAttribute('aria-selected'),String(i===index));assert.equal(tab.tabIndex,i===index?0:-1);assert.equal(panels[i].hidden,i!==index);});assert.equal(count.textContent,`${String(index+1).padStart(2,'0')} / 03`);}
selected(0);assert.equal(clicks,0,'Initialization does not simulate a click');assert.equal(focused,null);assert.equal(announcement.textContent,'','Initialization is quiet');
next.focus();next.click();selected(1);assert.equal(focused,next);assert.equal(announcement.textContent,'Support, 2 of 3');next.click();selected(2);next.click();selected(0);assert.equal(focused,next,'Repeated next clicks retain button focus');
previous.focus();previous.click();selected(2);assert.equal(focused,previous);assert.equal(previous.getAttribute('aria-label'),'Previous example: Support');assert.equal(next.getAttribute('aria-label'),'Next example: Photos');
const priorFocus=focused;tabs[0].click();selected(0);assert.equal(focused,priorFocus,'Mouse tab handler does not programmatically move focus');
function key(from,name,to){const event=tabs[from].dispatch('keydown',{key:name});assert(event.prevented);selected(to);assert.equal(focused,tabs[to]);}
key(0,'ArrowRight',1);key(1,'ArrowRight',2);key(2,'ArrowRight',0);key(0,'ArrowLeft',2);key(2,'Home',0);key(0,'End',2);
const ignored=tabs[2].dispatch('keydown',{key:'ArrowUp'});assert.equal(ignored.prevented,false);selected(2);
next.focus();for(let i=0;i<12;i++){next.click();selected(i%3);assert.equal(focused,next);}previous.focus();for(let i=0;i<12;i++){previous.click();selected((1-i%3+3)%3);assert.equal(focused,previous);}
assert.equal(sha(fs.readFileSync(path.join(project,'landing/photo-demo.js'))),preservation.photoJSHash);
console.log('PASS: actual HTML carousel, exclusive visible panels, wraparound arrows, native keyboard tabs, focus retention, quiet/manual announcements, and approved three-phase photo DOM/controller/styles.');
