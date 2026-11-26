import * as THREE from 'three';
import { buildCottonMorphTargets, computeExpressionWeights, EXPRESSION_NAMES } from '../expressions.js';
const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*t*(10+t*(-15+6*t));};
export class B1857Character{
 constructor({asset}={}){
  const data=asset;
  this.group=new THREE.Group();this.group.name='B1857_Seated_Study';this.named={};this.bones=[];this.rest={};this.time=0;this.mode='idle';this.started=0;this.look={yaw:0,pitch:0,roll:0};this.velocity={yaw:0,pitch:0,roll:0};this.nextLook=3.1;this.idleTarget={yaw:.06,pitch:0,roll:0};this.rng=7381;
  for(const item of data.bones){const b=new THREE.Bone();b.name=item.name;this.rest[item.name]=new THREE.Vector3(...item.head);this.named[item.name]=b;this.bones.push(b);if(item.parent){this.named[item.parent].add(b);b.position.copy(this.rest[item.name]).sub(this.rest[item.parent]);}else{this.group.add(b);b.position.copy(this.rest[item.name]);}}
  this.group.updateMatrixWorld(true);this.skeleton=new THREE.Skeleton(this.bones);
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(data.positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(data.normals,3));g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(data.skinIndices,4));g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(data.skinWeights,4));g.setIndex(data.indices);
  const colors=[],zones=[];
  const shadeColor=new THREE.Color(0xd5c2ae),earTipColor=new THREE.Color(0xe5cfb9),innerEarColor=new THREE.Color(0xdba492),cheekColor=new THREE.Color(0xf0b8ac),mouthColor=new THREE.Color(0x9a7870);
  for(let i=0;i<data.positions.length;i+=3){const x=data.positions[i],y=data.positions[i+1],z=data.positions[i+2];const ny=data.normals[i+1]||0,nz=data.normals[i+2]||0;let c=new THREE.Color(0xfaf4ea),zone=0;
   const under=Math.max(0,Math.min(1,-ny*.52+Math.max(0,.22-y)*1.25));
   const neckCrease=y>.20&&y<.33&&z>.06?Math.max(0,Math.min(1,(.25-ny)*.55)):0;
   const pawBase=y<.095?Math.max(0,Math.min(1,(.095-y)/.095))*.28:0;
   const furShade=Math.min(.42,under*.26+neckCrease*.22+pawBase+(nz<-.25?(-nz-.25)*.14:0));
   if(furShade>.01)c.lerp(shadeColor,furShade);
   if(Math.abs(x)>.055&&y>.41){c.lerp(earTipColor,Math.min(.28,(y-.41)*2.4));}
   const cheek=((Math.abs(x)-.062)/.028)**2+((y-.354)/.019)**2;
   if(z>.175&&cheek<1){c.lerp(cheekColor,(1-cheek)*.24);}
   const mouth=(x/.019)**2+((y-.343)/.0065)**2;
   if(z>.232&&mouth<1){c.lerp(mouthColor,(1-mouth)*.42);}
   const eye=((Math.abs(x)-.039)/.0112)**2+((y-.383)/.0112)**2;
   if(z>.195&&eye<1){c.setHex(eye<.25?0x0c0907:eye<.78?0x332014:0x211813);zone=1;}
   const nose=(x/.0132)**2+((y-.3605)/.007)**2;if(z>.252&&nose<1.1){c.setHex(0x66443d);zone=2;}
   const ear=((Math.abs(x)-.083)/.017)**2+((y-.466)/.02)**2;if(z>.11&&ear<.72){c.lerp(innerEarColor,(1-ear/.72)*.52);}
   colors.push(c.r,c.g,c.b);zones.push(zone);
  }
  g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.clearGroups();const buckets=[[],[],[]];
  for(let i=0;i<data.indices.length;i+=3){const z=zones[data.indices[i]]===zones[data.indices[i+1]]&&zones[data.indices[i]]===zones[data.indices[i+2]]?zones[data.indices[i]]:0;buckets[z].push(data.indices[i],data.indices[i+1],data.indices[i+2]);}
  let start=0;for(let i=0;i<3;i++){g.addGroup(start,buckets[i].length,i);start+=buckets[i].length;}g.setIndex(buckets.flat());
  this.material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.88,metalness:0});this.materials=[this.material,new THREE.MeshPhysicalMaterial({vertexColors:true,roughness:.12,clearcoat:1,clearcoatRoughness:.08}),new THREE.MeshStandardMaterial({vertexColors:true,roughness:.34})];
  this.mesh=new THREE.SkinnedMesh(g,this.materials);this.mesh.name='Purchased_Pomeranian_Sculpt';this.mesh.castShadow=true;this.mesh.receiveShadow=true;this.group.add(this.mesh);this.mesh.bind(this.skeleton);this.mesh.normalizeSkinWeights();
  g.morphAttributes.position=buildCottonMorphTargets(data.positions);this.mesh.updateMorphTargets();
  this.tongue=new THREE.Mesh(new THREE.SphereGeometry(1,16,10),new THREE.MeshStandardMaterial({color:0xcc7e85,roughness:.65}));this.tongue.name='Pet_tongue';this.named.head.add(this.tongue);this.tongue.visible=false;
  this.channels={liftL:0,liftR:0,close:0,lick:0,excite:.25};this.interaction=null;this.nextBlink=2.4;this.blinkAt=-Infinity;this.blinkDuration=.22;this.blink=0;
  this.gaze={yaw:0,pitch:0,active:false};this.bigHead=false;this.headScaleCurrent=1;this.manualExpression='auto';this.expressionWeights={Blink:0,Happy:0,Surprised:0,Sleepy:0,Excited:0};
  this.helper=new THREE.SkeletonHelper(this.group);this.helper.material.depthTest=false;this.helper.renderOrder=5;this.helper.visible=false;this.accumulator=0;this.updatePose();
 }
 random(){this.rng=(Math.imul(this.rng,1664525)+1013904223)>>>0;return this.rng/4294967296;}
 command(mode){this.mode=mode;this.started=this.time;}
 setInteraction(frame){this.interaction=frame;}
 setGaze(nx,ny,active=true){this.gaze={yaw:THREE.MathUtils.clamp(Number(nx)||0,-1,1)*.32,pitch:THREE.MathUtils.clamp(Number(ny)||0,-1,1)*.16,active:Boolean(active)};}
 setBigHead(enabled){this.bigHead=Boolean(enabled);}
 setExpression(name){this.manualExpression=name||'auto';}
 update(dt){if(!Number.isFinite(dt)||dt<0)return;this.accumulator+=Math.min(.1,dt);while(this.accumulator>=1/120){this.tick(1/120);this.accumulator-=1/120;}this.updatePose();}
 tick(dt){
  this.time+=dt;const elapsed=this.time-this.started;
  if(this.time>=this.nextBlink){this.blinkAt=this.time;this.blinkDuration=.18+this.random()*.08;this.nextBlink=this.time+3+this.random()*5;}
  const blinkAge=this.time-this.blinkAt;this.blink=blinkAge<this.blinkDuration?Math.sin(blinkAge/this.blinkDuration*Math.PI)**2:0;
  if(!this.interaction&&this.mode!=='idle'&&elapsed>5.5){this.mode='idle';this.started=this.time;}
  if(this.time>this.nextLook){this.nextLook=this.time+3+this.random()*4;this.idleTarget={yaw:(this.random()-.5)*.17,pitch:(this.random()-.5)*.05,roll:(this.random()-.5)*.045};}
  const target={...this.idleTarget};
  if(this.mode==='left'){target.yaw=-.29;target.roll=-.035;}
  if(this.mode==='right'){target.yaw=.29;target.roll=.035;}
  if(this.mode==='greet'){target.yaw=.035*Math.sin(elapsed*2);target.pitch=-.055;target.roll=.075*smooth(elapsed/.7);}
  if(this.mode==='paw'){target.yaw=.055;target.pitch=.035;target.roll=-.04;}
  const f=this.interaction,age=f?.age??elapsed,env=f?.envelope??1;
  if(f){this.mode=f.id;if(f.look)Object.assign(target,f.look);}
  if(['pet','brush'].includes(this.mode)){target.pitch=.045*env;target.roll=Math.sin(age*2)*.035*env;}
  if(['feed','drink'].includes(this.mode)){target.yaw=0;target.pitch=.035*env;target.roll=0;}
  if(this.mode==='rest'){target.pitch=.13*env;target.roll=.035*env;target.yaw=0;}
  if(this.mode==='wake'){target.pitch=-.05*env;target.roll=0;}
  if(this.mode==='pawRight'){target.yaw=-.055;target.pitch=.035;target.roll=.04;}
  if(this.mode==='dance'){target.yaw=Math.sin(age*4.4)*.24*env;target.pitch=Math.sin(age*8.8)*.07*env;target.roll=Math.cos(age*4.4)*.14*env;}
  if(this.mode==='nod'){target.pitch=(-.06+Math.sin(age*7.2)*.095)*env;target.roll=Math.sin(age*3.6)*.03*env;}
  if(this.gaze?.active&&['idle','rest','pet','greet'].includes(this.mode)){target.yaw=this.gaze.yaw;target.pitch=this.gaze.pitch;}
  const lift=smooth(age/.8)*(1-smooth((age-2.5)/.9));
  const danceLiftL=this.mode==='dance'?Math.max(0,Math.sin(age*4.4))*env:0;
  const danceLiftR=this.mode==='dance'?Math.max(0,-Math.sin(age*4.4))*env:0;
  const desired={liftL:['paw','ball'].includes(this.mode)?lift:danceLiftL,liftR:this.mode==='pawRight'?lift:danceLiftR,close:this.mode==='rest'?env:this.mode==='pet'?.8*env:0,lick:this.mode==='lick'?Math.max(0,Math.sin(age*9))*env:['feed','drink'].includes(this.mode)&&age>2.1&&age<4.5?Math.max(0,Math.sin(age*14))*env:0,excite:['greet','ball','dance','nod'].includes(this.mode)?1:.25};
  for(const k of Object.keys(this.channels))this.channels[k]+=(desired[k]-this.channels[k])*(1-Math.exp(-(k==='lick'?30:9)*dt));
  const targetExpr=computeExpressionWeights({mode:this.mode,age,envelope:env,blink:this.blink??0,close:this.channels?.close??0,manualExpression:this.manualExpression});
  for(const key of EXPRESSION_NAMES)this.expressionWeights[key]+=(targetExpr[key]-this.expressionWeights[key])*(1-Math.exp(-16*dt));
  this.headScaleCurrent+=((this.bigHead?1.42:1)-this.headScaleCurrent)*(1-Math.exp(-8*dt));
  for(const key of ['yaw','pitch','roll']){const omega=key==='yaw'?7:5.5;this.velocity[key]+=(omega*omega*(target[key]-this.look[key])-2*omega*this.velocity[key])*dt;this.look[key]+=this.velocity[key]*dt;}
 }
 updatePose(){
  const t=this.time;for(const b of this.bones){b.quaternion.identity();b.scale.set(1,1,1);if(b.parent.isBone)b.position.copy(this.rest[b.name]).sub(this.rest[b.parent.name]);else b.position.copy(this.rest[b.name]);}
  const breath=Math.sin(t*2*Math.PI/3.4)*.003;
  const danceBob=this.mode==='dance'?Math.abs(Math.sin(t*4.4))*.016:0;
  const danceSway=this.mode==='dance'?Math.sin(t*4.4)*.085:0;
  this.named.chest.scale.set(1+breath,1+breath*.45+danceBob,1+breath*.6);
  this.named.chest.rotation.z=danceSway;
  this.named.neck.rotation.set(this.look.pitch*.22,this.look.yaw*.24,this.look.roll*.2);
  this.named.head.rotation.set(this.look.pitch*.78,this.look.yaw*.76,this.look.roll*.8);
  this.named.head.scale.setScalar(this.headScaleCurrent||1);
  // Short, separate ear reactions rather than permanent symmetric oscillation.
  const ear=Math.max(0,1-Math.abs((t%7.7)-.4)/.22);
  this.named['ear.L'].rotation.z=ear*.055;this.named['ear.R'].rotation.z=-ear*.022;
  const excited=this.channels?.excite??.25;
  for(let i=0;i<4;i++)this.named['tail_'+i].rotation.z=Math.sin(t*(excited>.5?5:2.5)-i*.35)*(.018+i*.009)*excited;
  const lift=this.channels?.liftL??0,liftR=this.channels?.liftR??0;
  // Only a small seated paw lift is supported by this fused sculpt. The larger
  // handshake/standing poses require separating the paw and retopologizing.
  this.named['fore.L.lower'].rotation.x=-lift*.07;
  this.named['fore.R.lower'].rotation.x=-liftR*.07;
  this.group.updateMatrixWorld(true);
  for(const side of ['L','R']){
    const paw=this.named['fore.'+side+'.paw'],position=this.rest[paw.name].clone();position.y+=(side==='L'?lift:liftR)*.012;
    paw.position.copy(paw.parent.worldToLocal(this.group.localToWorld(position)));paw.quaternion.copy(paw.parent.getWorldQuaternion(new THREE.Quaternion()).invert());paw.updateMatrixWorld(true);
  }
  EXPRESSION_NAMES.forEach((name,idx)=>{if(this.mesh.morphTargetInfluences&&idx<this.mesh.morphTargetInfluences.length)this.mesh.morphTargetInfluences[idx]=idx===0?Math.max(this.blink??0,this.channels?.close??0,this.expressionWeights.Blink??0):(this.expressionWeights[name]??0);});
  const lick=this.channels?.lick??0;this.tongue.visible=lick>.03;this.tongue.scale.set(.0055,.0016,.004+.012*lick);this.tongue.position.set(0,-.015+.016*lick,.111+.007*lick);this.tongue.rotation.x=-.6*lick;
  this.group.updateMatrixWorld(true);this.skeleton.update();this.helper.updateMatrixWorld(true);
 }
 diagnostics(){return{time:this.time,mode:this.mode,look:{...this.look},bones:this.bones.length,triangles:this.mesh.geometry.index.count/3,expressions:{...this.expressionWeights},bigHead:this.bigHead};}
}
