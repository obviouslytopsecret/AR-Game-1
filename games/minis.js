/* Pocket Sports minigames: Raft Hop (hop between sinking rafts), Pump Up (tap race to inflate a balloon)
   and Feed Frenzy (time swings at fed balls). Everyone plays at once on one screen. */
(function(){
"use strict";
const rnd = (a, b) => a + Math.random()*(b - a);
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / .5;
const ORD = ["1st", "2nd", "3rd", "4th"];
function groupRank(order, val, better){ // order: slots sorted best first; returns ranking with ties grouped
  const out = []; for (const i of order){ const g = out.find(r => val(r[0]) === val(i)); if (g) g.push(i); else out.push([i]); }
  return out;
}
function countdown(game, dt){
  game.t -= dt; const n = Math.ceil(game.t);
  if (n !== game.cdShown && n > 0){ game.cdShown = n; game.core.banner(-1, String(n), .8); Sfx.beep(false); }
  if (game.t <= 0){ game.core.banner(-1, "Go!", .7); Sfx.beep(true); return true; }
  return false;
}
function disposeScene(scene){ scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material){ (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); } }); }
function finishRanked(core, groups, score){
  const w = groups[0];
  core.finish(groups.map(g => g.length === 1 ? g[0] : g), w.map(i => core.pName(i)).join(" & ") + (w.length > 1 ? " tie!" : " wins!"), groups.flat().map(i => `${core.pName(i)}${score ? " " + score(i) : ""}`).join(" · "));
}

