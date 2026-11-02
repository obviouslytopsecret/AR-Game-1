/* Pocket Sports: tilt-ball games. Each player balances on a ball; tilting the phone rolls it, tapping Jump hops.
   Three games share the physics here: Roll Rally (race), Bump Ring (push-off) and Wobble Run (obstacle course). */
(function(){
"use strict";
const R = .45, G = 18, ACC = 9, DRAG = .9, JUMP = 7.2, STEP = 1/240;
const rnd = (a, b) => a + Math.random()*(b - a);

function stripeTex(col){
  const cv = document.createElement("canvas"); cv.width = 128; cv.height = 64; const x = cv.getContext("2d");
  x.fillStyle = col; x.fillRect(0, 0, 128, 64);
  x.fillStyle = "rgba(255,255,255,.85)"; for (let i = 0; i < 4; i++) x.fillRect(i*32 + 8, 0, 9, 64);
  x.fillStyle = "rgba(0,0,0,.18)"; x.fillRect(0, 28, 128, 8);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

class TiltBase {
  constructor(core, opts){
    this.core = core; this.opts = opts; this.views = 1; this.n = core.playing.length;
    const scene = this.scene = new THREE.Scene();
    this.sun = core.makeRoom(scene, {sky:this.sky || 0x8fd0ff, fogNear:50, fogFar:140, shadow:30});
    this.sun.position.set(8, 30, 12); const sc = this.sun.shadow.camera; sc.far = 80; sc.updateProjectionMatrix();
    const water = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({color:0x2f7fd0, roughness:.35, metalness:.1})); water.rotation.x = -Math.PI/2; water.position.y = -9; scene.add(water);
    this.cam = new THREE.PerspectiveCamera(48, 1, .1, 300);
    this.camPos = new THREE.Vector3(0, 20, 18); this.camLook = new THREE.Vector3(0, 0, 0);
    this.riders = core.playing.map((_, i) => {
      const col = core.pSeat(i).col, g = new THREE.Group();
      const ball = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 16), new THREE.MeshStandardMaterial({map:stripeTex(col), roughness:.35})); ball.castShadow = true; g.add(ball);
      const bud = core.makeBuddy(col); bud.scale.setScalar(.62); bud.position.y = R - .03; g.add(bud);
      const ring = new THREE.Mesh(new THREE.RingGeometry(.55, .7, 24), new THREE.MeshBasicMaterial({color:col, transparent:true, opacity:.75, depthWrite:false}));
      ring.rotation.x = -Math.PI/2; scene.add(ring);
      scene.add(g);
      return {g, ball, bud, ring, x:0, y:0, z:0, vx:0, vy:0, vz:0, ground:true, out:false, dead:false, wait:0, jumpQ:0, lean:{x:0, z:0}, rank:0};
    });
    this.phase = "idle"; this.t = 0; this.time = 0;
  }
  fitCamera(cam){ cam.fov = clamp(2*Math.atan(Math.tan(26*Math.PI/180)/Math.max(.5, cam.aspect))*180/Math.PI, 30, 75); }
  begin(){ this.phase = "countdown"; this.t = 3; this.cdShown = 0; }
  swing(slot){ const r = this.riders[slot]; if (r) r.jumpQ = this.core.gt + .15; }
  key(e){ const k = e.key.toLowerCase(); if (k === " " && !this.core.pBot(0)) this.swing(0); }
  input(slot){
    if (this.core.pBot(slot)) return this.ai(slot);
    const s = this.core.pSeat(slot); return {x:s.tx || 0, y:s.ty || 0};
  }
  /* height of solid ground under (x, z), or null over the void */
  groundAt(){ return 0; }
  place(r, x, z){ Object.assign(r, {x, y:(this.groundAt(x, z) ?? 0), z, vx:0, vy:0, vz:0, ground:true, out:false}); }
  step(dt){
    const core = this.core, gt = core.gt;
    if (this.phase === "countdown"){
      this.t -= dt; const n = Math.ceil(this.t);
      if (n !== this.cdShown && n > 0){ this.cdShown = n; core.banner(-1, String(n), .8); Sfx.beep(false); }
      if (this.t <= 0){ core.banner(-1, "Go!", .7); Sfx.beep(true); this.phase = "play"; this.time = 0; }
      this.stepWorld(dt, true); return;
    }
    if (this.phase === "play"){ this.time += dt; this.stepWorld(dt, false); this.rules(dt); return; }
    if (this.phase === "end"){ this.stepWorld(dt, true); this.t -= dt; if (this.t <= 0 && !this.finished){ this.finished = true; this.finish(); } }
  }
  stepWorld(dt, frozen){
    const gt = this.core.gt;
    this.moveWorld && this.moveWorld(dt);
    this.riders.forEach((r, i) => {
      if (r.dead) return;
      if (r.wait > 0){ r.wait -= dt; if (r.wait <= 0) this.respawn(i); else return; }
      const inp = frozen || r.out ? {x:0, y:0} : this.input(i);
      const ax = clamp(inp.x, -1, 1)*ACC, az = -clamp(inp.y, -1, 1)*ACC;
      r.lean.x += (inp.x - r.lean.x)*Math.min(1, dt*8); r.lean.z += (-inp.y - r.lean.z)*Math.min(1, dt*8);
      const gnd = this.groundAt(r.x, r.z);
      const on = gnd !== null && r.y <= gnd + .02 && r.vy <= .01;
      if (on){
        r.vx += ax*dt; r.vz += az*dt;
        const k = Math.exp(-DRAG*dt); r.vx *= k; r.vz *= k;
        if (this.carry){ const c = this.carry(r.x, r.z); if (c){ r.x += c.x*dt; r.z += c.z*dt; } }
        r.y = gnd; r.vy = 0;
        if (!frozen && r.jumpQ > gt){ r.vy = JUMP; r.jumpQ = 0; r.y += .01; Sfx.tone(380, 620, .12, "sine", .12); }
      } else {
        r.vx += ax*.35*dt; r.vz += az*.35*dt; r.vy -= G*dt;
      }
      const sp = Math.hypot(r.vx, r.vz), vmax = 11; if (sp > vmax){ r.vx *= vmax/sp; r.vz *= vmax/sp; }
      const oy = r.y;
      r.x += r.vx*dt; r.z += r.vz*dt; r.y += r.vy*dt;
      const g2 = this.groundAt(r.x, r.z);
      if (g2 !== null && r.y < g2 && oy >= g2 - .25){ r.y = g2; if (r.vy < -4) Sfx.click(300, .15); r.vy = 0; }
      this.collide && this.collide(r, i, dt);
      if (r.y < -6 && !r.out){ r.out = true; this.fell(i); }
      // roll the ball
      const spd = Math.hypot(r.vx, r.vz);
      if (spd > 1e-3){ const ax2 = new THREE.Vector3(r.vz, 0, -r.vx).normalize(); r.ball.rotateOnWorldAxis(ax2, spd*dt/R); }
    });
    // riders bump each other
    for (let a = 0; a < this.riders.length; a++) for (let b = a + 1; b < this.riders.length; b++){
      const A = this.riders[a], B = this.riders[b]; if (A.dead || B.dead || A.wait > 0 || B.wait > 0) continue;
      const dx = B.x - A.x, dz = B.z - A.z, dy = B.y - A.y, d = Math.hypot(dx, dz);
      if (d < 2*R && d > 1e-4 && Math.abs(dy) < 1.2*R){
        const nx = dx/d, nz = dz/d, pen = 2*R - d;
        A.x -= nx*pen/2; A.z -= nz*pen/2; B.x += nx*pen/2; B.z += nz*pen/2;
        const rv = (B.vx - A.vx)*nx + (B.vz - A.vz)*nz;
        if (rv < 0){ const j = -(1 + this.bounce)*rv/2; A.vx -= j*nx; A.vz -= j*nz; B.vx += j*nx; B.vz += j*nz; if (-rv > 1.5) Sfx.tone(160, 110, .1, "square", Math.min(.2, -rv*.03)); }
      }
    }
  }
  get bounce(){ return 1.1; }
  rules(){}
  fell(i){ Sfx.tone(500, 120, .5, "triangle", .14); this.riders[i].wait = 1.2; }
  respawn(i){}
  frameCam(dt, pts, opt={}){
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const p of pts){ x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    if (!pts.length){ x0 = x1 = 0; z0 = z1 = 0; }
    const cx = (x0 + x1)/2, cz = (z0 + z1)/2, aspect = Math.max(.6, this.cam.aspect);
    const size = Math.max(opt.min || 10, (x1 - x0)/aspect*1.25 + 4, (z1 - z0)*1.35 + 4);
    const tp = new THREE.Vector3(cx, size*.95, cz + size*.62 + (opt.back || 0)), tl = new THREE.Vector3(cx, 0, cz - (opt.ahead || 0));
    const k = Math.min(1, dt*(opt.speed || 2.2)); this.camPos.lerp(tp, k); this.camLook.lerp(tl, k);
    this.cam.position.copy(this.camPos); this.cam.lookAt(this.camLook);
  }
  drawRiders(dt){
    const gt = this.core.gt;
    this.riders.forEach(r => {
      const vis = !r.dead && !(r.wait > 0 && r.out && r.y < -8);
      r.g.visible = vis; r.ring.visible = vis && !r.out;
      r.g.position.set(r.x, r.y + R, r.z);
      r.bud.rotation.set(r.lean.z*.35, 0, -r.lean.x*.35);
      r.bud.position.y = R - .03 + Math.abs(Math.sin(gt*6 + r.x))*.02;
      const gnd = this.groundAt(r.x, r.z);
      r.ring.position.set(r.x, (gnd ?? -50) + .02, r.z);
    });
  }
  rankAndFinish(order, title){
    const ranking = order.map(o => Array.isArray(o) ? (o.length === 1 ? o[0] : o) : o);
    const first = Array.isArray(order[0]) ? order[0] : [order[0]];
    this.core.finish(ranking, title || first.map(i => this.core.pName(i)).join(" & ") + (first.length > 1 ? " tie!" : " wins!"), order.flat().map((i, k) => `${k + 1}. ${this.core.pName(i)}`).join(" · "));
  }
  destroy(){ this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material){ (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); } }); }
}

