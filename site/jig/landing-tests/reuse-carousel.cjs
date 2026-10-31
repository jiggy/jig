const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const project=path.resolve(__dirname,'../public');
const html=fs.readFileSync(process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname,'../../../docs/jig/index.html'),'utf8');
const app=fs.readFileSync(path.join(project,'landing/app.js'),'utf8');
const source=fs.readFileSync(path.join(project,'landing/reuse-carousel.js'),'utf8');
const css=fs.readFileSync(path.join(project,'landing/reuse-carousel.css'),'utf8');
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
const carouselNode=byId('reuse-carousel');assert(carouselNode,'Real HTML contains the examples carousel');
assert.equal(carouselNode.attrs['aria-roledescription'],'carousel');assert(carouselNode.attrs['aria-label']);
const listNode=nodes.find(node=>hasClass(node,'fr-carousel-tabs')&&within(node,carouselNode));
assert.equal(listNode.attrs.role,'tablist');assert.equal(listNode.attrs['aria-orientation'],'horizontal');
const tabNodes=nodes.filter(node=>node.attrs.role==='tab'&&within(node,listNode));assert.equal(tabNodes.length,3);
const panelNodes=tabNodes.map(tab=>byId(tab.attrs['aria-controls']));
assert.equal(tabNodes.filter(tab=>tab.attrs['aria-selected']==='true').length,1);
assert.equal(panelNodes.filter(panel=>!Object.hasOwn(panel.attrs,'hidden')).length,1);
assert.equal(tabNodes[0].attrs['aria-selected'],'true');
for(const [i,tab] of tabNodes.entries()){assert.equal(tab.tag,'button');assert.equal(tab.attrs.type,'button');assert.equal(panelNodes[i].attrs.role,'tabpanel');assert.equal(panelNodes[i].attrs['aria-labelledby'],tab.attrs.id);}
assert(text(panelNodes[0]).includes('Bizcocho'), 'Translation example is the first slide');
assert(text(panelNodes[0]).includes('Where does the last train leave from?'), 'Existing travel source remains');
assert(text(panelNodes[1]).includes('Family calendar') && text(panelNodes[1]).includes('Project tracker'), 'Dates are reused in two different products');
assert(text(panelNodes[2]).includes('Reading companion') && text(panelNodes[2]).includes('Team handover'), 'Summaries are reused in two different products');
assert(/\.fr-carousel-panel\[hidden\]\{display:none!important\}/.test(css),'Inactive panels use real display:none, allowing photo visibility to pause naturally');
assert(!/setTimeout|setInterval|requestAnimationFrame|IntersectionObserver|scrollIntoView|\.focus\(/.test(source),'Carousel itself never auto-rotates, scrolls, or steals focus');
const scripts=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match=>match[1].replace(/^\/landing\//,''));if (!process.argv[2]) assert(scripts.indexOf('app.js')<scripts.indexOf('reuse-carousel.js'));
const previousNode=nodes.find(node=>hasClass(node,'previous-reuse')&&within(node,carouselNode));
const nextNode=nodes.find(node=>hasClass(node,'next-reuse')&&within(node,carouselNode));
assert(previousNode&&nextNode);assert.equal(previousNode.attrs.type,'button');assert.equal(nextNode.attrs.type,'button');

const announcementNode=nodes.find(node=>hasClass(node,'fr-carousel-announcement')&&within(node,carouselNode));assert.equal(announcementNode.attrs['aria-live'],'polite');
assert(!Object.hasOwn(carouselNode.attrs,'aria-live'),'The whole slide is not a live region');

let focused=null,clicks=0;
class Element{
 constructor(attrs={},content=''){this.attributes={...attrs};this.dataset=Object.fromEntries(Object.entries(attrs).filter(([key])=>key.startsWith('data-')).map(([key,value])=>[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),value]));this.textContent=content;this.hidden=Object.hasOwn(attrs,'hidden');this.tabIndex=Number(attrs.tabindex??0);this.listeners=new Map();this.classList={contains:name=>attrs.class?.split(/\s+/).includes(name)??false};}
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
const stageNodes=nodes.filter(node=>Object.hasOwn(node.attrs,'data-fr-context')&&within(node,carouselNode));
assert.equal(stageNodes.length,3);
const appFixtures=stageNodes.map(node=>{
 const stage=new Element(node.attrs), controls=new Element(nodes.find(n=>Object.hasOwn(n.attrs,'data-fr-context-controls')&&within(n,node)).attrs);
 const choiceNodes=nodes.filter(n=>Object.hasOwn(n.attrs,'data-fr-app-choice')&&within(n,node));
 const choices=choiceNodes.map(n=>new Element(n.attrs,text(n)));
 assert.equal(choices.length,2);assert(controls.hidden,'App controls are revealed only after initialization');
 const methodNode=nodes.find(n=>hasClass(n,'fr-method')&&within(n,node));
 const method=Object.freeze({source:html.slice(methodNode.openStart,methodNode.closeEnd)});
 Object.defineProperty(stage,'innerHTML',{set(){throw Error('Changing apps must not replace the method or app DOM');}});
 stage.querySelectorAll=selector=>{assert.equal(selector,'[data-fr-app-choice]');return choices;};
 stage.querySelector=selector=>{assert.equal(selector,'[data-fr-context-controls]');return controls;};
 return {stage,controls,choices,method};
});
const carousel=new Element(carouselNode.attrs);carousel.querySelectorAll=selector=>{
 if(selector==='.fr-carousel-tabs [role="tab"]')return tabs;
 if(selector==='.fr-stage[data-fr-context]')return appFixtures.map(f=>f.stage);
 throw Error('Unexpected selector '+selector);
};
carousel.querySelector=selector=>({'.previous-reuse':previous,'.next-reuse':next,'.fr-carousel-count':count,'.fr-carousel-announcement':announcement})[selector]??null;
const ids=new Map([['reuse-carousel',carousel],['copy-start',new Element()],['copy-status',new Element()]]);tabs.forEach((tab,i)=>{ids.set(tabNodes[i].attrs.id,tab);ids.set(panelNodes[i].attrs.id,panels[i]);});
const document={querySelectorAll:selector=>{assert.equal(selector,'[role="tablist"]');return [tablist];},getElementById:id=>ids.get(id)??null};
const context=vm.createContext({document,setTimeout(){throw Error('Carousel must not schedule automatic navigation');}});
vm.runInContext(app,context,{filename:'app.js'});vm.runInContext(source,context,{filename:'reuse-carousel.js'});
function selected(index){assert.equal(panels.filter(panel=>!panel.hidden).length,1);tabs.forEach((tab,i)=>{assert.equal(tab.getAttribute('aria-selected'),String(i===index));assert.equal(tab.tabIndex,i===index?0:-1);assert.equal(panels[i].hidden,i!==index);});assert.equal(count.textContent,`${String(index+1).padStart(2,'0')} / 03`);}
selected(0);assert.equal(clicks,0,'Initialization does not simulate a click');assert.equal(focused,null);assert.equal(announcement.textContent,'','Initialization is quiet');
next.focus();next.click();selected(1);assert.equal(focused,next);assert.equal(announcement.textContent,'Find dates, 2 of 3');next.click();selected(2);next.click();selected(0);assert.equal(focused,next,'Repeated next clicks retain button focus');
previous.focus();previous.click();selected(2);assert.equal(focused,previous);assert.equal(previous.getAttribute('aria-label'),'Previous Flow example: Find dates');assert.equal(next.getAttribute('aria-label'),'Next Flow example: Translate');
const priorFocus=focused;tabs[0].click();selected(0);assert.equal(focused,priorFocus,'Mouse tab handler does not programmatically move focus');
function key(from,name,to){const event=tabs[from].dispatch('keydown',{key:name});assert(event.prevented);selected(to);assert.equal(focused,tabs[to]);}
key(0,'ArrowRight',1);key(1,'ArrowRight',2);key(2,'ArrowRight',0);key(0,'ArrowLeft',2);key(2,'Home',0);key(0,'End',2);
const ignored=tabs[2].dispatch('keydown',{key:'ArrowUp'});assert.equal(ignored.prevented,false);selected(2);
next.focus();for(let i=0;i<12;i++){next.click();selected(i%3);assert.equal(focused,next);}previous.focus();for(let i=0;i<12;i++){previous.click();selected((1-i%3+3)%3);assert.equal(focused,previous);}
// App contexts change independently from the method carousel and preserve their selection.
for (const fixture of appFixtures) {
 assert.equal(fixture.controls.hidden,false);assert.equal(fixture.stage.dataset.frReady,'true');
 const method=fixture.method, original=method.source;
 for(let i=0;i<8;i++){
  const index=i%2;fixture.choices[index].focus();fixture.choices[index].click();
  assert.equal(fixture.stage.dataset.frContext,String(index));
  assert.equal(fixture.choices.filter(c=>c.getAttribute('aria-pressed')==='true').length,1);
  assert.equal(focused,fixture.choices[index],'App switching retains native focus');
  assert.equal(fixture.method,method);assert.equal(method.source,original,'The central method content remains unchanged');
 }
}
const retained=appFixtures.map(f=>f.stage.dataset.frContext);
next.click();previous.click();assert.deepEqual(appFixtures.map(f=>f.stage.dataset.frContext),retained,'Method navigation keeps each app connection');
assert(css.includes('.fr-carousel-panel[hidden]{display:none!important}'));
const flowCSS=fs.readFileSync(path.join(project,'landing/flow-reuse.css'),'utf8');
assert(flowCSS.includes('.fr-stage[data-fr-ready=true][data-fr-context="0"] [data-fr-app-panel="1"]{display:none}') || flowCSS.includes('[data-fr-app-panel="1"],.fr-stage[data-fr-ready=true][data-fr-context="1"] [data-fr-app-panel="0"]{display:none}'),'Mobile presents the selected app without a long scroll');
assert(html.includes('fr-fit-figure') && html.includes('shared contract'), 'The compact matching-edge illustration retains the optional contract mechanism');
console.log('PASS: actual reuse carousel and app choices, stable method DOM/content, independent retained app connections, native focus and keyboard tabs, exclusive slides, quiet initialization and optional contract mechanism.');