/* ======================= Raft Hop ======================= */
const GN = 7, GS = 2.1;
class RaftHop {
  constructor(core, opts){
    this.core = core; this.views = 1; this.n = core.playing.length; this.limit = +opts.limit || 75;
    const scene = this.scene = new THREE.Scene();
    const sun = core.makeRoom(scene, {sky:0x7cc6e8, fogNear:30, fogFar:80, shadow:10});
    sun.position.set(5, 18, 8); const sc = sun.shadow.camera; sc.far = 50; sc.updateProjectionMatrix();
    const water = new THREE.Mesh(new THREE.PlaneGeometry(200, 200, 1, 1), new THREE.MeshStandardMaterial({color:0x2a8fc8, roughness:.25, metalness:.1})); water.rotation.x = -Math.PI/2; water.position.y = -.25; scene.add(water); this.water = water;
    const wood = [0xc98a4b, 0xb87a3f, 0xd89a5b];
    this.tiles = [];
    for (let i = 0; i < GN; i++) for (let j = 0; j < GN; j++){
      const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({color:wood[(i + j) % 3], roughness:.8});
      for (let k = 0; k < 4; k++){ const plank = new THREE.Mesh(new THREE.BoxGeometry(1.7, .22, .4), mat); plank.position.set(0, 0, -.63 + k*.42); plank.castShadow = plank.receiveShadow = true; g.add(plank); }
      g.position.set((i - (GN - 1)/2)*GS, 0, (j - (GN - 1)/2)*GS); scene.add(g);
      this.tiles.push({i, j, g, mat, base:mat.color.getHex(), state:"up", t:0, y:0});
    }
    this.cam = new THREE.PerspectiveCamera(46, 1, .1, 200);
    this.pl = core.playing.map((_, k) => {
      const b = core.makeBuddy(core.pSeat(k).col); scene.add(b);
      return {b, i:0, j:0, fx:0, fz:-1, hop:null, out:false, outT:0, cool:0, jumpQ:0};
    });
    const spots = [[1, 1], [5, 5], [1, 5], [5, 1]];
    this.pl.forEach((p, k) => { [p.i, p.j] = spots[k]; });
    this.outOrder = []; this.phase = "idle"; this.t = 0; this.time = 0; this.nextWave = 0;
  }
  fitCamera(cam){ cam.fov = clamp(2*Math.atan(Math.tan(28*Math.PI/180)/Math.max(.5, cam.aspect))*180/Math.PI, 34, 78); }
  tile(i, j){ return i >= 0 && j >= 0 && i < GN && j < GN ? this.tiles[i*GN + j] : null; }
  pos(i, j){ return {x:(i - (GN - 1)/2)*GS, z:(j - (GN - 1)/2)*GS}; }
  begin(){ this.phase = "countdown"; this.t = 3; this.cdShown = 0; }
  swing(slot){ this.pl[slot].jumpQ = this.core.gt + .2; }
  key(e){ if (e.key === " " && !this.core.pBot(0)) this.swing(0); }
  dir(slot){
    if (this.core.pBot(slot)) return this.pl[slot].botDir || {x:0, y:0};
    const s = this.core.pSeat(slot); return {x:s.tx || 0, y:s.ty || 0};
  }
  hopTo(slot, di, dj){
    const p = this.pl[slot], gt = this.core.gt;
    const ti = p.i + di, tj = p.j + dj;
    p.hop = {fi:p.i, fj:p.j, ti, tj, t0:gt, dur:.42};
    if (di || dj){ p.fx = di; p.fz = dj; }
    Sfx.tone(420, 700, .1, "sine", .1);
  }
  land(slot){
    const p = this.pl[slot], h = p.hop; p.hop = null; p.i = h.ti; p.j = h.tj;
    const t = this.tile(p.i, p.j);
    if (!t || t.state === "down" || t.state === "sinking"){ this.drop(slot); return; }
    Sfx.click(260, .12);
  }
  drop(slot){
    const p = this.pl[slot]; if (p.out) return;
    p.out = true; p.outT = this.core.gt; this.outOrder.push(slot);
    Sfx.tone(520, 140, .45, "triangle", .14);
    this.core.banner(-1, `${esc(this.core.pName(slot))} is out!`, 1.1);
  }
  wave(){
    // flash a batch of rafts; they sink a moment later and float back up after a while
    const up = this.tiles.filter(t => t.state === "up"), k = Math.min(up.length - 2, Math.round(4 + this.time*.18));
    for (let n = 0; n < k; n++){ const t = up.splice(Math.floor(Math.random()*up.length), 1)[0]; if (!t) break; t.state = "warn"; t.t = this.core.gt + Math.max(.9, 1.7 - this.time*.012); }
    this.nextWave = this.core.gt + Math.max(1.6, 3.2 - this.time*.025);
  }
  step(dt){
    const gt = this.core.gt;
    if (this.phase === "countdown"){ if (countdown(this, dt)){ this.phase = "play"; this.time = 0; this.nextWave = gt + 1.5; } return; }
    if (this.phase === "end"){ this.t -= dt; if (this.t <= 0 && !this.done){ this.done = true; this.finish(); } return; }
    if (this.phase !== "play") return;
    this.time += dt;
    if (gt >= this.nextWave) this.wave();
    for (const t of this.tiles){
      if (t.state === "warn" && gt >= t.t){ t.state = "sinking"; t.t = gt + .5; }
      else if (t.state === "sinking" && gt >= t.t){ t.state = "down"; t.t = gt + Math.max(2.5, 5 - this.time*.03); }
      else if (t.state === "down" && gt >= t.t){ t.state = "up"; }
    }
    this.pl.forEach((p, k) => {
      if (p.out) return;
      if (p.hop){ if (gt - p.hop.t0 >= p.hop.dur) this.land(k); return; }
      const t = this.tile(p.i, p.j);
      if (t && t.state === "sinking"){ this.drop(k); return; }
      if (this.core.pBot(k)) this.botThink(k);
      if (p.jumpQ > gt && gt > p.cool){
        p.jumpQ = 0; p.cool = gt + .1;
        const d = this.dir(k), m = Math.hypot(d.x, d.y);
        let di = 0, dj = 0;
        if (m > .35){ const a = Math.atan2(-d.y, d.x), oct = Math.round(a/(Math.PI/4)); di = Math.round(Math.cos(oct*Math.PI/4)); dj = Math.round(Math.sin(oct*Math.PI/4)); }
        else { di = p.fx; dj = p.fz; }
        this.hopTo(k, di, dj);
      }
    });
    const alive = this.pl.map((p, k) => k).filter(k => !this.pl[k].out);
    if ((this.n > 1 && alive.length <= 1) || alive.length === 0 || this.time >= this.limit){
      this.final = [alive, ...this.outOrder.slice().reverse().map(k => [k])].filter(g => g.length);
      this.phase = "end"; this.t = 1.6;
      if (this.time >= this.limit && alive.length > 1) this.core.banner(-1, "Time! Survivors share the win", 1.4);
    }
  }
  botThink(k){
    const p = this.pl[k], gt = this.core.gt, here = this.tile(p.i, p.j);
    p.think = p.think || 0; if (gt < p.think) return;
    p.think = gt + rnd(.25, .6) + k*.05;
    const danger = here && here.state === "warn";
    if (!danger && Math.random() < .8) return;
    const opts = [];
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++){ if (!di && !dj) continue; const t = this.tile(p.i + di, p.j + dj); if (t && t.state === "up") opts.push([di, dj]); }
    if (!opts.length || Math.random() < .07){ opts.push([Math.round(rnd(-1, 1)), Math.round(rnd(-1, 1))]); }
    const [di, dj] = opts[Math.floor(Math.random()*opts.length)];
    if (!di && !dj) return;
    p.botDir = {x:di, y:-dj}; this.swing(k);
  }
  finish(){ finishRanked(this.core, this.final); }
  padState(slot){
    const p = this.pl[slot];
    if (this.phase === "countdown") return {msg:"Get ready", sub:"Tilt to pick a direction, tap Jump to hop"};
    if (p.out) return {msg:"Splash!", sub:"Watch the rest"};
    if (this.phase === "end") return {msg:"Survived!", sub:""};
    return {msg:"Hop!", sub:`Red rafts are about to sink · ${Math.max(0, Math.ceil(this.limit - this.time))} s`};
  }
  draw(dt){
    const core = this.core, gt = core.gt;
    for (const t of this.tiles){
      let ty = 0;
      if (t.state === "warn"){ t.mat.color.setHex(Math.floor(gt*8) % 2 ? 0xff5d5d : t.base); ty = Math.sin(gt*30)*.03; }
      else { t.mat.color.setHex(t.base); }
      if (t.state === "sinking") ty = -1.2*(1 - (t.t - gt)/.5);
      if (t.state === "down") ty = -1.4;
      if (t.state === "up" && t.y < -.05) ty = t.y + dt*3;
      t.y += (ty - t.y)*Math.min(1, dt*10); if (t.state === "up") t.y = Math.min(0, t.y); t.g.position.y = t.y + Math.sin(gt*1.5 + t.i + t.j*.7)*.03;
    }
    this.pl.forEach((p, k) => {
      let x, z, y = .11;
      if (p.hop){ const u = clamp((gt - p.hop.t0)/p.hop.dur, 0, 1), a = this.pos(p.hop.fi, p.hop.fj), b = this.pos(p.hop.ti, p.hop.tj); x = lerp(a.x, b.x, u); z = lerp(a.z, b.z, u); y += Math.sin(u*Math.PI)*1.1; }
      else { const a = this.pos(p.i, p.j), t = this.tile(p.i, p.j); x = a.x; z = a.z; y += t ? t.y : -1; }
      if (p.out){ const u = gt - p.outT; y = Math.max(-2, y - u*4); }
      const off = (k - (this.n - 1)/2)*.0; p.b.position.set(x + off, y, z);
      p.b.rotation.y = Math.atan2(p.fx, p.fz);
      p.b.visible = !(p.out && gt - p.outT > .8);
    });
    this.cam.position.set(0, 16.5, 12.5); this.cam.lookAt(0, 0, .9);
    core.hudSet(0, "sb", this.pl.map((p, k) => `<span style="color:${core.pSeat(k).col};margin:0 8px">${esc(core.pName(k))}${p.out ? " <span class='mute'>out</span>" : ""}</span>`).join("") + (this.phase === "play" ? `<span class="mute" style="margin-left:10px">${Math.max(0, Math.ceil(this.limit - this.time))}s</span>` : ""));
    const anyHuman = core.playing.some((_, i) => !core.pBot(i));
    core.hudSet(0, "tip", this.phase === "countdown" && anyHuman ? "Tilt the phone toward a raft and tap Jump to hop. Flashing rafts are about to sink!" : "");
    core.renderViews(this.scene, [this.cam]);
  }
  destroy(){ disposeScene(this.scene); }
}