/* ======================= Roll Rally: race laps around a floating track ======================= */
class RollRally extends TiltBase {
  constructor(core, opts){
    super(core, opts);
    this.laps = +opts.laps || 2; this.W = 5;
    // closed centerline, counterclockwise from the top of the screen
    const N = 220; this.cl = [];
    for (let i = 0; i < N; i++){ const t = Math.PI/2 + i/N*Math.PI*2; this.cl.push({x:-18*Math.cos(t) + 2.5*Math.sin(2*t), z:-10*Math.sin(t) + 2*Math.cos(3*t)}); }
    this.seg = []; let acc = 0;
    for (let i = 0; i < N; i++){ const a = this.cl[i], b = this.cl[(i + 1) % N], L = Math.hypot(b.x - a.x, b.z - a.z); this.seg.push({a, b, L, s:acc}); acc += L; }
    this.len = acc;
    this.buildTrack();
    this.riders.forEach((r, i) => { r.lap = 0; r.prog = 0; r.best = 0; r.done = false; r.ft = 0; r.si = 0; });
    this.order = [];
    this.startGrid();
  }
  get sky(){ return 0x8fd0ff; }
  buildTrack(){
    const s = this.scene, N = this.cl.length, W = this.W;
    const pos = [], idx = [], curb = [];
    for (let i = 0; i <= N; i++){
      const a = this.cl[i % N], b = this.cl[(i + 1) % N], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz), nx = -dz/L, nz = dx/L;
      pos.push(a.x + nx*W/2, 0, a.z + nz*W/2, a.x - nx*W/2, 0, a.z - nz*W/2);
      if (i < N) idx.push(2*i, 2*i + 2, 2*i + 1, 2*i + 1, 2*i + 2, 2*i + 3);
      curb.push({x:a.x + nx*W/2, z:a.z + nz*W/2, ang:Math.atan2(dx, dz), i}, {x:a.x - nx*W/2, z:a.z - nz*W/2, ang:Math.atan2(dx, dz), i});
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    const road = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({color:0x5a6b8c, roughness:.8, side:THREE.DoubleSide})); road.receiveShadow = true; s.add(road);
    const side = geo.clone(); const sm = new THREE.Mesh(side, new THREE.MeshStandardMaterial({color:0x8a6a4a, roughness:.9, side:THREE.DoubleSide})); sm.position.y = -.5; s.add(sm);
    const red = new THREE.MeshStandardMaterial({color:0xff5d73}), wht = new THREE.MeshStandardMaterial({color:0xffffff});
    const cg = new THREE.BoxGeometry(.25, .12, .6);
    curb.forEach((c, k) => { if (c.i % 2) return; const m = new THREE.Mesh(cg, (c.i/2) % 2 ? red : wht); m.position.set(c.x, .06, c.z); m.rotation.y = c.ang; s.add(m); });
    // start / finish line
    const a = this.cl[0], b = this.cl[1], ang = Math.atan2(b.x - a.x, b.z - a.z);
    const cv = document.createElement("canvas"); cv.width = 64; cv.height = 16; const x = cv.getContext("2d");
    for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++){ x.fillStyle = (i + j) % 2 ? "#111" : "#fff"; x.fillRect(i*4, j*4, 4, 4); }
    const tex = new THREE.CanvasTexture(cv); tex.magFilter = THREE.NearestFilter;
    const line = new THREE.Mesh(new THREE.PlaneGeometry(W, .8), new THREE.MeshBasicMaterial({map:tex})); line.rotation.x = -Math.PI/2; line.rotateZ(ang); line.position.set(a.x, .01, a.z); s.add(line);
    for (const sx of [-1, 1]){ const nx = -(b.z - a.z), nz = b.x - a.x, L = Math.hypot(nx, nz); const p = new THREE.Mesh(new THREE.CylinderGeometry(.08, .08, 2.4, 8), wht); p.position.set(a.x + sx*nx/L*(W/2 + .3), 1.2, a.z + sx*nz/L*(W/2 + .3)); s.add(p); }
    // floating islands around for scenery
    const isl = new THREE.MeshStandardMaterial({color:0x5aa64e, roughness:1}), dirt = new THREE.MeshStandardMaterial({color:0x8a6a4a});
    for (let i = 0; i < 9; i++){ const a2 = i/9*Math.PI*2, rr = rnd(26, 34); const top = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 1.2, 2, 10), dirt); top.position.set(Math.cos(a2)*rr, -3 + rnd(-1, 1), Math.sin(a2)*rr*.7); s.add(top); const gr = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, .3, 10), isl); gr.position.copy(top.position); gr.position.y += 1.1; s.add(gr); }
  }
  /* nearest centerline spot: distance, track position s and segment index */
  near(x, z, hint){
    let best = {d:1e9, s:0, i:0};
    const N = this.seg.length, scan = hint == null ? N : 24;
    for (let k = 0; k < scan; k++){
      const i = hint == null ? k : ((hint - 8 + k) % N + N) % N, sg = this.seg[i];
      const ex = sg.b.x - sg.a.x, ez = sg.b.z - sg.a.z; let u = ((x - sg.a.x)*ex + (z - sg.a.z)*ez)/(sg.L*sg.L); u = clamp(u, 0, 1);
      const px = sg.a.x + ex*u, pz = sg.a.z + ez*u, d = Math.hypot(x - px, z - pz);
      if (d < best.d) best = {d, s:sg.s + u*sg.L, i};
    }
    return best;
  }
  at(s){ s = ((s % this.len) + this.len) % this.len; let lo = 0, hi = this.seg.length - 1; while (lo < hi){ const m = (lo + hi + 1) >> 1; if (this.seg[m].s <= s) lo = m; else hi = m - 1; } const sg = this.seg[lo], u = (s - sg.s)/sg.L; return {x:sg.a.x + (sg.b.x - sg.a.x)*u, z:sg.a.z + (sg.b.z - sg.a.z)*u, dx:(sg.b.x - sg.a.x)/sg.L, dz:(sg.b.z - sg.a.z)/sg.L}; }
  groundAt(x, z){ return this.near(x, z).d <= this.W/2 ? 0 : null; }
  startGrid(){
    this.riders.forEach((r, i) => { const p = this.at(this.len - 1.5 - Math.floor(i/2)*1.4), nx = -p.dz, nz = p.dx, off = (i % 2 ? -1 : 1)*1.1; this.place(r, p.x + nx*off, p.z + nz*off); r.si = this.near(r.x, r.z).i; r.prog = -1.5; r.best = r.prog; });
  }
  rules(){
    this.riders.forEach((r, i) => {
      if (r.done || r.out || r.wait > 0) return;
      const nr = this.near(r.x, r.z, r.si); r.si = nr.i;
      // progress along the loop, unwrapped
      let lapS = r.prog - r.lap*this.len, ds = nr.s - ((lapS % this.len) + this.len) % this.len;
      if (ds < -this.len/2) ds += this.len; if (ds > this.len/2) ds -= this.len;
      if (Math.abs(ds) < 6){ r.prog += ds; }
      if (r.prog > r.best) r.best = r.prog;
      const lapNow = Math.floor(r.best/this.len);
      if (lapNow > r.lap){ r.lap = lapNow; if (r.lap >= this.laps){ r.done = true; r.ft = this.time; this.order.push(i); this.core.banner(-1, `${esc(this.core.pName(i))} finishes ${["1st", "2nd", "3rd", "4th"][this.order.length - 1]}!`, 1.4); Sfx.chime(true); if (!this.core.pBot(i)) this.core.pSeat(i).pt++; } else if (!this.core.pBot(i)) this.core.feedback(0, `${esc(this.core.pName(i))}: final lap!`, this.core.pSeat(i).col, 1.2); }
    });
    const left = this.riders.filter(r => !r.done).length;
    if (left === 0 || (this.order.length && left <= 1 && this.n > 1 && this.time > this.riders[this.order[0]].ft + 8) || this.time > 150){
      const rest = this.riders.map((r, i) => i).filter(i => !this.riders[i].done).sort((a, b) => this.riders[b].best - this.riders[a].best);
      this.final = [...this.order, ...rest]; this.phase = "end"; this.t = 1.6;
    }
  }
  finish(){ this.rankAndFinish(this.final); }
  fell(i){ super.fell(i); }
  respawn(i){ const r = this.riders[i], p = this.at(r.best - 1); this.place(r, p.x, p.z); r.si = this.near(r.x, r.z).i; r.prog = r.best - 1; }
  ai(slot){
    const r = this.riders[slot], look = 3.2 + Math.hypot(r.vx, r.vz)*.45, p = this.at(r.best + look);
    let dx = p.x - r.x, dz = p.z - r.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    r.wob = (r.wob || 0) + rnd(-.2, .2); r.wob *= .98;
    const sk = .78 + slot*.03;
    return {x:clamp((dx*sk - r.vx*.12) + r.wob*.1, -1, 1), y:clamp(-(dz*sk - r.vz*.12), -1, 1)};
  }
  padState(slot){
    const r = this.riders[slot], place = this.placeOf(slot);
    const sub = `Lap ${Math.min(this.laps, r.lap + 1)} of ${this.laps} · ${["1st", "2nd", "3rd", "4th"][place]}`;
    if (this.phase === "countdown") return {msg:"Get ready", sub:"Tilt the phone to roll, tap Jump to hop"};
    if (r.done) return {msg:"Finished!", sub:["1st", "2nd", "3rd", "4th"][this.order.indexOf(slot)] + " place"};
    if (r.out) return {msg:"Splash!", sub:"Back on the track in a moment"};
    return {msg:"Roll!", sub};
  }
  placeOf(slot){ const arr = this.riders.map((r, i) => i).sort((a, b) => { const A = this.riders[a], B = this.riders[b]; if (A.done !== B.done) return A.done ? -1 : 1; if (A.done) return this.order.indexOf(a) - this.order.indexOf(b); return B.best - A.best; }); return arr.indexOf(slot); }
  draw(dt){
    const core = this.core;
    this.drawRiders(dt);
    const act = this.riders.filter(r => !r.dead && !(r.out && r.wait > 0));
    const pts = (act.length ? act : this.riders).map(r => ({x:r.x, z:r.z}));
    const lead = Math.max(...this.riders.map(r => r.best)); if (isFinite(lead)){ const p = this.at(lead + 7); pts.push({x:p.x, z:p.z}); }
    this.frameCam(dt, pts, {min:13});
    const rows = this.riders.map((r, i) => i).sort((a, b) => this.placeOf(a) - this.placeOf(b)).map((i, k) => `<div style="color:${core.pSeat(i).col}">${k + 1}. ${esc(core.pName(i))} <span class="mute">${this.riders[i].done ? "done" : "lap " + Math.min(this.laps, this.riders[i].lap + 1) + "/" + this.laps}</span></div>`);
    core.hudSet(0, "sb", `<div style="text-align:left;font-size:clamp(.75rem,1.4vw,1.05rem)">${rows.join("")}</div>`);
    const anyHuman = core.playing.some((_, i) => !core.pBot(i));
    core.hudSet(0, "tip", this.phase === "countdown" && anyHuman ? "Tilt your phone to roll, tap Jump to hop. Don't roll off the edge!" : "");
    core.renderViews(this.scene, [this.cam]);
  }
}

