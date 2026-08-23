
import { RIGS, BOX } from './beasts';
const NS='http://www.w3.org/2000/svg';
const POSES=[0,1,2,3,4,5,6,7].map(i=>['t '+(i/8).toFixed(3).slice(1),{gait:1,stride:i/8}]);
const host=document.getElementById('host');
for(const [id,rig] of Object.entries(RIGS)){
  const h=document.createElement('h2'); h.textContent=id; host.appendChild(h);
  const row=document.createElement('div'); row.className='row';
  for(const [label,extra] of POSES){
    const mem=rig.memory();
    let f;
    for(let i=0;i<260;i++) f=rig.frame({mem,dt:1/120,now:i*8.3,seed:0.25,head:0,gait:0,stride:0,tail:0,wag:0,...extra});
    const fig=document.createElement('figure');
    const svg=document.createElementNS(NS,'svg');
    svg.setAttribute('viewBox',`0 0 ${BOX.w} ${BOX.h}`);
    const g=document.createElementNS(NS,'g');
    g.setAttribute('stroke-width',1.5); g.setAttribute('stroke-linejoin','round');
    for(const [key,fill,stroke] of rig.layers){
      if(!f[key]) continue;
      const p=document.createElementNS(NS,'path');
      p.setAttribute('d',f[key]); p.setAttribute('fill',fill); p.setAttribute('stroke',stroke);
      g.appendChild(p);
    }
    svg.appendChild(g); fig.appendChild(svg);
    const c=document.createElement('figcaption'); c.textContent=label; fig.appendChild(c);
    row.appendChild(fig);
  }
  host.appendChild(row);
}