/* ======================= Pump Up ======================= */
class PumpUp {
  constructor(core, opts){
    this.core = core; this.views = 1; this.n = core.playing.length; this.dur = +opts.secs || 10;
    const scene = this.scene = new THREE.Scene();
    core.makeRoom(scene, {sky:0xffc7e0, fogNear:20, fogFar:60, shadow:8});
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({color:0xf7e3b5, roughness:.9})); floor.rotation.x = -Math.PI/2; floor.receiveShadow = true; scene.add(floor);
    const stage = new THREE.Mesh(new THREE.BoxGeometry(this.n*2.6 + 1.5, .3, 3), new THREE.MeshStandardMaterial({color:0x7a5af5, roughness:.6})); stage.position.y = .15; stage.receiveShadow = true; scene.add(stage);
    this.cam = new THREE.PerspectiveCamera(45, 1, .1, 100);
    this.pl = core.playing.map((_, k) => {
      const col = core.pSeat(k).col, x = (k - (this.n - 1)/2)*2.6;
      const b = core.makeBuddy(col); b.position.set(x - .55, .3, .4); b.rotation.y = .5; scene.add(b);
      const pump = new THREE.Group(); pump.position.set(x - .05, .3, .5); scene.add(pump);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(.12, .14, .7, 12), new THREE.MeshStandardMaterial({color:0x3e4a6b})); body.position.y = .35; pump.add(body);
      const rod = new THREE.Group(); rod.position.y = .7; pump.add(rod);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, .5, 8), new THREE.MeshStandardMaterial({color:0xcccccc})); shaft.position.y = .25; rod.add(shaft);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(.5, .07, .07), new THREE.MeshStandardMaterial({color:0xff5d73})); handle.position.y = .5; rod.add(handle);
      const balloon = new THREE.Mesh(new THREE.SphereGeometry(.5, 24, 18), new THREE.MeshStandardMaterial({color:col, roughness:.25, metalness:.05, transparent:true, opacity:.95}));
      balloon.scale.set(.3, .36, .3); balloon.castShadow = true; scene.add(balloon);
      const knot = new THREE.Mesh(new THREE.ConeGeometry(.06, .1, 8), new THREE.MeshStandardMaterial({color:col})); scene.add(knot);
      const hose = new THREE.Mesh(new THREE.TorusGeometry(.3, .02, 6, 16, Math.PI), new THREE.MeshStandardMaterial({color:0x222233})); hose.position.set(x + .25, .62, .5); hose.rotation.z = Math.PI; scene.add(hose);
      return {x, b, rod, balloon, knot, taps:0, last:-9, pumpT:-9, bot:{rate:rnd(7, 11.5), next:0}};
    });
    this.phase = "idle"; this.t = 0; this.time = 0;
  }
  fitCamera(cam){ cam.fov = clamp(2*Math.atan(Math.tan(Math.max(24, this.n*9)*Math.PI/180)/Math.max(.5, cam.aspect))*180/Math.PI, 30, 84); }
  begin(){ this.phase = "countdown"; this.t = 3; this.cdShown = 0; }
  swing(slot){
    if (this.phase !== "play") return;
    const p = this.pl[slot], gt = this.core.gt;
    if (gt - p.last < 1/14) return; // taps beyond about 14 a second don't count
    p.last = gt; p.taps++; p.pumpT = gt;
    if (p.taps % 10 === 0 && !this.core.pBot(slot)) this.core.pSeat(slot).hit++;
    if (slot === 0 || !this.core.pBot(slot)) Sfx.tone(200 + p.taps*4, 260 + p.taps*4, .04, "square", .04);
  }
  key(e){ if (e.key === " " && !this.core.pBot(0)) this.swing(0); }
  step(dt){
    const gt = this.core.gt;
    if (this.phase === "countdown"){ if (countdown(this, dt)){ this.phase = "play"; this.time = 0; } return; }
    if (this.phase === "play"){
      this.time += dt;
      this.pl.forEach((p, k) => { if (!this.core.pBot(k)) return; if (gt >= p.bot.next){ this.swing(k); const fade = this.time > this.dur*.6 ? rnd(.85, 1) : 1; p.bot.next = gt + 1/(p.bot.rate*fade)*rnd(.7, 1.3); } });
      if (this.time >= this.dur){
        this.phase = "reveal"; this.t = 2.6; Sfx.chime(true);
        const best = Math.max(...this.pl.map(p => p.taps));
        this.pl.forEach((p, k) => { if (p.taps === best && !this.core.pBot(k)) this.core.pSeat(k).pt++; });
        this.core.banner(-1, "Stop!", 1);
      }
      return;
    }
    if (this.phase === "reveal"){ this.t -= dt; if (this.t <= 0 && !this.done){ this.done = true; this.finish(); } }
  }
  size(p){ return .3 + Math.sqrt(p.taps)*.13; }
  finish(){
    const order = this.pl.map((_, k) => k).sort((a, b) => this.pl[b].taps - this.pl[a].taps);
    finishRanked(this.core, groupRank(order, k => this.pl[k].taps), k => `${this.pl[k].taps} pumps`);
  }
  padState(slot){
    const p = this.pl[slot];
    if (this.phase === "countdown") return {msg:"Get ready", sub:"Tap as fast as you can!"};
    if (this.phase === "play") return {msg:"TAP TAP TAP!", sub:`${p.taps} pumps · ${Math.max(0, Math.ceil(this.dur - this.time))} s`};
    return {msg:`${p.taps} pumps`, sub:""};
  }
  draw(dt){
    const core = this.core, gt = core.gt;
    const best = Math.max(1, ...this.pl.map(p => p.taps));
    this.pl.forEach((p, k) => {
      const s = this.size(p), u = clamp((gt - p.pumpT)/.12, 0, 1);
      p.rod.position.y = .7 - Math.sin(u*Math.PI)*.28;
      const lift = this.phase === "reveal" && p.taps === best ? (2.6 - this.t)*1.4 : 0;
      p.balloon.scale.set(s, s*1.15, s);
      p.balloon.position.set(p.x + .55, .3 + .75 + s*.58 + lift + Math.sin(gt*2 + k)*.03, .5);
      p.knot.position.set(p.x + .55, .3 + .75 + lift, .5); p.knot.rotation.x = Math.PI;
      p.b.userData.body.scale.y = 1 - Math.sin(u*Math.PI)*.08;
    });
    const maxS = Math.max(...this.pl.map(p => this.size(p)));
    const h = 2.4 + maxS*.9;
    this.cam.position.set(0, h, 7.2 + maxS*1.6); this.cam.lookAt(0, 1.1 + maxS*.45, 0);
    core.hudSet(0, "sb", this.pl.map((p, k) => `<span style="color:${core.pSeat(k).col};margin:0 8px">${esc(core.pName(k))} <b>${p.taps}</b></span>`).join("") + (this.phase === "play" ? `<span class="mute" style="margin-left:10px">${Math.max(0, this.dur - this.time).toFixed(1)}s</span>` : ""));
    const anyHuman = core.playing.some((_, i) => !core.pBot(i));
    core.hudSet(0, "tip", this.phase === "countdown" && anyHuman ? "Tap the big button on your phone as fast as you can. Biggest balloon wins!" : "");
    core.renderViews(this.scene, [this.cam]);
  }
  destroy(){ disposeScene(this.scene); }
}