/* ======================= Bump Ring: knock everyone else off a shrinking platform ======================= */
class BumpRing extends TiltBase {
  constructor(core, opts){
    super(core, opts);
    this.lives = +opts.lives || 1; this.R0 = 7.5; this.Ra = this.R0;
    this.buildArena();
    this.outOrder = [];
    this.riders.forEach((r, i) => { r.lives = this.lives; r.inv = 0; });
    this.startSpots();
  }
  get sky(){ return 0xffb38a; }
  get bounce(){ return 1.45; }
  buildArena(){
    const s = this.scene;
    this.disc = new THREE.Mesh(new THREE.CylinderGeometry(1, .82, 1.2, 48), new THREE.MeshStandardMaterial({color:0x6c7bd9, roughness:.7})); this.disc.position.y = -.6; this.disc.receiveShadow = true; s.add(this.disc);
    const cv = document.createElement("canvas"); cv.width = cv.height = 256; const x = cv.getContext("2d");
    x.fillStyle = "#6c7bd9"; x.fillRect(0, 0, 256, 256); x.strokeStyle = "#ffffff"; x.lineWidth = 6;
    for (const rr of [40, 80, 120]){ x.beginPath(); x.arc(128, 128, rr, 0, Math.PI*2); x.stroke(); }
    x.fillStyle = "#ffd23f"; x.beginPath(); x.arc(128, 128, 14, 0, Math.PI*2); x.fill();
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    this.top = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshStandardMaterial({map:tex, roughness:.6})); this.top.rotation.x = -Math.PI/2; this.top.position.y = .002; this.top.receiveShadow = true; s.add(this.top);
    this.edge = new THREE.Mesh(new THREE.TorusGeometry(1, .02, 6, 64), new THREE.MeshBasicMaterial({color:0xff5d73})); this.edge.rotation.x = Math.PI/2; s.add(this.edge);
    this.setSize();
  }
  setSize(){ const a = this.Ra; this.disc.scale.set(a, 1, a); this.top.scale.set(a, a, 1); this.edge.scale.set(a, a, 1); this.edge.position.y = .03; }
  groundAt(x, z){ return Math.hypot(x, z) <= this.Ra ? 0 : null; }
  startSpots(){ this.riders.forEach((r, i) => { const a = i/this.n*Math.PI*2 + Math.PI/4; this.place(r, Math.cos(a)*this.Ra*.55, Math.sin(a)*this.Ra*.55); }); }
  moveWorld(dt){ if (this.phase === "play" && this.time > 15 && this.Ra > 2.6){ this.Ra = Math.max(2.6, this.Ra - .16*dt); this.setSize(); } }
  rules(){
    const alive = this.riders.map((r, i) => i).filter(i => !this.riders[i].dead);
    if (alive.length <= 1 || this.time > 120){
      const rest = alive.sort((a, b) => this.riders[b].lives - this.riders[a].lives || Math.hypot(this.riders[a].x, this.riders[a].z) - Math.hypot(this.riders[b].x, this.riders[b].z));
      this.final = [...rest, ...this.outOrder.slice().reverse()];
      this.phase = "end"; this.t = 1.8;
      if (rest.length) this.core.banner(-1, `${esc(this.core.pName(rest[0]))} rules the ring!`, 1.6);
    }
  }
  fell(i){
    const r = this.riders[i]; Sfx.tone(500, 120, .5, "triangle", .14);
    r.lives--;
    if (r.lives <= 0){ r.dead = true; this.outOrder.push(i); this.core.banner(-1, `${esc(this.core.pName(i))} is out!`, 1.2); }
    else { r.wait = 1.3; this.core.feedback(0, `${esc(this.core.pName(i))}: ${r.lives} ${r.lives === 1 ? "life" : "lives"} left`, this.core.pSeat(i).col, 1.2); }
  }
  respawn(i){ const r = this.riders[i], a = Math.random()*Math.PI*2; this.place(r, Math.cos(a)*1.2, Math.sin(a)*1.2); r.y = 4; r.vy = 0; }
  finish(){ this.rankAndFinish(this.final); }
  ai(slot){
    const r = this.riders[slot], d0 = Math.hypot(r.x, r.z);
    let tgt = null, bd = 1e9;
    this.riders.forEach((o, j) => { if (j === slot || o.dead || o.out || o.wait > 0) return; const d = Math.hypot(o.x - r.x, o.z - r.z); if (d < bd){ bd = d; tgt = o; } });
    let dx = 0, dz = 0;
    if (tgt){ dx = tgt.x - r.x; dz = tgt.z - r.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d; }
    if (d0 > this.Ra - 2.4){ const w = (d0 - (this.Ra - 2.4))*.9; dx -= r.x/d0*w; dz -= r.z/d0*w; }
    dx -= r.vx*.1; dz -= r.vz*.1;
    if (tgt && bd < 2.2 && Math.random() < .004) this.swing(slot);
    const m = Math.hypot(dx, dz) || 1, k = Math.min(1, m)*.85/m;
    return {x:clamp(dx*k, -1, 1), y:clamp(-dz*k, -1, 1)};
  }
  padState(slot){
    const r = this.riders[slot];
    if (this.phase === "countdown") return {msg:"Get ready", sub:"Tilt to roll, bump others off, tap Jump to dodge"};
    if (r.dead) return {msg:"Knocked out", sub:"Watch the rest"};
    if (r.out) return {msg:"Splash!", sub:`${r.lives} ${r.lives === 1 ? "life" : "lives"} left`};
    return {msg:"Bump them off!", sub:this.lives > 1 ? `${r.lives} ${r.lives === 1 ? "life" : "lives"} left` : "Last one on wins"};
  }
  draw(dt){
    const core = this.core;
    this.drawRiders(dt);
    this.frameCam(dt, [{x:-this.Ra, z:-this.Ra}, {x:this.Ra, z:this.Ra}], {min:this.Ra*2 + 3, speed:1.5});
    const rows = this.riders.map((r, i) => `<span style="color:${core.pSeat(i).col};margin:0 8px">${esc(core.pName(i))} ${r.dead ? "<span class='mute'>out</span>" : this.lives > 1 ? "♥".repeat(r.lives) : ""}</span>`);
    core.hudSet(0, "sb", rows.join(""));
    const anyHuman = core.playing.some((_, i) => !core.pBot(i));
    core.hudSet(0, "tip", this.phase === "countdown" && anyHuman ? "Tilt to roll into the others and knock them off. The ring shrinks!" : (this.time > 15 && this.Ra > 2.7 && this.phase === "play" ? "The ring is shrinking!" : ""));
    core.renderViews(this.scene, [this.cam]);
  }
}

