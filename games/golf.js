/* Pocket Sports: Mini Golf. Turn based, up to 4 players. Twist to aim, swing gently like a putt. */
(function(){
"use strict";
const BR = .03, CUP = .065, FRIC = 1.05, E = .72, MAXS = 6, VMAX = 6;
const rnd = (a, b) => a + Math.random()*(b - a);

/* holes: outline polygon (x,z), tee, cup, par, obstacles (polygons), slopes, waypoints for aim help */
const box = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const post = (x, z, r) => Array.from({length:8}, (_, i) => [x + Math.cos(i*Math.PI/4 + Math.PI/8)*r, z + Math.sin(i*Math.PI/4 + Math.PI/8)*r]);
const HOLES = [
  {name:"Warm-up", par:2, outline:box(-1, 0, 1, -9), tee:[0, -.7], cup:[0, -8], obs:[box(-.3, -4.2, .3, -4.6)], way:[[.62, -4.4]]},
  {name:"Dogleg", par:3, outline:[[-.9, 0], [.9, 0], [.9, -5.2], [4.6, -5.2], [4.6, -7.2], [-.9, -7.2]], tee:[0, -.7], cup:[3.8, -6.2], way:[[0, -6.2]]},
  {name:"The Hump", par:2, outline:box(-1.1, 0, 1.1, -11), tee:[0, -.7], cup:[0, -10], slopes:[{x:0, z:-5.5, r:1.5, k:-1.9}]},
  {name:"Pinball", par:2, outline:box(-1.5, 0, 1.5, -10), tee:[0, -.7], cup:[.6, -9], obs:[post(-.7, -4, .22), post(.7, -4, .22), post(0, -6.5, .25)]},
  {name:"Sweeper", par:2, outline:box(-1, 0, 1, -10), tee:[0, -.7], cup:[0, -9], gate:{w:.9, z0:-5.2, z1:-4.8, amp:.55, per:3.2}},
  {name:"U-Turn", par:3, outline:[[-1, 0], [1, 0], [1, -6], [2, -6], [2, 0], [4, 0], [4, -8], [-1, -8]], tee:[0, -.7], cup:[3, -1], way:[[0, -7], [3, -7]], slopes:[{x:3, z:-1, r:.8, k:.9}]},
  {name:"Funnel", par:2, outline:[[-2, 0], [2, 0], [2, -4], [.6, -8], [.6, -11], [-.6, -11], [-.6, -8], [-2, -4]], tee:[0, -.7], cup:[0, -10.2], slopes:[{x:0, z:-3, r:2, k:.5}]}
];

function segs(poly){ const out = []; for (let i = 0; i < poly.length; i++){ const a = poly[i], b = poly[(i + 1) % poly.length]; out.push([a[0], a[1], b[0], b[1]]); } return out; }
function inside(poly, x, z){ let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++){ const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi)*(z - zi)/(zj - zi) + xi) c = !c; } return c; }
function segHit(ax, az, bx, bz, s){ // does segment a-b cross wall segment s
  const [cx, cz, dx, dz] = s, d = (bx - ax)*(dz - cz) - (bz - az)*(dx - cx); if (Math.abs(d) < 1e-9) return false;
  const u = ((cx - ax)*(dz - cz) - (cz - az)*(dx - cx))/d, v = ((cx - ax)*(bz - az) - (cz - az)*(bx - ax))/d;
  return u > 1e-4 && u < 1 - 1e-4 && v >= 0 && v <= 1;
}