/* ======================= Feed Frenzy ======================= */
const LANE = 3.2, CONTACT = {y:1.0, z:0}, FEED_T = 1.05;
class FeedFrenzy {
  constructor(core, opts){
    this.core = core; this.views = 1; this.n = core.playing.length; this.balls = +opts.balls || 8;
    const scene = this.scene = new THREE.Scene();
    const sun = core.makeRoom(scene, {sky:0x87c6e8, fogNear:60, fogFar:140, shadow:14});
    sun.position.set(6, 22, -6); sun.target.position.set(0, 0, -20); const sc = sun.shadow.camera; sc.far = 70; sc.updateProjectionMatrix();
    this.buildRange();
    this.cam = new THREE.PerspectiveCamera(50, 1, .1, 300);
    this.pl = core.playing.map((_, k) => {
      const x = (k - (this.n - 1)/2)*LANE, col = core.pSeat(k).col;
      const b = core.makeBuddy(col); b.position.set(x - .55, 0, .25); b.rotation.y = Math.PI/2; scene.add(b);
      const racket = new THREE.Group(); scene.add(racket);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.14, .015, 8, 24), new THREE.MeshStandardMaterial({color:col})); ring.scale.y = 1.25; ring.position.y = .4; racket.add(ring);
      const str = new THREE.Mesh(new THREE.CircleGeometry(.135, 20), new THREE.MeshStandardMaterial({color:0xffffff, transparent:true, opacity:.5, side:THREE.DoubleSide})); str.scale.y = 1.25; str.position.y = .4; racket.add(str);
      const sh = new THREE.Mesh(new THREE.CylinderGeometry(.016, .02, .28, 8), new THREE.MeshStandardMaterial({color:0x2b2b3a})); sh.position.y = .14; racket.add(sh);
      const machine = new THREE.Mesh(new THREE.BoxGeometry(.7, .8, .7), new THREE.MeshStandardMaterial({color:0x3e7bff, roughness:.5})); machine.position.set(x + .25, .4, -9); machine.castShadow = true; scene.add(machine);
      const mouth = new THREE.Mesh(new THREE.CylinderGeometry(.12, .12, .3, 12), new THREE.MeshStandardMaterial({color:0x222233})); mouth.rotation.x = Math.PI/2; mouth.position.set(x + .25, .65, -8.6); scene.add(mouth);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(.07, 14, 10), new THREE.MeshStandardMaterial({color:0xe4ff3a, emissive:0x2a3300})); ball.castShadow = true; ball.visible = false; scene.add(ball);
      return {x, racket, ball, b, score:0, fed:0, shots:[], cur:null, swingT:-9, cool:0, msg:"", plan:null};
    });
    this.phase = "idle"; this.t = 0; this.nextFeed = 0; this.feedN = 0;
  }
  buildRange(){
    const s = this.scene, M = (c, o={}) => new THREE.MeshStandardMaterial(Object.assign({color:c, roughness:.9}, o));
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), M(0x4f9a4a, {roughness:1})); grass.rotation.x = -Math.PI/2; grass.receiveShadow = true; s.add(grass);
    const court = new THREE.Mesh(new THREE.PlaneGeometry(this.n*LANE + 2, 12), M(0x2f8f6a)); court.rotation.x = -Math.PI/2; court.position.set(0, .004, -4); court.receiveShadow = true; s.add(court);
    // distance bands out in the field
    this.zones = [{d:18, pts:1, col:0x6cd47a}, {d:30, pts:2, col:0xffd23f}, {d:42, pts:3, col:0xff9f43}, {d:56, pts:5, col:0xff5d73}];
    let prev = 8;
    for (const zn of this.zones){
      const band = new THREE.Mesh(new THREE.PlaneGeometry(40, zn.d - prev), M(zn.col, {transparent:true, opacity:.55})); band.rotation.x = -Math.PI/2; band.position.set(0, .006, -(prev + zn.d)/2); band.receiveShadow = true; s.add(band);
      const line = new THREE.Mesh(new THREE.PlaneGeometry(40, .2), M(0xffffff)); line.rotation.x = -Math.PI/2; line.position.set(0, .008, -zn.d); s.add(line);
      // number signs
      const cv = document.createElement("canvas"); cv.width = 128; cv.height = 64; const x = cv.getContext("2d"); x.fillStyle = "#ffffff"; x.fillRect(0, 0, 128, 64); x.fillStyle = "#1b2550"; x.font = "bold 44px sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("+" + zn.pts, 64, 34);
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      for (const sx of [-1, 1]){ const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshBasicMaterial({map:tex})); sign.position.set(sx*(this.n*LANE/2 + 4), 1.2, -zn.d + .5); s.add(sign); }
      prev = zn.d;
    }
    const fence = new THREE.Mesh(new THREE.BoxGeometry(60, 2, .3), M(0x23497a)); fence.position.set(0, 1, -66); s.add(fence);
    for (let i = 0; i < 14; i++){ const tr = new THREE.Mesh(new THREE.SphereGeometry(2 + (i % 3)*.5, 12, 10), M(0x2e7d3a)); tr.position.set(-30 + i*4.6, 3, -70 - (i % 2)*3); s.add(tr); }
  }
  fitCamera(cam){ cam.fov = clamp(2*Math.atan(Math.tan(Math.max(26, this.n*8)*Math.PI/180)/Math.max(.5, cam.aspect))*180/Math.PI, 34, 82); }
  begin(){ this.phase = "countdown"; this.t = 3; this.cdShown = 0; }
  feed(){
    const gt = this.core.gt; this.feedN++;
    const fast = this.feedN > this.balls*.5 ? rnd(.75, .95) : rnd(.95, 1.1);
    this.pl.forEach(p => { p.cur = {t0:gt, T:FEED_T*fast, hit:null, x0:p.x + .25, y0:.65, z0:-8.6}; p.fed++; p.plan = null; p.ball.visible = true; });
    this.nextFeed = gt + 2.6;
    Sfx.tone(160, 120, .12, "sine", .1);
  }
  ballPos(c, t){ // arc from the machine to the contact spot, then on past the batter
    const u = (t - c.t0)/c.T, x = lerp(c.x0, c.x0 - .25, u), z = lerp(c.z0, CONTACT.z, u), y = lerp(c.y0, CONTACT.y, u) + Math.sin(Math.min(u, 1)*Math.PI)*.9 - (u > 1 ? (u - 1)*(u - 1)*6 : 0);
    return {x, y:Math.max(.07, y), z};
  }
  swing(slot, sw){
    const p = this.pl[slot], gt = this.core.gt;
    if (this.phase !== "play" || gt < p.cool) return;
    p.cool = gt + .45; p.swingT = gt;
    const c = p.cur; if (!c || c.hit) return;
    const ts = gt - (sw.lag || 0), err = ts - (c.t0 + c.T);
    if (err < -.35 || err > .3) return;
    const q = Math.abs(err), quality = q < .04 ? 1 : q < .1 ? .85 : q < .18 ? .6 : .3;
    const power = clamp(sw.power == null ? .7 : sw.power, .2, 1);
    const dist = 8 + quality*(16 + power*36)*rnd(.95, 1.05);
    const side = q > .2 ? Math.sign(err)*rnd(18, 28) : err*60;
    const pos = this.ballPos(c, gt);
    c.hit = {t:gt, x0:pos.x, y0:pos.y, z0:pos.z, dist, ang:side*Math.PI/180, T:.7 + dist/45, foul:Math.abs(side) > 15};
    const label = q < .04 ? "Perfect!" : q < .1 ? "Great" : q < .18 ? (err < 0 ? "Early" : "Late") : (err < 0 ? "Way early" : "Way late");
    p.msg = label;
    Sfx.click(700, .3 + quality*.4);
    if (!this.core.pBot(slot)) this.core.pSeat(slot).hit++;
  }
  key(e){ if (e.key === " " && !this.core.pBot(0)) this.swing(0, {power:.8}); }
  score(p, h){
    if (h.foul) return {pts:0, label:"Foul"};
    let pts = 0; for (const zn of this.zones) if (h.dist >= zn.d) pts = zn.pts; if (h.dist >= 56) pts = 5;
    return {pts, label:h.dist >= 56 ? "Over the fence!" : `${Math.round(h.dist)} m`};
  }
  step(dt){
    const gt = this.core.gt;
    if (this.phase === "countdown"){ if (countdown(this, dt)){ this.phase = "play"; this.nextFeed = gt + .8; } return; }
    if (this.phase === "end"){ this.t -= dt; if (this.t <= 0 && !this.done){ this.done = true; this.finish(); } return; }
    if (this.phase !== "play") return;
    this.pl.forEach((p, k) => {
      const c = p.cur; if (!c) return;
      if (this.core.pBot(k) && !c.hit){ if (!p.plan) p.plan = {t:c.t0 + c.T + gauss()*.07, pw:rnd(.45, 1)}; if (gt >= p.plan.t && !p.plan.done){ p.plan.done = true; this.swing(k, {power:p.plan.pw, lag:0}); } }
      if (c.hit && !c.scored && gt - c.hit.t >= c.hit.T){
        c.scored = true; const r = this.score(p, c.hit); p.score += r.pts; p.shots.push(r.pts);
        this.core.feedback(0, `${esc(this.core.pName(k))}: ${esc(r.label)}${r.pts ? " +" + r.pts : ""}`, this.core.pSeat(k).col, 1.1);
        if (r.pts >= 3 && !this.core.pBot(k)) this.core.pSeat(k).pt++;
        if (r.pts >= 5) Sfx.chime(true);
      }
      if (!c.hit && gt - c.t0 > c.T + .5 && !c.missed){ c.missed = true; p.shots.push(0); p.msg = "Missed"; }
    });
    const settled = this.pl.every(p => !p.cur || p.cur.scored || p.cur.missed);
    if (gt >= this.nextFeed && settled){ if (this.feedN >= this.balls){ this.phase = "end"; this.t = 1.2; } else this.feed(); }
  }
  finish(){
    const order = this.pl.map((_, k) => k).sort((a, b) => this.pl[b].score - this.pl[a].score);
    finishRanked(this.core, groupRank(order, k => this.pl[k].score), k => `${this.pl[k].score}`);
  }
  padState(slot){
    const p = this.pl[slot];
    if (this.phase === "countdown") return {msg:"Get ready", sub:"Swing as each ball reaches you"};
    if (this.phase === "end") return {msg:`${p.score} points`, sub:""};
    return {msg:p.cur && !p.cur.hit && !p.cur.missed ? "Swing when it arrives!" : (p.msg || "Here it comes"), sub:`Ball ${Math.min(this.feedN, this.balls)} of ${this.balls} · ${p.score} points`};
  }
  draw(dt){
    const core = this.core, gt = core.gt;
    let follow = null;
    this.pl.forEach((p, k) => {
      const c = p.cur;
      if (c){
        let pos;
        if (c.hit){ const h = c.hit, u = clamp((gt - h.t)/h.T, 0, 1.3); const dx = Math.sin(h.ang)*h.dist, dz = -Math.cos(h.ang)*h.dist; pos = {x:h.x0 + dx*Math.min(u, 1), y:Math.max(.07, h.y0 + Math.sin(Math.min(u, 1)*Math.PI)*(3 + h.dist*.18)), z:h.z0 + dz*Math.min(u, 1)}; if (!follow || h.dist > follow.d) follow = {d:h.dist, z:pos.z, u}; }
        else pos = this.ballPos(c, gt);
        p.ball.position.set(pos.x, pos.y, pos.z); p.ball.visible = !(c.missed && gt - c.t0 > c.T + .6);
      }
      const u = (gt - p.swingT)/.28; let a = -1.3;
      if (u >= 0 && u <= 1) a = lerp(-1.6, 1.6, 1 - Math.pow(1 - u, 2)); else if (u > 1 && u < 1.6) a = 1.6;
      p.racket.position.set(p.x - .2, .75, .05); p.racket.rotation.set(0, a, -1.3);
    });
    const tz = follow && follow.u < 1.1 ? Math.min(-4, follow.z*.6) : -4;
    this.camZ = this.camZ == null ? tz : this.camZ + (tz - this.camZ)*Math.min(1, dt*2);
    this.cam.position.set(0, 3.8 + Math.max(0, -this.camZ - 4)*.25, 7.6 + (this.camZ + 4)*.1); this.cam.lookAt(0, .3, this.camZ - 4);
    core.hudSet(0, "sb", this.pl.map((p, k) => `<span style="color:${core.pSeat(k).col};margin:0 8px">${esc(core.pName(k))} <b>${p.score}</b></span>`).join("") + `<span class="mute" style="margin-left:10px">Ball ${Math.min(this.feedN, this.balls)}/${this.balls}</span>`);
    const anyHuman = core.playing.some((_, i) => !core.pBot(i));
    core.hudSet(0, "tip", this.phase === "countdown" && anyHuman ? "The machine feeds you balls. Swing your phone as each ball reaches you; perfect timing goes furthest." : "");
    core.renderViews(this.scene, [this.cam]);
  }
  destroy(){ disposeScene(this.scene); }
}