/* ======================= Wobble Run: an obstacle course into the distance ======================= */
const PLAT = [ // static platforms: x0, x1, z0 (near), z1 (far)
  [-4, 4, 3, -10], [-4, 4, -10, -24],
  [-1.1, 1.1, -24, -28], [-1.1, 3.4, -28, -30.2], [1.2, 3.4, -30.2, -34], [-2.2, 3.4, -34, -36.2], [-2.2, 0, -36.2, -38.5],
  [-4, 4, -38.5, -50],
  [-3, 3, -50, -54], [-3, 3, -56.4, -59], [-3, 3, -61.4, -64.5],
  [-4, 4, -81, -95]
];
const MOVERS = [ // moving platforms: x half width, z0, z1, amplitude, period, phase
  {w:1.6, z0:-65.3, z1:-69.3, amp:2.4, per:3.4, ph:0}, {w:1.6, z0:-70.1, z1:-74.1, amp:2.4, per:3.4, ph:Math.PI}, {w:1.6, z0:-74.9, z1:-80.2, amp:2.4, per:3.4, ph:0}
];
const POSTS = [[-2, -14], [1.5, -16.5], [-.5, -19], [2.6, -21], [-2.8, -21.5]];
const CHECK = [0, -24, -38.5, -50, -64.5, -81], SPAWN = [1, -25.2, -39.7, -51.2, -63.3, -82.2];
const FINISH = -92;
class WobbleRun extends TiltBase {
  constructor(core, opts){
    super(core, opts);
    this.limit = +opts.limit || 90;
    this.buildCourse();
    this.order = [];
    this.riders.forEach((r, i) => { r.cp = 0; r.best = 0; r.done = false; });
    this.riders.forEach((r, i) => this.place(r, (i - (this.n - 1)/2)*1.3, 1));
    this.mt = 0;
  }
  get sky(){ return 0xa8e0ff; }
  get bounce(){ return 1.15; }
  buildCourse(){
    const s = this.scene, cols = [0x6cd47a, 0xffd23f, 0x6c9bff, 0xff8fb1];
    PLAT.forEach((p, k) => { const [x0, x1, z0, z1] = p; const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, .6, z0 - z1), new THREE.MeshStandardMaterial({color:cols[k % 4], roughness:.7})); m.position.set((x0 + x1)/2, -.3, (z0 + z1)/2); m.receiveShadow = true; s.add(m); });
    this.movers = MOVERS.map(mv => { const m = new THREE.Mesh(new THREE.BoxGeometry(mv.w*2, .5, mv.z0 - mv.z1), new THREE.MeshStandardMaterial({color:0xff9f43, roughness:.6})); m.receiveShadow = true; m.castShadow = true; s.add(m); return m; });
    const postMat = new THREE.MeshStandardMaterial({color:0xff5d73, roughness:.4});
    for (const [x, z] of POSTS){ const m = new THREE.Mesh(new THREE.CylinderGeometry(.5, .5, 1, 16), postMat); m.position.set(x, .5, z); m.castShadow = true; s.add(m); const cap = new THREE.Mesh(new THREE.SphereGeometry(.5, 16, 8, 0, Math.PI*2, 0, Math.PI/2), new THREE.MeshStandardMaterial({color:0xffffff})); cap.position.set(x, 1, z); s.add(cap); }
    // sweeper
    this.sweep = new THREE.Group(); this.sweep.position.set(0, 0, -44.2); s.add(this.sweep);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(.5, .6, 1.1, 16), new THREE.MeshStandardMaterial({color:0x333a55})); hub.position.y = .55; hub.castShadow = true; this.sweep.add(hub);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(7.2, .35, .35), new THREE.MeshStandardMaterial({color:0xff5d73})); arm.position.y = .55; arm.castShadow = true; this.sweep.add(arm);
    // checkpoint flags and finish arch
    const fl = new THREE.MeshStandardMaterial({color:0xffffff});
    CHECK.slice(1).forEach(z => { for (const sx of [-1, 1]){ const p = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, 1.6, 6), fl); p.position.set(sx*(z === -24 || z === -38.5 ? 1.4 : 3.6), .8, z); s.add(p); } });
    const arch = new THREE.MeshStandardMaterial({color:0xffd23f});
    for (const sx of [-1, 1]){ const p = new THREE.Mesh(new THREE.BoxGeometry(.4, 3.2, .4), arch); p.position.set(sx*3.8, 1.6, FINISH); p.castShadow = true; s.add(p); }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(8, .6, .4), arch); bar.position.set(0, 3.2, FINISH); s.add(bar);
    const cv = document.createElement("canvas"); cv.width = 64; cv.height = 16; const x = cv.getContext("2d");
    for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++){ x.fillStyle = (i + j) % 2 ? "#111" : "#fff"; x.fillRect(i*4, j*4, 4, 4); }
    const tex = new THREE.CanvasTexture(cv); tex.magFilter = THREE.NearestFilter;
    const line = new THREE.Mesh(new THREE.PlaneGeometry(8, .8), new THREE.MeshBasicMaterial({map:tex})); line.rotation.x = -Math.PI/2; line.position.set(0, .01, FINISH); s.add(line);
  }
  moverX(k){ const m = MOVERS[k]; return Math.sin(this.mt*Math.PI*2/m.per + m.ph)*m.amp; }
  moveWorld(dt){ this.mt += dt; this.sweepA = (this.sweepA || 0) + dt*1.5; }
  groundAt(x, z){
    for (const [x0, x1, z0, z1] of PLAT) if (x >= x0 && x <= x1 && z <= z0 && z >= z1) return 0;
    for (let k = 0; k < MOVERS.length; k++){ const m = MOVERS[k], cx = this.moverX(k); if (Math.abs(x - cx) <= m.w && z <= m.z0 && z >= m.z1) return 0; }
    return null;
  }
  carry(x, z){
    for (let k = 0; k < MOVERS.length; k++){ const m = MOVERS[k], cx = this.moverX(k); if (Math.abs(x - cx) <= m.w && z <= m.z0 && z >= m.z1){ const w = Math.PI*2/m.per; return {x:Math.cos(this.mt*w + m.ph)*m.amp*w, z:0}; } }
    return null;
  }
  collide(r){
    if (r.y > 1.1) return;
    for (const [px, pz, pr] of POSTS.concat([[0, -44.2, .6]])){ const rad = (pr || .5) + R, dx = r.x - px, dz = r.z - pz, d = Math.hypot(dx, dz); if (d < rad && d > 1e-4){ const nx = dx/d, nz = dz/d, vn = r.vx*nx + r.vz*nz; r.x = px + nx*rad; r.z = pz + nz*rad; if (vn < 0){ r.vx -= (pr ? 1.6 : 2.3)*vn*nx; r.vz -= (pr ? 1.6 : 2.3)*vn*nz; if (!pr) Sfx.tone(700, 400, .08, "sine", .12); } } }
    // sweeper arm: a spinning segment from the hub
    const a = this.sweepA || 0, cx = 0, cz = -44.2, ex = Math.cos(a), ez = -Math.sin(a);
    const dx = r.x - cx, dz = r.z - cz, u = clamp(dx*ex + dz*ez, -3.6, 3.6), px = cx + ex*u, pz = cz + ez*u, d = Math.hypot(r.x - px, r.z - pz);
    if (d < R + .2 && r.y < .9){
      const nx = (r.x - px)/(d || 1), nz = (r.z - pz)/(d || 1), tv = 1.5*u; // arm speed at that point
      r.x = px + nx*(R + .2); r.z = pz + nz*(R + .2);
      const push = Math.abs(tv) + 3; r.vx += nx*push; r.vz += nz*push; r.vy = Math.max(r.vy, 2.5); Sfx.tone(240, 140, .12, "square", .15);
    }
  }
  rules(){
    this.riders.forEach((r, i) => {
      if (r.done || r.out || r.wait > 0) return;
      if (-r.z > r.best) r.best = -r.z;
      while (r.cp + 1 < CHECK.length && r.z < CHECK[r.cp + 1]){ r.cp++; if (!this.core.pBot(i)) this.core.feedback(0, `${esc(this.core.pName(i))}: checkpoint!`, this.core.pSeat(i).col, 1); }
      if (r.z < FINISH){ r.done = true; this.order.push(i); this.core.banner(-1, `${esc(this.core.pName(i))} made it ${["1st", "2nd", "3rd", "4th"][this.order.length - 1]}!`, 1.4); Sfx.chime(true); if (!this.core.pBot(i)) this.core.pSeat(i).pt++; }
    });
    const left = this.riders.filter(r => !r.done).length;
    if (left === 0 || this.time > this.limit){
      const rest = this.riders.map((r, i) => i).filter(i => !this.riders[i].done).sort((a, b) => this.riders[b].best - this.riders[a].best);
      this.final = [...this.order, ...rest]; this.phase = "end"; this.t = 1.6;
      if (left > 0) this.core.banner(-1, "Time!", 1.2);
    }
  }
  respawn(i){ const r = this.riders[i], z = SPAWN[r.cp]; let x = 0; if (r.cp === 0) x = (i - (this.n - 1)/2)*1.3; this.place(r, x, z); }
  finish(){ this.rankAndFinish(this.final); }
  ai(slot){
    const r = this.riders[slot]; r.ai = r.ai || {wait:0, jitter:rnd(-.3, .3)};
    let tx = 0, tz = r.z - 4;
    if (r.z > -24) tx = r.z < -11 && r.z > -23 ? (r.ai.jitter > 0 ? .6 : -1.2) : 0;
    else if (r.z > -38.5){ // zigzag bridge
      if (r.z > -28.6) tx = 0; else if (r.z > -30.6) tx = 2.3; else if (r.z > -34.6) tx = 2.3; else if (r.z > -36.6) tx = -1.1; else tx = -1.1;
      tz = r.z - 1.6;
    } else if (r.z > -50){ tx = 3.2*Math.sign(r.ai.jitter || 1); }
    else if (r.z > -64.5){ tx = 0; const gaps = [-54, -59]; for (const gz of gaps) if (r.z < gz + 1.6 && r.z > gz && r.y < .05) this.swing(slot); }
    else if (r.z > -81){ // movers: wait for the next platform to line up, then hop
      let k = r.z > -69.3 ? 0 : r.z > -74.1 ? 1 : 2; if (r.z > -65.3) k = -1;
      const nextK = k + 1;
      if (nextK < MOVERS.length){ const nx = this.moverX(nextK); tx = k < 0 ? 0 : this.moverX(k); const edge = k < 0 ? -64.5 : MOVERS[k].z1; tz = r.z - .3;
        if (Math.abs(nx - r.x) < .8){ tx = nx; tz = r.z - 3; if (r.z < edge + 1.2 && r.y < .05) this.swing(slot); } }
      else { tx = this.moverX(k); tz = r.z - 3; if (r.z < MOVERS[k].z1 + 1.2 && r.y < .05) this.swing(slot); }
    }
    let dx = tx - r.x, dz = tz - r.z; dx -= r.vx*.35; dz -= r.vz*.18;
    const m = Math.hypot(dx, dz) || 1, k2 = Math.min(1, m*.6)/m;
    return {x:clamp(dx*k2, -1, 1), y:clamp(-dz*k2*(.75 + slot*.04), -1, 1)};
  }
  padState(slot){
    const r = this.riders[slot];
    if (this.phase === "countdown") return {msg:"Get ready", sub:"Tilt to roll, tap Jump over gaps"};
    if (r.done) return {msg:"Made it!", sub:["1st", "2nd", "3rd", "4th"][this.order.indexOf(slot)] + " place"};
    if (r.out) return {msg:"Splash!", sub:"Back to the last checkpoint"};
    return {msg:"Keep rolling!", sub:`Checkpoint ${r.cp} of ${CHECK.length - 1} · ${Math.max(0, Math.ceil(this.limit - this.time))} s left`};
  }
  draw(dt){
    const core = this.core;
    this.movers.forEach((m, k) => { const mv = MOVERS[k]; m.position.set(this.moverX(k), -.25, (mv.z0 + mv.z1)/2); });
    this.sweep.rotation.y = this.sweepA || 0;
    this.drawRiders(dt);
    const act = this.riders.filter(r => !r.dead && !r.done && !(r.out && r.wait > 0));
    const lead = act.length ? Math.min(...act.map(r => r.z)) : FINISH;
    this.frameCam(dt, act.length ? act.map(r => ({x:r.x, z:Math.max(r.z, lead + 6)})).concat([{x:0, z:lead - 5}]) : [{x:0, z:FINISH}], {min:11, back:2});
    const rows = this.riders.map((r, i) => `<span style="color:${core.pSeat(i).col};margin:0 8px">${esc(core.pName(i))} <span class="mute">${r.done ? "done" : Math.round(Math.min(100, r.best/-FINISH*100)) + "%"}</span></span>`);
    core.hudSet(0, "sb", rows.join("") + (this.phase === "play" ? `<span class="mute" style="margin-left:10px">${Math.max(0, Math.ceil(this.limit - this.time))}s</span>` : ""));
    const anyHuman = core.playing.some((_, i) => !core.pBot(i));
    core.hudSet(0, "tip", this.phase === "countdown" && anyHuman ? "Tilt to roll, tap Jump to clear gaps. Falling sends you back to the last checkpoint." : "");
    core.renderViews(this.scene, [this.cam]);
  }
}

