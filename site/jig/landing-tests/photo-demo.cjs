const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const project=path.resolve(__dirname,'../public');
const source=fs.readFileSync(path.join(project,'landing/photo-demo.js'),'utf8');
const css=fs.readFileSync(path.join(project,'landing/photo-demo.css'),'utf8');
const markupPath=process.argv[2]?path.resolve(process.argv[2]):path.resolve(__dirname,'../../../docs/jig/index.html');
const html=fs.readFileSync(markupPath,'utf8');
const sceneMarkup=html.match(/<section\b[^>]*\bid="photo-demo"[\s\S]*?<\/section>/)?.[0];
assert(sceneMarkup,'Actual HTML must contain the photo scene');
// Read this small scene's real attributes and ancestry without a DOM package.
const nodes=[],stack=[];
const voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
for(const token of sceneMarkup.matchAll(/<!--[\s\S]*?-->|<\/?([a-zA-Z][\w:-]*)([^<>]*?)\/?>/g)){
 if(!token[1])continue;
 const tag=token[1].toLowerCase();
 if(token[0].startsWith('</')){
  for(let i=stack.length-1;i>=0;i--)if(nodes[stack[i]].tag===tag){stack.length=i;break;}
  continue;
 }
 const attrs={};
 for(const attr of token[2].matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g))attrs[attr[1]]=attr[2]??attr[3]??attr[4]??'';
 const index=nodes.length;nodes.push({tag,attrs,ancestors:[...stack]});
 if(!voidTags.has(tag)&&!token[0].endsWith('/>'))stack.push(index);
}
const hasClass=(node,name)=>node.attrs.class?.split(/\s+/).includes(name);
const markup={
 photos:nodes.flatMap((node,i)=>hasClass(node,'photo-card')?[{attrs:node.attrs,image:nodes.find(child=>child.tag==='img'&&child.ancestors.includes(i))?.attrs}]:[]),
 labels:nodes.filter(node=>hasClass(node,'photo-album-caption')).map(node=>node.attrs),
 buttons:nodes.filter(node=>Object.hasOwn(node.attrs,'data-photo-view')).map(node=>node.attrs),
 nodes,
};
assert.equal(markup.photos.length,6,'Exactly six persistent photo elements');
assert.equal(new Set(markup.photos.map(p=>p.attrs['data-photo'])).size,6);
assert.equal(new Set(markup.photos.map(p=>p.image.src)).size,6);
assert.equal(markup.labels.length,3);assert.equal(markup.buttons.length,3);
assert.equal(nodes.filter(node=>node.tag==='img').length,6,'The book has no duplicate or replacement images');
assert.equal(nodes.filter(node=>hasClass(node,'photo-yearbook')).length,1,'One CSS paper backdrop supports the third phase');
assert(markup.photos.every(p=>p.image.alt&&fs.existsSync(path.join(project,p.image.src.replace(/^\//,'')))));
assert(markup.nodes.every(n=>!Object.hasOwn(n.attrs,'hidden')),'One scene has no hidden alternate composition');
for(const button of markup.buttons){assert.equal(button.type,'button');assert.notEqual(button.role,'tab');}
assert.equal(markup.buttons.find(b=>b['data-photo-view']==='2')['aria-pressed'],'true','No-JS markup opens on Yearbook');
assert(!/cloneNode|createElement|getBoundingClientRect|destinationTransform|setTimeout|setInterval/.test(source),'No clones, measuring, handoffs or timer chain');
assert(/\.photo-card\{[^}]*aspect-ratio:16\/10/.test(css));assert(/\.photo-card img\{[^}]*object-fit:cover/.test(css));
assert(!/\[data-(?:phase|state|view)[^}]+(?:object-fit|aspect-ratio|border)/.test(css),'Frame and crop do not change with animation state');
assert(/--card-progress:1;--book-progress:1/.test(css),'CSS alone renders the useful completed book');
assert(/\.photo-motion-stage\{[^}]*height:326px/.test(css));
assert(/@media\(max-width:560px\)[^\n]*\.photo-motion-stage\{height:426px/.test(css));
for(const [photo,geometry] of Object.entries({
 'lake-front':'--from-x:18;--from-y:90px;--from-angle:-6deg;--to-x:20.6;--to-y:164px;--to-angle:2deg;',
 'birthday-front':'--from-x:50;--from-y:90px;--from-angle:4deg;--to-x:50.6;--to-y:164px;--to-angle:2deg;',
 'mountain-front':'--from-x:82;--from-y:90px;--from-angle:-4deg;--to-x:80.6;--to-y:164px;--to-angle:2deg;',
 'lake-back':'--from-x:50;--from-y:220px;--from-angle:5deg;--to-x:19.4;--to-y:150px;--to-angle:-7deg;',
 'birthday-back':'--from-x:82;--from-y:220px;--from-angle:-5deg;--to-x:49.4;--to-y:150px;--to-angle:-7deg;',
 'mountain-back':'--from-x:18;--from-y:220px;--from-angle:5deg;--to-x:79.4;--to-y:150px;--to-angle:-7deg;',
})){assert(css.includes('[data-photo=\"'+photo+'\"]{'+geometry),'The first leg keeps '+photo+' geometry');}

function boot(options={}){
 let writeCount=0,focused=null,now=0,nextFrame=0;
 const frames=new Map(),cancelled=[],windowEvents=new Map(),documentEvents=new Map();
 class Element{
  constructor(attrs={}){this.attributes={...attrs};this.dataset=Object.fromEntries(Object.entries(attrs).filter(([k])=>k.startsWith('data-')).map(([k,v])=>[k.slice(5).replace(/-([a-z])/g,(_,s)=>s.toUpperCase()),v]));this.properties=new Map();this.style={setProperty:(k,v)=>{writeCount++;this.properties.set(k,String(v));},getPropertyValue:k=>this.properties.get(k)??''};this.listeners=new Map();this.textContent='';this.isConnected=true;}
  setAttribute(k,v){this.attributes[k]=String(v);}
  getAttribute(k){return this.attributes[k]??null;}
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);}
  dispatch(type,event={}){for(const fn of this.listeners.get(type)??[])fn(event);}
  focus(){focused=this;}
  cloneNode(){throw Error('Persistent photo identities must never be cloned');}
  getBoundingClientRect(){throw Error('CSS owns all scene geometry');}
 }
 const photos=markup.photos.map(p=>{const photo=new Element(p.attrs);photo.image=new Element(p.image);return photo;});
 const labels=markup.labels.map(attrs=>new Element(attrs));const buttons=markup.buttons.map(attrs=>new Element(attrs));
 const [before,after,yearbook]=['0','1','2'].map(view=>buttons.find(b=>b.dataset.photoView===view));
 const stage=new Element(),hint=new Element(),scene=new Element({id:'photo-demo'});
 stage.querySelectorAll=selector=>selector==='.photo-card'?photos:selector==='.photo-album-caption'?labels:[];
 scene.querySelector=selector=>selector==='.photo-motion-stage'?stage:selector==='.photo-motion-hint'?hint:null;
 scene.querySelectorAll=selector=>selector==='[data-photo-view]'?buttons:[];
 let observer;
 class Observer{constructor(callback,settings){this.callback=callback;this.settings=settings;observer=this;}observe(target){this.target=target;}emit(ratio,isIntersecting=true){this.callback([{target:this.target,intersectionRatio:ratio,isIntersecting}]);}}
 const reduced={matches:!!options.reduced,listeners:[],addEventListener(type,fn){assert.equal(type,'change');this.listeners.push(fn);},change(value){this.matches=value;this.listeners.forEach(fn=>fn({matches:value}));}};
 const document={visibilityState:options.hidden?'hidden':'visible',getElementById:id=>id==='photo-demo'?scene:null,addEventListener(type,fn){if(!documentEvents.has(type))documentEvents.set(type,[]);documentEvents.get(type).push(fn);}};
 const window={IntersectionObserver:options.noObserver?undefined:Observer,matchMedia:()=>reduced,requestAnimationFrame:options.noFrames?undefined:fn=>{const id=++nextFrame;frames.set(id,fn);return id;},cancelAnimationFrame:options.noFrames?undefined:id=>{if(frames.has(id))cancelled.push(frames.get(id));frames.delete(id);},addEventListener(type,fn){if(!windowEvents.has(type))windowEvents.set(type,[]);windowEvents.get(type).push(fn);}};
 vm.runInNewContext(source,{document,window},{filename:'photo-demo.js'});
 const identities=photos.slice(),images=photos.map(p=>p.image),sources=photos.map(p=>p.image.getAttribute('src'));
 function step(delta=16){now+=delta;const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(now));assert(frames.size<=1,'Only one frame clock may be scheduled');}
 function advance(ms){let left=ms;while(left>0){if(!frames.size){now+=left;break;}const delta=Math.min(16,left);step(delta);left-=delta;}}
 function emitDocument(type){for(const fn of documentEvents.get(type)??[])fn();}
 function emitWindow(type){for(const fn of windowEvents.get(type)??[])fn();}
 function persistent(){assert.deepEqual(photos,identities);assert.deepEqual(photos.map(p=>p.image),images);assert.deepEqual(photos.map(p=>p.image.getAttribute('src')),sources);assert(photos.every(p=>[...p.properties.keys()].every(k=>['--card-progress','--book-progress'].includes(k))),'Motion only changes position progress; frame/crop/layer stay untouched');}
 return {photos,labels,buttons,before,after,yearbook,stage,hint,scene,observer,reduced,document,frames,cancelled,step,advance,emitDocument,emitWindow,persistent,writes:()=>writeCount,focused:()=>focused,progress:()=>Number(stage.dataset.progress),phase:()=>stage.dataset.phase,positions:()=>photos.map(p=>Number(p.properties.get('--card-progress'))),bookPositions:()=>photos.map(p=>Number(p.properties.get('--book-progress')))};
}
function start(x){x.observer.emit(.8);x.step(0);}
function close(actual,expected,message){assert(Math.abs(actual-expected)<.0001,message??`${actual} should equal ${expected}`);}
function pressed(x,view){for(const [i,button] of x.buttons.entries())assert.equal(button.getAttribute('aria-pressed'),String(i===view));}

// The original first leg keeps its geometry and staged timing, then the very same cards form a book.
let x=boot();assert.equal(x.frames.size,0);close(x.progress(),0);assert(x.positions().every(p=>p===0));assert(x.bookPositions().every(p=>p===0));pressed(x,0);x.observer.emit(.2);assert.equal(x.frames.size,0);start(x);const beforeWrites=x.writes();x.advance(1000);assert.equal(x.writes(),beforeWrites,'A readable hold does not rewrite six photo styles every frame');x.advance(400);assert.equal(x.phase(),'gather');close(x.progress(),0);pressed(x,1);x.advance(550);close(x.progress(),.5);const midpoint=x.positions();assert(midpoint[0]>midpoint[1]&&midpoint[1]>midpoint[2],'Groups gather with restrained coordinated pacing');assert(midpoint[0]>midpoint[3],'Each pair is offset slightly');assert(x.bookPositions().every(p=>p===0));x.persistent();x.advance(550);assert.equal(x.phase(),'albums');close(x.progress(),1);assert(x.positions().every(p=>p===1));assert(x.labels.every(label=>Number(label.properties.get('--label-opacity'))===1));pressed(x,1);const albumWrites=x.writes();x.advance(2100);assert.equal(x.writes(),albumWrites,'Albums stay readable for a complete hold');x.advance(100);assert.equal(x.phase(),'compose');close(x.progress(),1);pressed(x,2);x.advance(600);close(x.progress(),1.5);const bookMidpoint=x.bookPositions();assert(bookMidpoint.some(p=>p>0&&p<1));assert(x.positions().every(p=>p===1),'The first formation stays completed during the second leg');x.persistent();x.advance(600);assert.equal(x.phase(),'yearbook');close(x.progress(),2);assert(x.bookPositions().every(p=>p===1));assert.equal(x.stage.style.getPropertyValue('--book-opacity'),'1.00000');assert.equal(x.stage.style.getPropertyValue('--book-copy-opacity'),'1.00000');const bookWrites=x.writes();x.advance(3900);assert.equal(x.writes(),bookWrites,'Yearbook has the longest reading hold');x.advance(100);assert.equal(x.phase(),'unfold');x.advance(500);close(x.progress(),1.5);assert.deepEqual(x.bookPositions(),bookMidpoint,'The return retraces the same prints');x.advance(500);close(x.progress(),1);assert.equal(x.phase(),'albums-return');x.advance(600);assert.equal(x.phase(),'scatter');x.advance(375);close(x.progress(),.5);assert.deepEqual(x.positions(),midpoint);x.advance(375);close(x.progress(),0);assert.equal(x.phase(),'photos');x.persistent();assert.equal(x.focused(),null,'Automatic motion never moves focus');x.advance(5900);close(x.progress(),2);x.persistent();

// Offscreen, tab-hidden and page lifecycle pauses preserve both legs, with no reset or catch-up jump.
for(const time of [1730,5230]){
 x=boot();start(x);x.advance(time);const partial=x.progress(),positions=x.positions(),bookPositions=x.bookPositions();x.observer.emit(0,false);assert.equal(x.frames.size,0);x.advance(30000);close(x.progress(),partial);assert.deepEqual(x.positions(),positions);assert.deepEqual(x.bookPositions(),bookPositions);x.observer.emit(.2);assert.equal(x.frames.size,0);x.observer.emit(.6);x.step(0);close(x.progress(),partial,'Reentry resumes the same moment');x.advance(100);assert(x.progress()>partial);x.persistent();
 x=boot();start(x);x.advance(time);const hiddenProgress=x.progress();x.document.visibilityState='hidden';x.emitDocument('visibilitychange');assert.equal(x.frames.size,0);x.advance(30000);close(x.progress(),hiddenProgress);x.document.visibilityState='visible';x.emitDocument('visibilitychange');x.step(0);close(x.progress(),hiddenProgress);x.advance(16);assert(x.progress()>hiddenProgress);x.emitWindow('pagehide');const pageProgress=x.progress();x.advance(20000);close(x.progress(),pageProgress);x.emitWindow('pageshow');x.step(0);close(x.progress(),pageProgress);x.persistent();
}

// Keyboard focus owns the scene; all three buttons continue from its exact current position.
x=boot();start(x);x.advance(1730);const focusProgress=x.progress();x.scene.dispatch('focusin');assert.equal(x.frames.size,0);assert.match(x.hint.textContent,/paused/);x.advance(10000);close(x.progress(),focusProgress);x.observer.emit(0,false);x.observer.emit(.9);assert.equal(x.frames.size,0,'Focus ownership prevents autoplay restarting');x.before.dispatch('click');close(x.progress(),focusProgress);pressed(x,0);x.step(0);x.advance(750);close(x.progress(),0);assert.equal(x.frames.size,0);x.yearbook.dispatch('click');pressed(x,2);x.step(0);x.advance(550);close(x.progress(),.5);assert.deepEqual(x.positions(),midpoint);x.advance(550);close(x.progress(),1,'A Photos-to-Yearbook choice passes through Albums');x.advance(600);close(x.progress(),1.5);assert.deepEqual(x.bookPositions(),bookMidpoint);x.before.dispatch('click');close(x.progress(),1.5,'Reversing the second leg never snaps');pressed(x,0);x.step(0);x.advance(500);close(x.progress(),1);x.advance(375);close(x.progress(),.5);assert.deepEqual(x.positions(),midpoint);x.after.dispatch('click');close(x.progress(),.5,'Reversing the first leg never snaps');pressed(x,1);x.step(0);x.advance(550);close(x.progress(),1);assert.equal(x.frames.size,0);x.advance(10000);close(x.progress(),1);assert.equal(x.focused(),null);x.persistent();

// Rapid repeated selections cannot leave competing clocks or revive canceled callbacks.
x=boot();start(x);x.advance(5200);const rapidProgress=x.progress();for(let i=0;i<12;i++){x.buttons[i%3].dispatch('click');close(x.progress(),rapidProgress);assert(x.frames.size<=1);}const stale=x.cancelled.slice();stale.forEach(fn=>fn(900000));close(x.progress(),rapidProgress,'Canceled callbacks cannot advance a new selection');assert(x.frames.size<=1);x.step(0);x.advance(2000);close(x.progress(),2);assert.equal(x.frames.size,0);x.persistent();

x=boot({reduced:true});close(x.progress(),2);pressed(x,2);x.observer.emit(.9);assert.equal(x.frames.size,0);for(const [i,button] of x.buttons.entries()){button.dispatch('click');close(x.progress(),i);assert.equal(x.frames.size,0);}x.persistent();
x=boot();start(x);x.advance(5230);x.reduced.change(true);close(x.progress(),2);assert.equal(x.frames.size,0);x.reduced.change(false);close(x.progress(),0);assert.equal(x.phase(),'photos');x.persistent();
x=boot();start(x);x.yearbook.dispatch('click');x.step(0);x.advance(500);x.after.dispatch('click');x.reduced.change(true);close(x.progress(),1,'Reduced motion honors an explicit phase selection');x.reduced.change(false);assert.equal(x.frames.size,0,'Changing motion preferences does not revoke manual ownership');x.persistent();
for(const options of [{noFrames:true},{noObserver:true}]){x=boot(options);close(x.progress(),2);assert.equal(x.frames.size,0);x.emitWindow('pageshow');x.emitDocument('visibilitychange');assert.equal(x.frames.size,0,'Static fallback must not start a perpetual frame loop');x.before.dispatch('click');if(options.noFrames)close(x.progress(),0);else{x.step(0);x.advance(1750);close(x.progress(),0);}x.persistent();}
x=boot({hidden:true});x.observer.emit(.9);assert.equal(x.frames.size,0);x.document.visibilityState='visible';x.emitDocument('visibilitychange');x.step(0);x.advance(1400);assert.equal(x.phase(),'gather');x.stage.isConnected=false;x.step(16);assert.equal(x.frames.size,0,'A removed stage cannot keep its clock alive');
console.log(`PASS: ${markupPath}; six persistent prints across three phases, exact readable holds, preserved first-leg geometry, reversible manual crossings, one clock, focus/visibility/reduced-motion ownership and a useful static Yearbook.`);