registerGame({
  id:"hop", name:"Raft Hop", icon:"🛶", tag:"Up to 4 · last one dry", min:2, max:4, fill:4, padMode:"tilt",
  options:[{key:"limit", label:"Time limit (s)", values:[75, 45, 120]}],
  howto:"Everyone starts on a grid of floating rafts. Tilt your phone toward a neighbouring raft and tap Jump to hop onto it. Rafts flash red just before they sink, so keep moving. Land in the water and you're out. Last one dry wins. No motion? Drag the stick to pick a direction.",
  pad:"Hold the phone flat and tap Recenter. Tilt toward a raft, tap Jump to hop.", season:{limit:45}, seasonRules:"Last one dry wins (45 s)",
  create(core, opts){ return new RaftHop(core, opts); }
});
registerGame({
  id:"pump", name:"Pump Up", icon:"🎈", tag:"Up to 4 · tap race", min:1, max:4, fill:4, padMode:"mash",
  options:[{key:"secs", label:"Seconds", values:[10, 5, 15]}],
  howto:"Tap the big button on your phone as fast as you can to pump up your balloon. Biggest balloon when time runs out wins. Taps faster than about 14 a second don't count, so rhythm beats frantic slapping.",
  pad:"Tap the big button as fast as you can.", season:{secs:10}, seasonRules:"10 seconds, most pumps wins",
  create(core, opts){ return new PumpUp(core, opts); }
});
registerGame({
  id:"feed", name:"Feed Frenzy", icon:"🎾", tag:"Up to 4 · swing timing", min:1, max:4, fill:4,
  options:[{key:"balls", label:"Balls", values:[8, 5, 12]}],
  howto:"A ball machine feeds each player the same balls at the same time. Swing your phone like a racket just as the ball reaches you. Perfect timing and a hard swing send it furthest; early or late shots slice foul. Land in the far bands for more points. No motion? Swipe up on the phone instead.",
  pad:"Hold the phone like a racket handle, screen facing the TV, and tap Recenter. Swing as each ball arrives.", season:{balls:5}, seasonRules:"5 balls, most points wins",
  create(core, opts){ return new FeedFrenzy(core, opts); }
});
})();