const PAD = "Hold the phone flat in front of you and tap Recenter. Tilt it to roll, tap Jump to hop.";
registerGame({
  id:"rally", name:"Roll Rally", icon:"🏁", tag:"Up to 4 · tilt race", min:1, max:4, fill:4, padMode:"tilt",
  options:[{key:"laps", label:"Laps", values:[2, 3, 1]}],
  howto:"Everyone balances on a ball. Tilt your phone to roll: tip it away to go up the screen, toward you to go down, and left or right to steer. Tap Jump to hop. Stay on the floating track; fall off and you're put back a little behind. First to finish the laps wins. No motion? Drag the stick on the phone instead.",
  pad:PAD, season:{laps:1}, seasonRules:"One lap, first across the line wins",
  create(core, opts){ return new RollRally(core, opts); }
});
registerGame({
  id:"bump", name:"Bump Ring", icon:"🟣", tag:"Up to 4 · push-off", min:2, max:4, fill:4, padMode:"tilt",
  options:[{key:"lives", label:"Lives", values:[1, 3, 2]}],
  howto:"Roll your ball into the others to knock them off the ring. Tilt the phone to roll and tap Jump to dodge. After a while the ring starts shrinking. The last one standing wins. No motion? Drag the stick on the phone instead.",
  pad:PAD, season:{lives:1}, seasonRules:"Last one on the ring wins",
  create(core, opts){ return new BumpRing(core, opts); }
});
registerGame({
  id:"wobble", name:"Wobble Run", icon:"🧗", tag:"Up to 4 · obstacle course", min:1, max:4, fill:4, padMode:"tilt",
  options:[{key:"limit", label:"Time limit (s)", values:[90, 120, 60]}],
  howto:"Roll your ball through bumpers, a zigzag bridge, a spinning sweeper, gaps and moving platforms. Tilt to roll, tap Jump to clear gaps. Fall and you go back to the last checkpoint. First to the finish arch wins; when time runs out, whoever got furthest ranks higher. No motion? Drag the stick on the phone instead.",
  pad:PAD, season:{limit:60}, seasonRules:"60 seconds, first to the finish wins",
  create(core, opts){ return new WobbleRun(core, opts); }
});
})();
