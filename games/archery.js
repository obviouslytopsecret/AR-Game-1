/* Pocket Sports: Archery. Turn based, up to 4 players. Point the phone to aim, hold to draw, let go to shoot. */
(function(){
"use strict";
const EYE = {x:0, y:1.5, z:0}, TY = 1.3, TR = .61, RING = TR/10, G = 9.8, VFULL = 62, PER_END = 3;
const rnd = (a, b) => a + Math.random()*(b - a);
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / .5;

class Archery {
  constructor(core, opts){
    this.core = core; this.views = 1; this.n = core.playing.length;
    this.ends = +opts.ends || 2; this.D = +opts.dist || 18;
    const scene = this.scene = new THREE.Scene();
    const sun = core.makeRoom(scene, {sky:0x9fd3f0, fogNear:45, fogFar:110, shadow:6, sunX:4, sunZ:2});
    sun.position.set(4, 12, -this.D + 6); sun.target.position.set(0, 0, -this.D); const sc = sun.shadow.camera; sc.far = 40; sc.updateProjectionMatrix();
    this.buildRange();
    this.cam = new THREE.PerspectiveCamera(40, 1, .05, 200); this.baseFov = 40;
    this.camPos = new THREE.Vector3(EYE.x, EYE.y, EYE.z); this.camLook = new THREE.Vector3(0, TY, -this.D);
    this.bow = this.makeBow(); scene.add(this.bow);
    this.arrowGeo = new THREE.CylinderGeometry(.006, .006, .75, 6); this.arrowGeo.rotateX(Math.PI/2);
    this.flying = null; this.stuck = [];
    this.sc = core.playing.map(() => []);
    this.turn = 0; this.end = 0; this.shot = 0; this.phase = "idle"; this.t = 0; this.msg = ""; this.wind = 0; this.drawT = -1; this.swayT = 0;
    this.reticle = new THREE.Mesh(new THREE.RingGeometry(.06, .09, 28), new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:.95, depthTest:false}));
    this.reticle.renderOrder = 10; scene.add(this.reticle);
    this.dot = new THREE.Mesh(new THREE.CircleGeometry(.018, 12), new THREE.MeshBasicMaterial({color:0xffffff, depthTest:false})); this.dot.renderOrder = 10; scene.add(this.dot);
  }
  buildRange(){
    const s = this.scene, M = (c, o={}) => new THREE.MeshStandardMaterial(Object.assign({color:c, roughness:.85}, o)), D = this.D;
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), M(0x5aa64e, {roughness:1})); grass.rotation.x = -Math.PI/2; grass.receiveShadow = true; s.add(grass);
    // mown stripes toward the target
    for (let i = -3; i <= 3; i++){ const st = new THREE.Mesh(new THREE.PlaneGeometry(1.2, D + 10), M(i % 2 ? 0x63b056 : 0x55a049, {roughness:1})); st.rotation.x = -Math.PI/2; st.position.set(i*1.2, .002, -D/2 - 2); st.receiveShadow = true; s.add(st); }
    // shooting line
    const line = new THREE.Mesh(new THREE.PlaneGeometry(9, .06), M(0xffffff)); line.rotation.x = -Math.PI/2; line.position.set(0, .004, -.4); s.add(line);
    // target face from a canvas
    const cv = document.createElement("canvas"); cv.width = cv.height = 512; const x = cv.getContext("2d");
    const cols = ["#f4f4f4", "#f4f4f4", "#1b1b1f", "#1b1b1f", "#2f7fe0", "#2f7fe0", "#e2373d", "#e2373d", "#ffd23f", "#ffd23f"];
    for (let r = 10; r >= 1; r--){ x.beginPath(); x.arc(256, 256, r*25.6, 0, Math.PI*2); x.fillStyle = cols[10 - r]; x.fill(); x.lineWidth = 1.5; x.strokeStyle = r === 7 || r === 8 ? "#ffffff" : "#555"; x.stroke(); }
    x.beginPath(); x.moveTo(250, 256); x.lineTo(262, 256); x.moveTo(256, 250); x.lineTo(256, 262); x.strokeStyle = "#333"; x.stroke();
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const boss = new THREE.Mesh(new THREE.CylinderGeometry(TR + .12, TR + .12, .3, 40), M(0xc9a36a, {roughness:1})); boss.rotation.x = Math.PI/2; boss.position.set(0, TY, -D - .15); boss.castShadow = true; s.add(boss);
    const face = new THREE.Mesh(new THREE.CircleGeometry(TR, 48), new THREE.MeshStandardMaterial({map:tex, roughness:.8})); face.position.set(0, TY, -D + .001); s.add(face);
    const wood = M(0x7a5233);
    for (const sx of [-1, 1]){ const l = new THREE.Mesh(new THREE.BoxGeometry(.08, 2.2, .08), wood); l.position.set(sx*.55, .9, -D - .45); l.rotation.x = -.25; l.castShadow = true; s.add(l); }
    // backstop, hills, trees, a few flags that show the wind
    const bank = new THREE.Mesh(new THREE.SphereGeometry(9, 24, 12, 0, Math.PI*2, 0, Math.PI/2), M(0x4f9445, {roughness:1})); bank.scale.set(2.2, .45, 1); bank.position.set(0, 0, -D - 9); s.add(bank);
    const leaf = M(0x2e7d3a, {roughness:.9}), trunk = M(0x6b4a2f);
    for (let i = 0; i < 18; i++){
      const sx = i % 2 ? 1 : -1, z = -2 - (i >> 1)*(D + 8)/9, xx = sx*(6 + (i % 3)*1.6);
      const t = new THREE.Mesh(new THREE.CylinderGeometry(.15, .22, 1.8, 8), trunk); t.position.set(xx, .9, z); s.add(t);
      const c = new THREE.Mesh(new THREE.SphereGeometry(1.3 + (i % 3)*.3, 12, 10), leaf); c.position.set(xx, 2.8, z); c.castShadow = true; s.add(c);
    }
    this.flags = [];
    for (const [fx, fz] of [[-3.2, -D*.35], [3.2, -D*.7], [-2.6, -D - .5]]){
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, 2.6, 6), M(0xffffff)); pole.position.set(fx, 1.3, fz); s.add(pole);
      const f = new THREE.Mesh(new THREE.PlaneGeometry(.5, .3), new THREE.MeshStandardMaterial({color:0xff5d73, side:THREE.DoubleSide})); f.geometry.translate(.25, 0, 0); f.position.set(fx, 2.45, fz); s.add(f); this.flags.push(f);
    }
  }
  makeBow(){
    // grip at the origin, limbs curving toward the target (-z), string toward the archer (+z)
    const g = new THREE.Group(), R = .42, half = .45*Math.PI;
    const limb = new THREE.Mesh(new THREE.TorusGeometry(R, .016, 6, 28, half*2), new THREE.MeshStandardMaterial({color:0x8a4f2a, roughness:.5}));
    limb.rotation.z = Math.PI - half; limb.position.x = R;
    const wrap = new THREE.Group(); wrap.rotation.y = -Math.PI/2; wrap.add(limb); g.add(wrap);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(.04, .14, .05), new THREE.MeshStandardMaterial({color:0x222233})); g.add(grip);
    this.strGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
    g.add(new THREE.Line(this.strGeo, new THREE.LineBasicMaterial({color:0xeeeeee})));
    this.nock = new THREE.Mesh(new THREE.CylinderGeometry(.007, .007, .75, 6), new THREE.MeshStandardMaterial({color:0xffd23f})); this.nock.rotation.x = Math.PI/2; g.add(this.nock);
    const ez = R*(1 + Math.cos(Math.PI - half)), ey = R*Math.sin(Math.PI - half);
    this.limbTop = new THREE.Vector3(0, ey, ez); this.limbBot = new THREE.Vector3(0, -ey, ez); this.restZ = ez;
    return g;
  }
  fitCamera(cam){ this.baseFov = clamp(2*Math.atan(Math.tan(20*Math.PI/180)/Math.max(.5, cam.aspect))*180/Math.PI, 26, 60); cam.fov = this.baseFov; }

  begin(){ this.turn = 0; this.end = 0; this.startTurn(); }
  startTurn(){
    for (const a of this.stuck) this.scene.remove(a); this.stuck = [];
    this.shot = 0; this.sc[this.turn][this.end] = [];
    this.core.banner(-1, `${esc(this.core.pName(this.turn))}<small>End ${this.end + 1} of ${this.ends} · ${PER_END} arrows</small>`, 1.4);
    this.prepShot(1.4);
  }
  prepShot(delay){
    this.phase = "aim"; this.t = 0; this.aimT = this.core.gt + (delay || 0); this.plan = null; this.drawT = -1; this.swayT = 0;
    this.wind = Math.round(rnd(-3, 3)*10)/10;
  }
  // where the reticle sits on the target plane, before sway
  aimPoint(){
    const s = this.core.pSeat(this.turn);
    if (this.core.pBot(this.turn) || !s) return this.botAim || {x:0, y:TY};
    return {x:this.D*Math.tan(clamp(s.yaw, -40, 40)*.35*Math.PI/180), y:TY + this.D*Math.tan(clamp(s.pit, -40, 40)*.35*Math.PI/180)};
  }
  sway(){
    const t = this.core.gt, held = this.drawT >= 0 ? Math.max(0, this.core.gt - this.drawT - 2.5) : 0, k = .02 + Math.min(.14, held*.05);
    return {x:Math.sin(t*1.7)*k + Math.sin(t*3.1)*k*.4, y:Math.cos(t*1.3)*k*.8 + Math.sin(t*2.7)*k*.3};
  }
  drawing(){ const s = this.core.pSeat(this.turn); return this.core.pBot(this.turn) ? this.drawT >= 0 : !!(s && s.dr); }
  swing(slot, sw){
    if (slot !== this.turn || this.phase !== "aim" || this.core.gt < this.aimT) return;
    const P = sw.bot ? sw.p : (() => { const a = sw.touch ? {x:this.D*Math.tan(clamp(sw.yaw, -40, 40)*.35*Math.PI/180), y:TY + this.D*Math.tan(clamp(sw.pit, -40, 40)*.35*Math.PI/180)} : this.aimPoint(), w = this.sway(); return {x:a.x + w.x, y:a.y + w.y}; })();
    const power = clamp(sw.power, .05, 1), v0 = 18 + power*(VFULL - 18);
    // aim so a full draw lands on the reticle; a weaker draw drops short
    const dx = P.x - EYE.x, dy = P.y - EYE.y, dz = -this.D - EYE.z, L = Math.hypot(dx, dy, dz), T = L/VFULL;
    const vx = dx/T, vy = dy/T + .5*G*T, vz = dz/T, k = v0/Math.hypot(vx, vy, vz);
    this.flying = {x:EYE.x + .05, y:EYE.y - .05, z:EYE.z - .3, vx:vx*k, vy:vy*k, vz:vz*k, mesh:new THREE.Mesh(this.arrowGeo, new THREE.MeshStandardMaterial({color:this.core.pSeat(slot).col}))};
    this.scene.add(this.flying.mesh);
    this.phase = "fly"; this.t = 0; this.drawT = -1;
    if (!this.core.pBot(slot)) this.core.pSeat(slot).hit++;
    Sfx.tone(520, 160, .18, "triangle", .2);
    if (power < .6) this.core.feedback(0, "Weak draw", "#ffd23f", 1);
  }
  step(dt){
    const gt = this.core.gt;
    if (this.phase === "aim"){
      if (gt < this.aimT) return;
      if (this.core.pBot(this.turn)){
        if (!this.plan){
          const wcomp = -this.wind*.1*rnd(.5, 1.3);
          this.botAim = {x:wcomp + gauss()*.07, y:TY + gauss()*.07};
          this.plan = {draw:gt + rnd(.6, 1.2), t:gt + rnd(2.2, 3.4)};
        }
        if (this.drawT < 0 && gt >= this.plan.draw) this.drawT = gt;
        if (gt >= this.plan.t){ const w = this.sway(); this.swing(this.turn, {bot:true, power:rnd(.92, 1), p:{x:this.botAim.x + w.x*.5, y:this.botAim.y + w.y*.5}}); }
      } else {
        const d = this.drawing();
        if (d && this.drawT < 0) this.drawT = gt; else if (!d && this.drawT >= 0 && gt - this.drawT > 1.5) this.drawT = -1;
        if (gt - this.aimT > 25){ this.core.feedback(0, "Auto shot", "#9aa7d6"); this.swing(this.turn, {bot:true, power:.8, p:this.aimPoint()}); }
      }
      return;
    }
    if (this.phase === "fly"){
      const a = this.flying; this.t += dt;
      a.vx += this.wind*1.5*dt; a.vy -= G*dt;
      const oz = a.z; a.x += a.vx*dt; a.y += a.vy*dt; a.z += a.vz*dt;
      if (a.z <= -this.D){
        const f = (oz + this.D)/(oz - a.z); a.x -= a.vx*dt*(1 - f); a.y -= a.vy*dt*(1 - f); a.z = -this.D;
        const r = Math.hypot(a.x, a.y - TY);
        this.hit(r <= TR + .12 ? (r <= TR ? Math.max(1, 10 - Math.floor(r/RING)) : 0) : -1, r);
      } else if (a.y < 0 || this.t > 3) this.hit(-1, 99);
      return;
    }
    if (this.phase === "show"){ this.t -= dt; if (this.t <= 0) this.next(); }
  }
  hit(pts, r){
    const a = this.flying; this.flying = null;
    if (pts >= 0){ a.z = -this.D - .05; this.stuck.push(a.mesh); Sfx.tone(180, 90, .12, "square", .16); } else { this.scene.remove(a.mesh); }
    a.mesh.position.set(a.x, Math.max(.02, a.y), a.z + .3);
    a.mesh.lookAt(a.x + a.vx, a.y + a.vy, a.z + .3 + a.vz);
    const p = Math.max(0, pts);
    this.sc[this.turn][this.end].push(p);
    this.lastHit = {x:a.x, y:a.y};
    this.msg = pts === 10 && r < RING*.5 ? "Bullseye!" : pts === 10 ? "10!" : pts > 0 ? String(pts) : pts === 0 ? "Edge, 0" : "Miss";
    this.core.banner(-1, this.msg, 1.1);
    if (pts >= 9){ Sfx.chime(true); if (!this.core.pBot(this.turn)) this.core.pSeat(this.turn).pt++; }
    this.phase = "show"; this.t = 1.8;
  }
  next(){
    this.shot++;
    if (this.shot < PER_END) return this.prepShot(0);
    this.turn++;
    if (this.turn >= this.n){ this.turn = 0; this.end++; }
    if (this.end >= this.ends) return this.finish();
    this.startTurn();
  }
  totals(){ return this.sc.map(e => e.reduce((a, arr) => a + (arr || []).reduce((x, y) => x + y, 0), 0)); }
  finish(){
    this.phase = "done";
    const tot = this.totals(), order = tot.map((_, i) => i).sort((a, b) => tot[b] - tot[a]);
    const ranking = []; for (const i of order){ const g = ranking.find(r => tot[r[0]] === tot[i]); if (g) g.push(i); else ranking.push([i]); }
    const w = ranking[0];
    this.core.finish(ranking.map(r => r.length === 1 ? r[0] : r), w.map(i => this.core.pName(i)).join(" & ") + (w.length > 1 ? " tie!" : " wins!"), order.map(i => `${this.core.pName(i)} ${tot[i]}`).join(" · "));
  }
  padState(slot){
    const tot = this.totals()[slot], sub = `Score ${tot}`;
    if (this.phase === "done") return {msg:"Round over", sub};
    if (slot !== this.turn) return {msg:"Watching", sub:`${this.core.pName(this.turn)} is shooting · ${sub}`};
    if (this.phase === "aim") return {msg:`Arrow ${this.shot + 1} of ${PER_END}`, sub:"Point to aim, hold to draw, let go"};
    if (this.phase === "fly") return {msg:"Loose!", sub};
    return {msg:this.msg, sub};
  }
  key(e){ if (e.key === " " && this.phase === "aim" && !this.core.pBot(this.turn)) this.swing(this.turn, {power:1, yaw:0, pit:0, touch:true}); }
  draw(dt){
    const core = this.core, gt = core.gt, D = this.D;
    for (const f of this.flags) f.rotation.y = (this.wind >= 0 ? 0 : Math.PI) + Math.sin(gt*4 + f.position.z)*.2*(Math.abs(this.wind)/3 + .2);
    if (this.flying){ const a = this.flying; a.mesh.position.set(a.x, a.y, a.z); a.mesh.lookAt(a.x + a.vx, a.y + a.vy, a.z + a.vz); }
    const aiming = this.phase === "aim" && gt >= this.aimT, drawn = aiming && this.drawing();
    const pull = drawn ? clamp((gt - this.drawT)/1.1, 0, 1) : 0;
    // reticle on the target plane
    let rp = null;
    if (aiming){ const a = this.aimPoint(), w = this.sway(); rp = {x:a.x + w.x, y:a.y + w.y}; }
    this.reticle.visible = this.dot.visible = !!rp;
    if (rp){ this.reticle.position.set(rp.x, rp.y, -D + .02); this.dot.position.set(rp.x, rp.y, -D + .02); const c = core.pSeat(this.turn).col; this.reticle.material.color.set(pull >= 1 ? 0xffd23f : c); this.reticle.scale.setScalar(1.6 - pull*.6); }
    // camera: archer's eye, zooming as the bow is drawn; follow the arrow; then a look at the target
    let tp, tl, fov = this.baseFov;
    if (this.phase === "fly" && this.flying){ const a = this.flying; tp = new THREE.Vector3(a.x + .25, a.y + .12, a.z + 1.2); tl = new THREE.Vector3(a.x, a.y, a.z - 3); fov = this.baseFov*1.2; }
    else if (this.phase === "show"){ tp = new THREE.Vector3(.35, TY + .25, -D + 2.6); tl = new THREE.Vector3(0, TY, -D); fov = this.baseFov*1.1; }
    else { const a = rp || {x:0, y:TY}; tp = new THREE.Vector3(EYE.x, EYE.y, EYE.z); tl = new THREE.Vector3(a.x*.85, TY + (a.y - TY)*.85, -D); fov = this.baseFov*(1 - pull*.35); }
    const k = Math.min(1, dt*(this.phase === "fly" ? 12 : 4)); this.camPos.lerp(tp, k); this.camLook.lerp(tl, k);
    if (this.phase === "fly" && this.t < .05){ this.camPos.copy(tp); this.camLook.copy(tl); }
    this.cam.position.copy(this.camPos); this.cam.lookAt(this.camLook);
    if (Math.abs(this.cam.fov - fov) > .01){ this.cam.fov += (fov - this.cam.fov)*Math.min(1, dt*6); this.cam.updateProjectionMatrix(); }
    // bow in the lower right of the view, string pulled back while drawing
    const showBow = this.phase === "aim" || this.phase === "idle";
    this.bow.visible = showBow;
    if (showBow){
      const off = new THREE.Vector3(-.075, -.045, -.85).applyQuaternion(this.cam.quaternion);
      this.bow.position.copy(this.cam.position).add(off); this.bow.quaternion.copy(this.cam.quaternion); this.bow.rotateZ(.12); this.bow.rotateY(.18); this.bow.scale.setScalar(.3);
      const sz = this.restZ + pull*.45, pts = this.strGeo.attributes.position;
      pts.setXYZ(0, 0, this.limbTop.y, this.limbTop.z); pts.setXYZ(1, .03, 0, sz); pts.setXYZ(2, 0, this.limbBot.y, this.limbBot.z); pts.needsUpdate = true;
      this.nock.visible = aiming; this.nock.position.set(.03, 0, sz - .375);
      this.nock.material.color.set(core.pSeat(this.turn).col);
    }
    // scoreboard
    const E = this.ends, tot = this.totals();
    let html = `<table style="border-collapse:collapse;font-size:clamp(.7rem,1.3vw,1rem)"><tr><td></td>${Array.from({length:E}, (_, k) => `<td style="padding:0 8px;color:#9aa7d6;text-align:center">End ${k + 1}</td>`).join("")}<td style="padding:0 8px;color:#9aa7d6">Total</td></tr>`;
    core.playing.forEach((_, i) => {
      html += `<tr style="${i === this.turn && this.phase !== "done" ? "background:rgba(255,210,63,.15)" : ""}"><td style="padding:2px 10px 2px 2px;color:${core.pSeat(i).col};text-align:left">${esc(core.pName(i))}</td>${Array.from({length:E}, (_, k) => { const arr = this.sc[i][k]; return `<td style="padding:2px 8px;text-align:center;border-left:1px solid rgba(255,255,255,.12)">${arr ? arr.map(v => v === 10 ? "X" : v).join(" ") : ""}</td>`; }).join("")}<td style="padding:2px 8px;font-size:1.15em;text-align:center">${tot[i]}</td></tr>`;
    });
    core.hudSet(0, "sb", html + "</table>");
    let tip = "";
    if (this.phase === "aim" || this.phase === "fly"){
      const wa = Math.abs(this.wind) < .2 ? "calm" : (this.wind > 0 ? "→ " : "← ") + Math.abs(this.wind).toFixed(1);
      tip = `Wind ${wa}`;
      if (aiming && !core.pBot(this.turn)) tip += ` · ${esc(core.pName(this.turn))}: ${core.pSeat(this.turn).mo === "t" ? "hold the button and drag to aim, let go to shoot" : "point the phone to aim, hold the button to draw, let go to shoot"}`;
    }
    core.hudSet(0, "tip", tip);
    core.renderViews(this.scene, [this.cam]);
  }
  destroy(){ this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material){ (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); } }); }
}

registerGame({
  id:"archery", name:"Archery", icon:"🎯", tag:"Up to 4 · take turns", min:1, max:4, fill:2,
  padMode:"bow",
  options:[{key:"ends", label:"Ends of 3 arrows", values:[2, 3, 1]}, {key:"dist", label:"Distance (m)", values:[18, 30, 10]}],
  howto:"Take turns shooting 3 arrows. Hold the phone like a remote, screen up, and point it at the TV to move the sight, then hold the big button to draw the bow and let go to shoot. A full draw flies straight to the sight; let go early and the arrow drops. Watch the wind and aim into it. Hold too long and your aim starts to wobble. No motion? Hold the button and drag your thumb to aim.",
  pad:"Hold the phone like a remote, screen up, pointing at the TV, and tap Recenter. Point to aim, hold the big button to draw, let go to shoot.",
  season:{ends:1}, seasonRules:"3 arrows each, highest score wins",
  create(core, opts){ return new Archery(core, opts); }
});
})();