class Golf {
  constructor(core, opts){
    this.core = core; this.views = 1; this.n = core.playing.length;
    const nh = +opts.holes || 3;
    const order = HOLES.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--){ const j = Math.floor(Math.random()*(i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    this.holes = nh >= HOLES.length ? HOLES.map((_, i) => i) : order.slice(0, nh);
    const scene = this.scene = new THREE.Scene();
    const sun = core.makeRoom(scene, {sky:0x87c6e8, fogNear:30, fogFar:70, shadow:8});
    sun.position.set(3, 12, 2); this.sun = sun;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({color:0x5a9e4b, roughness:1})); ground.rotation.x = -Math.PI/2; ground.position.y = -.12; ground.receiveShadow = true; scene.add(ground);
    this.decor();
    this.cam = new THREE.PerspectiveCamera(52, 1, .05, 150);
    this.camPos = new THREE.Vector3(0, 6, 5); this.camLook = new THREE.Vector3(0, 0, -4);
    const ballGeo = new THREE.SphereGeometry(BR*1.5, 20, 14);
    this.balls = core.playing.map((_, i) => {
      const m = new THREE.Mesh(ballGeo, new THREE.MeshStandardMaterial({color:core.pSeat(i).col, roughness:.3})); m.castShadow = true; scene.add(m);
      return {x:0, z:0, vx:0, vz:0, holed:false, done:false, strokes:0, mesh:m, drop:0, lastX:0, lastZ:0};
    });
    this.buddies = core.playing.map((_, i) => { const b = core.makeBuddy(core.pSeat(i).col); b.visible = false; scene.add(b); return b; });
    this.putter = this.makePutter(); scene.add(this.putter);
    this.arrow = new THREE.Mesh(new THREE.PlaneGeometry(.04, 1.6), new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:.7, depthWrite:false}));
    this.arrow.rotation.x = -Math.PI/2; scene.add(this.arrow);
    this.sc = core.playing.map(() => []);
    this.hi = 0; this.phase = "idle"; this.t = 0; this.turn = -1; this.msg = ""; this.swingT = -9;
  }
  decor(){
    const s = this.scene, leaf = new THREE.MeshStandardMaterial({color:0x2e7d3a, roughness:.9}), trunk = new THREE.MeshStandardMaterial({color:0x6b4a2f});
    const flower = [0xff7aa8, 0xffd23f, 0xffffff, 0xb48cff].map(c => new THREE.MeshStandardMaterial({color:c, roughness:.6}));
    for (let i = 0; i < 26; i++){
      const a = i/26*Math.PI*2, r = 14 + (i % 4)*3, x = Math.cos(a)*r, z = -5 + Math.sin(a)*r;
      const t = new THREE.Mesh(new THREE.CylinderGeometry(.15, .22, 1.6, 8), trunk); t.position.set(x, .7, z); s.add(t);
      const c = new THREE.Mesh(new THREE.SphereGeometry(1.2 + (i % 3)*.3, 12, 10), leaf); c.position.set(x, 2.4, z); c.castShadow = true; s.add(c);
    }
    for (let i = 0; i < 60; i++){ const f = new THREE.Mesh(new THREE.SphereGeometry(.07, 6, 5), flower[i % 4]); const a = Math.random()*Math.PI*2, r = rnd(6, 12); f.position.set(Math.cos(a)*r, -.06, -5 + Math.sin(a)*r); s.add(f); }
  }
  makePutter(){
    const g = new THREE.Group(), dark = new THREE.MeshStandardMaterial({color:0x2b2b3a, roughness:.4, metalness:.4});
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.008, .008, .85, 8), dark); shaft.position.y = .43; g.add(shaft);
    const head = new THREE.Mesh(new THREE.BoxGeometry(.11, .03, .035), new THREE.MeshStandardMaterial({color:0xc0c6d8, roughness:.3, metalness:.7})); head.position.set(.04, .015, 0); head.castShadow = true; g.add(head);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(.013, .013, .2, 8), new THREE.MeshStandardMaterial({color:0xff5d73})); grip.position.y = .78; g.add(grip);
    return g;
  }
  buildHole(){
    if (this.hole){ this.scene.remove(this.hole); this.hole.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
    const H = this.H = HOLES[this.holes[this.hi]], g = this.hole = new THREE.Group(); this.scene.add(g);
    const shape = pts => { const sh = new THREE.Shape(); pts.forEach(([x, z], i) => i ? sh.lineTo(x, -z) : sh.moveTo(x, -z)); sh.closePath(); return sh; };
    const green = new THREE.Mesh(new THREE.ShapeGeometry(shape(H.outline)), new THREE.MeshStandardMaterial({color:0x37b45a, roughness:.95}));
    green.rotation.x = -Math.PI/2; green.receiveShadow = true; g.add(green);
    const under = new THREE.Mesh(new THREE.ExtrudeGeometry(shape(H.outline), {depth:.12, bevelEnabled:false}), new THREE.MeshStandardMaterial({color:0x7a5a3a, roughness:.9}));
    under.rotation.x = Math.PI/2; under.position.y = -.001; g.add(under);
    // walls along the outline
    const wallMat = new THREE.MeshStandardMaterial({color:0xf2f2f2, roughness:.6}), capMat = new THREE.MeshStandardMaterial({color:0xff5d73, roughness:.5});
    this.walls = segs(H.outline);
    const addWall = ([x0, z0, x1, z1], mat) => { const L = Math.hypot(x1 - x0, z1 - z0); const w = new THREE.Mesh(new THREE.BoxGeometry(L + .08, .09, .08), mat); w.position.set((x0 + x1)/2, .045, (z0 + z1)/2); w.rotation.y = -Math.atan2(z1 - z0, x1 - x0); w.castShadow = true; g.add(w); };
    for (const s of this.walls) addWall(s, wallMat);
    for (const o of H.obs || []){
      const m = new THREE.Mesh(new THREE.ExtrudeGeometry(shape(o), {depth:.12, bevelEnabled:false}), capMat); m.rotation.x = -Math.PI/2; m.castShadow = true; g.add(m);
      this.walls.push(...segs(o));
    }
    if (H.gate){ this.gateMesh = new THREE.Mesh(new THREE.BoxGeometry(H.gate.w, .14, Math.abs(H.gate.z0 - H.gate.z1)), new THREE.MeshStandardMaterial({color:0x3e7bff, roughness:.4})); this.gateMesh.castShadow = true; g.add(this.gateMesh); } else this.gateMesh = null;
    // slopes drawn as rings of little chevrons pointing downhill
    const chev = new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:.35, depthWrite:false});
    for (const sl of H.slopes || []){
      const disc = new THREE.Mesh(new THREE.CircleGeometry(sl.r, 32), new THREE.MeshStandardMaterial({color:sl.k < 0 ? 0x4cc76a : 0x2f9c4f, roughness:.95}));
      disc.rotation.x = -Math.PI/2; disc.position.set(sl.x, .002, sl.z); g.add(disc);
      for (let i = 0; i < 10; i++){ const a = i/10*Math.PI*2, r = sl.r*.62, out = sl.k < 0 ? 1 : -1, dx = Math.cos(a)*out, dz = Math.sin(a)*out;
        const w = new THREE.Group(); w.position.set(sl.x + Math.cos(a)*r, .012, sl.z + Math.sin(a)*r); w.rotation.y = Math.atan2(-dx, -dz);
        const c = new THREE.Mesh(new THREE.ConeGeometry(.06, .14, 3), chev); c.rotation.x = -Math.PI/2; c.scale.z = .2; w.add(c); g.add(w); }
    }
    // cup and flag
    const cup = new THREE.Mesh(new THREE.CircleGeometry(CUP, 24), new THREE.MeshBasicMaterial({color:0x0a0a0a})); cup.rotation.x = -Math.PI/2; cup.position.set(H.cup[0], .003, H.cup[1]); g.add(cup);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.008, .008, 1, 6), new THREE.MeshStandardMaterial({color:0xffffff})); pole.position.set(H.cup[0], .5, H.cup[1]); g.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(.28, .18), new THREE.MeshStandardMaterial({color:0xffd23f, side:THREE.DoubleSide})); flag.position.set(H.cup[0] + .14, .9, H.cup[1]); g.add(flag); this.flag = flag;
    const tee = new THREE.Mesh(new THREE.PlaneGeometry(.5, .3), new THREE.MeshStandardMaterial({color:0x2a8a46})); tee.rotation.x = -Math.PI/2; tee.position.set(H.tee[0], .003, H.tee[1]); g.add(tee);
    // light and shadow box fitted to the hole
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const [x, z] of H.outline){ x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    this.bb = {x0, x1, z0, z1, cx:(x0 + x1)/2, cz:(z0 + z1)/2, size:Math.max(x1 - x0, z1 - z0)};
    this.sun.position.set(this.bb.cx + 3, 12, this.bb.cz + 2); this.sun.target.position.set(this.bb.cx, 0, this.bb.cz);
    const sc = this.sun.shadow.camera, half = this.bb.size/2 + 2; sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.far = 30; sc.updateProjectionMatrix();
  }
  fitCamera(cam){ cam.fov = clamp(2*Math.atan(Math.tan(30*Math.PI/180)/Math.max(.5, cam.aspect))*180/Math.PI, 34, 72); }

  begin(){ this.hi = 0; this.startHole(); }
  startHole(){
    this.buildHole();
    const H = this.H;
    this.balls.forEach((b, i) => Object.assign(b, {x:H.tee[0] + (i - (this.n - 1)/2)*.09, z:H.tee[1], vx:0, vz:0, holed:false, done:false, strokes:0, drop:0}));
    this.phase = "intro"; this.t = 2.4; this.turn = -1;
    this.core.banner(-1, `Hole ${this.hi + 1} · ${esc(H.name)}<small>Par ${H.par}</small>`, 2.2);
  }
  dist(b){ return Math.hypot(b.x - this.H.cup[0], b.z - this.H.cup[1]); }
  pickTurn(){
    let best = -1, bd = -1;
    this.balls.forEach((b, i) => { if (b.done) return; const d = b.strokes === 0 ? 100 - i : this.dist(b); if (d > bd){ bd = d; best = i; } });
    return best;
  }
  nextTurn(){
    const t = this.pickTurn();
    if (t < 0) return this.endHole();
    this.turn = t; this.phase = "aim"; this.aimT = this.core.gt; this.plan = null;
    const b = this.balls[t]; b.lastX = b.x; b.lastZ = b.z;
    this.aimBase = this.defaultAim(b);
    this.buddies.forEach((bd, i) => bd.visible = i === t);
    this.core.feedback(0, `${esc(this.core.pName(t))}'s putt`, this.core.pSeat(t).col, 1.2);
  }
  clear(ax, az, bx, bz){ return !this.walls.some(s => segHit(ax, az, bx, bz, s)); }
  target(b){ // farthest point along the hole's route that the ball can see
    const H = this.H, pts = [...(H.way || []), H.cup];
    for (let i = pts.length - 1; i >= 0; i--) if (this.clear(b.x, b.z, pts[i][0], pts[i][1])) return {p:pts[i], cup:i === pts.length - 1};
    return {p:pts[0], cup:pts.length === 1};
  }
  defaultAim(b){ const t = this.target(b).p; return Math.atan2(t[0] - b.x, -(t[1] - b.z)); } // 0 = toward -z, + = right
  aimAngle(){
    const s = this.core.pSeat(this.turn);
    if (this.core.pBot(this.turn) || s.mo === "t") return this.aimBase + (this.botOff || 0);
    return this.aimBase + clamp(s.yaw*.6, -60, 60)*Math.PI/180;
  }
  swing(slot, sw){
    if (slot !== this.turn || this.phase !== "aim" || this.core.gt - this.aimT < .5) return;
    const ang = sw.bot ? this.aimBase + sw.off : this.aimBase + clamp((sw.touch ? sw.yaw : sw.yaw)*.6, -60, 60)*Math.PI/180;
    const sp = sw.bot ? sw.sp : .35 + clamp(sw.power, 0, 1)*5.4;
    const b = this.balls[slot];
    this.swingFrom = {x:b.x, z:b.z, ang};
    b.vx = Math.sin(ang)*sp; b.vz = -Math.cos(ang)*sp; b.strokes++;
    this.phase = "roll"; this.t = 0; this.swingT = this.core.gt;
    if (!this.core.pBot(slot)) this.core.pSeat(slot).hit++;
    Sfx.click(900, .2 + sp*.06);
  }
  gateRect(){ const G = this.H.gate, x = Math.sin(this.core.gt*Math.PI*2/G.per)*G.amp; return box(x - G.w/2, Math.max(G.z0, G.z1), x + G.w/2, Math.min(G.z0, G.z1)); }
  slopeAcc(x, z){
    let ax = 0, az = 0;
    for (const s of this.H.slopes || []){ const dx = x - s.x, dz = z - s.z, d = Math.hypot(dx, dz); if (d < s.r && d > 1e-3){ const f = s.k*(1 - d/s.r)*(s.k > 0 ? Math.min(1, d/.25) : 1); ax -= dx/d*f; az -= dz/d*f; } }
    return [ax, az];
  }
  physics(b, dt){
    const [ax, az] = this.slopeAcc(b.x, b.z);
    let sp = Math.hypot(b.vx, b.vz);
    b.vx += ax*dt; b.vz += az*dt;
    sp = Math.hypot(b.vx, b.vz);
    if (sp > 0){ const f = Math.min(sp, FRIC*dt); b.vx -= b.vx/sp*f; b.vz -= b.vz/sp*f; }
    sp = Math.hypot(b.vx, b.vz); if (sp > VMAX){ b.vx *= VMAX/sp; b.vz *= VMAX/sp; }
    const ox = b.x, oz = b.z;
    b.x += b.vx*dt; b.z += b.vz*dt;
    const walls = this.H.gate ? this.walls.concat(segs(this.gateRect())) : this.walls;
    for (const [x0, z0, x1, z1] of walls){
      const ex = x1 - x0, ez = z1 - z0, L2 = ex*ex + ez*ez; let u = ((b.x - x0)*ex + (b.z - z0)*ez)/L2; u = clamp(u, 0, 1);
      const px = x0 + ex*u, pz = z0 + ez*u, dx = b.x - px, dz = b.z - pz, d = Math.hypot(dx, dz);
      if (d < BR && d > 1e-6){
        const nx = dx/d, nz = dz/d, vn = b.vx*nx + b.vz*nz;
        b.x = px + nx*BR; b.z = pz + nz*BR;
        if (vn < 0){ b.vx -= (1 + E)*vn*nx; b.vz -= (1 + E)*vn*nz; if (-vn > .4) Sfx.click(1500, Math.min(.3, -vn*.06)); }
      }
    }
    if (!inside(this.H.outline, b.x, b.z) || (this.H.obs || []).some(o => inside(o, b.x, b.z))){ b.x = ox; b.z = oz; b.vx *= -.5; b.vz *= -.5; }
    if (this.H.gate && inside(this.gateRect(), b.x, b.z)){ const G = this.H.gate; b.z = Math.abs(b.z - G.z0) < Math.abs(b.z - G.z1) ? G.z0 + Math.sign(G.z0 - G.z1)*BR : G.z1 + Math.sign(G.z1 - G.z0)*BR; b.vz = -b.vz*.5; }
    // the cup
    const cx = this.H.cup[0], cz = this.H.cup[1], dc = Math.hypot(b.x - cx, b.z - cz);
    sp = Math.hypot(b.vx, b.vz);
    if (dc < CUP){
      if (sp < 1.6){ b.holed = true; b.vx = b.vz = 0; b.x = cx; b.z = cz; return; }
      const k = .7; b.vx *= k; b.vz *= k; const d = rnd(-.25, .25), c = Math.cos(d), s = Math.sin(d); [b.vx, b.vz] = [b.vx*c - b.vz*s, b.vx*s + b.vz*c];
    } else if (dc < CUP*1.8 && sp < 1.2){ b.vx += (cx - b.x)/dc*.8*dt; b.vz += (cz - b.z)/dc*.8*dt; }
    if (sp < .03){ const [sx, sz] = this.slopeAcc(b.x, b.z); if (Math.hypot(sx, sz) < FRIC*.9){ b.vx = b.vz = 0; } }
  }
  step(dt){
    const gt = this.core.gt;
    if (this.phase === "intro"){ this.t -= dt; if (this.t <= 0) this.nextTurn(); return; }
    if (this.phase === "aim"){
      if (this.core.pBot(this.turn)){
        if (!this.plan){
          const b = this.balls[this.turn], tg = this.target(b), d = Math.hypot(tg.p[0] - b.x, tg.p[1] - b.z) + (tg.cup ? .35 : .9);
          const want = Math.sqrt(2*FRIC*d), off = rnd(-1, 1)*(tg.cup ? .045 : .07)*(d < 1.5 ? .5 : 1);
          this.botOff = off; this.plan = {t:gt + rnd(1.2, 2.2), sw:{bot:true, off, sp:want*rnd(.88, 1.12)}};
        }
        if (gt >= this.plan.t) this.swing(this.turn, this.plan.sw);
      } else if (gt - this.aimT > 25){ this.core.feedback(0, "Auto putt", "#9aa7d6"); this.swing(this.turn, {bot:true, off:0, sp:2}); }
      return;
    }
    if (this.phase === "roll"){
      this.t += dt;
      const b = this.balls[this.turn];
      this.physics(b, dt);
      if (b.holed || (b.vx === 0 && b.vz === 0) || this.t > 20) this.endPutt();
      return;
    }
    if (this.phase === "settle"){ this.t -= dt; if (this.t <= 0) this.nextTurn(); return; }
    if (this.phase === "holeend"){ this.t -= dt; if (this.t <= 0){ this.hi++; if (this.hi >= this.holes.length) this.end(); else this.startHole(); } }
  }
  endPutt(){
    const b = this.balls[this.turn], H = this.H, nm = this.core.pName(this.turn);
    let msg = "";
    if (b.holed){
      b.done = true; this.sc[this.turn][this.hi] = b.strokes;
      const r = b.strokes - H.par;
      msg = b.strokes === 1 ? "Hole in one!" : r <= -2 ? "Eagle!" : r === -1 ? "Birdie!" : r === 0 ? "Par" : r === 1 ? "Bogey" : r === 2 ? "Double bogey" : `+${r}`;
      Sfx.chime(true); if (!this.core.pBot(this.turn) && r < 0) this.core.pSeat(this.turn).pt++;
      if (r <= 0) Sfx.win && b.strokes === 1 && Sfx.win();
    } else if (b.strokes >= MAXS){ b.done = true; this.sc[this.turn][this.hi] = MAXS + 1; msg = "Max strokes"; Sfx.tone(260, 180, .2, "triangle", .12); }
    else { const d = this.dist(b); msg = d < .5 ? "So close!" : `${d.toFixed(1)} m left`; }
    this.msg = msg;
    this.core.banner(-1, `${esc(msg)}<small>${esc(nm)}</small>`, 1.3);
    this.phase = "settle"; this.t = 1.5;
  }
  endHole(){ this.phase = "holeend"; this.t = 1.6; this.core.banner(-1, `Hole ${this.hi + 1} done`, 1.4); }
  totals(){ return this.sc.map(r => r.reduce((a, v) => a + (v || 0), 0)); }
  end(){
    this.phase = "done";
    const tot = this.totals(), order = tot.map((_, i) => i).sort((a, b) => tot[a] - tot[b]);
    const ranking = []; for (const i of order){ const g = ranking.find(r => tot[r[0]] === tot[i]); if (g) g.push(i); else ranking.push([i]); }
    const w = ranking[0];
    this.core.finish(ranking.map(r => r.length === 1 ? r[0] : r), w.map(i => this.core.pName(i)).join(" & ") + (w.length > 1 ? " tie!" : " wins!"), order.map(i => `${this.core.pName(i)} ${tot[i]}`).join(" · "));
  }
  padState(slot){
    const tot = this.totals()[slot], b = this.balls[slot], sub = `Strokes so far: ${tot + (b && !b.done ? b.strokes : 0)}`;
    if (this.phase === "done") return {msg:"Round over", sub};
    if (this.phase === "intro") return {msg:`Hole ${this.hi + 1}`, sub:`Par ${this.H.par}`};
    if (slot !== this.turn) return {msg:"Watching", sub:`${this.core.pName(this.turn)} is putting · ${sub}`};
    if (this.phase === "aim") return {msg:"Your putt", sub:"Twist to aim, swing gently"};
    if (this.phase === "roll") return {msg:"Rolling…", sub};
    return {msg:this.msg, sub};
  }
  key(e){
    if (e.key !== " " || this.phase !== "aim" || this.core.pBot(this.turn)) return;
    this.swing(this.turn, {power:.4, yaw:0, touch:true});
  }
  draw(dt){
    const core = this.core, gt = core.gt, H = this.H;
    if (!H){ core.renderViews(this.scene, [this.cam]); return; }
    if (this.gateMesh){ const G = H.gate; this.gateMesh.position.set(Math.sin(gt*Math.PI*2/G.per)*G.amp, .07, (G.z0 + G.z1)/2); }
    this.flag.rotation.y = Math.sin(gt*2)*.25;
    this.balls.forEach((b, i) => {
      if (b.holed && b.drop < 1) b.drop = Math.min(1, b.drop + dt*3);
      b.mesh.visible = !(b.holed && b.drop >= 1);
      b.mesh.position.set(b.x, BR*1.5 - b.drop*.06, b.z);
    });
    const cur = this.turn >= 0 ? this.balls[this.turn] : null;
    // aim arrow, buddy and putter
    let ang = this.aimBase || 0;
    if (this.phase === "aim" && cur){ ang = this.aimAngle(); this.arrow.visible = true; this.arrow.material.color.set(core.pSeat(this.turn).col); this.arrow.position.set(cur.x + Math.sin(ang)*.95, .012, cur.z - Math.cos(ang)*.95); this.arrow.rotation.z = -ang; }
    else this.arrow.visible = false;
    if (cur && (this.phase === "aim" || this.phase === "roll" || this.phase === "settle")){
      const bud = this.buddies[this.turn], dx = Math.sin(ang), dz = -Math.cos(ang), rx = -dz, rz = dx; // right of aim direction
      const sx = this.phase === "aim" ? cur.x : (this.swingFrom || cur).x, sz = this.phase === "aim" ? cur.z : (this.swingFrom || cur).z;
      if (this.phase === "aim") this.swingFrom = {x:cur.x, z:cur.z, ang};
      if (!this.swingFrom) this.swingFrom = {x:cur.x, z:cur.z, ang};
      const a = this.phase === "aim" ? ang : this.swingFrom.ang, adx = Math.sin(a), adz = -Math.cos(a), arx = -adz, arz = adx;
      bud.position.set(sx - arx*.55, 0, sz - arz*.55); bud.rotation.y = Math.atan2(arx, arz);
      const u = (gt - this.swingT)/.35; let sw = this.phase === "aim" ? Math.sin(gt*2)*.06 : 0;
      if (u >= 0 && u <= 1) sw = lerp(-.5, .45, u);
      this.putter.visible = true;
      this.putter.position.set(sx - arx*.18, 0, sz - arz*.18);
      this.putter.rotation.set(0, Math.atan2(arx, arz) + Math.PI/2, 0);
      this.putter.rotateZ(-.2); this.putter.rotateX(sw);
    } else { this.putter.visible = false; this.buddies.forEach(b => b.visible = false); }
    // camera
    let tp, tl;
    if (this.phase === "intro" || !cur){ const s = this.bb.size; tp = new THREE.Vector3(this.bb.cx, s*.6 + 2.2, this.bb.z1 + s*.35 + 2.5); tl = new THREE.Vector3(this.bb.cx, 0, this.bb.cz); }
    else if (this.phase === "aim"){ const dx = Math.sin(ang), dz = -Math.cos(ang); tp = new THREE.Vector3(cur.x - dx*2.9, 1.75, cur.z - dz*2.9); tl = new THREE.Vector3(cur.x + dx*3, 0, cur.z + dz*3); }
    else { const sp = Math.hypot(cur.vx, cur.vz), dx = sp > .1 ? cur.vx/sp : Math.sin(ang), dz = sp > .1 ? cur.vz/sp : -Math.cos(ang); this.chase = this.chase || {dx, dz}; this.chase.dx += (dx - this.chase.dx)*Math.min(1, dt*2); this.chase.dz += (dz - this.chase.dz)*Math.min(1, dt*2);
      tp = new THREE.Vector3(cur.x - this.chase.dx*2.2, 1.6, cur.z - this.chase.dz*2.2); tl = new THREE.Vector3(cur.x + this.chase.dx, 0, cur.z + this.chase.dz); }
    if (this.phase === "aim") this.chase = null;
    const k = Math.min(1, dt*3); this.camPos.lerp(tp, k); this.camLook.lerp(tl, k);
    this.cam.position.copy(this.camPos); this.cam.lookAt(this.camLook);
    // scorecard
    const nh = this.holes.length;
    let html = `<table style="border-collapse:collapse;font-size:clamp(.7rem,1.3vw,1rem)"><tr><td style="color:#9aa7d6;text-align:left">Hole</td>${this.holes.map((_, k) => `<td style="padding:0 7px;color:${k === this.hi && this.phase !== "done" ? "#ffd23f" : "#9aa7d6"};text-align:center">${k + 1}</td>`).join("")}<td style="padding:0 8px;color:#9aa7d6">Total</td></tr>`;
    html += `<tr><td style="color:#9aa7d6;text-align:left">Par</td>${this.holes.map(h => `<td style="text-align:center;color:#9aa7d6">${HOLES[h].par}</td>`).join("")}<td style="text-align:center;color:#9aa7d6">${this.holes.reduce((a, h) => a + HOLES[h].par, 0)}</td></tr>`;
    const tot = this.totals();
    core.playing.forEach((_, i) => {
      html += `<tr style="${i === this.turn && this.phase !== "done" ? "background:rgba(255,210,63,.15)" : ""}"><td style="padding:2px 10px 2px 2px;color:${core.pSeat(i).col};text-align:left">${esc(core.pName(i))}</td>${Array.from({length:nh}, (_, k) => `<td style="padding:2px 7px;text-align:center;border-left:1px solid rgba(255,255,255,.12)">${this.sc[i][k] ?? (k === this.hi && this.balls[i].strokes ? `<span style="color:#9aa7d6">${this.balls[i].strokes}</span>` : "")}</td>`).join("")}<td style="padding:2px 8px;font-size:1.15em;text-align:center">${tot[i]}</td></tr>`;
    });
    core.hudSet(0, "sb", html + "</table>");
    let tip = "";
    if (this.phase === "aim" && cur && !core.pBot(this.turn)) tip = `${esc(core.pName(this.turn))}: ${core.pSeat(this.turn).mo === "t" ? "swipe up to putt, angled to aim" : "twist to aim, then swing gently like a putt"} · ${this.dist(cur).toFixed(1)} m to the cup`;
    core.hudSet(0, "tip", tip);
    core.renderViews(this.scene, [this.cam]);
  }
  destroy(){ this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material){ (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); } }); }
}

registerGame({
  id:"golf", name:"Mini Golf", icon:"⛳", tag:"Up to 4 · take turns", min:1, max:4, fill:2,
  padMode:"putt",
  options:[{key:"holes", label:"Holes", values:[3, 7, 1]}],
  howto:"Take turns putting. The arrow points the sensible way to start, so twist the phone to adjust it, then swing gently like a putter. A soft swing rolls a short way, a firm one rolls far. Fewest strokes wins, and each hole stops at 6 strokes. No motion? Swipe up on the phone, angled to aim; a longer swipe hits harder.",
  pad:"Hold the phone like a putter grip, pointing at the floor, and tap Recenter. Twist to aim, then swing gently.",
  season:{holes:1}, seasonRules:"One hole, fewest strokes wins",
  create(core, opts){ return new Golf(core, opts); }
});
})();
