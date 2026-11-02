/* Pocket Sports: Bowling. Turn based, up to 4 players. Twist to aim, underhand swing to throw. */
(function(){
"use strict";
const LW = .5325, BR = .108, PR = .06, HEAD = -18.29, PIT = -19.25, STEP = 1/240;
const MB = 5, MP = 1;
const rnd = (a, b) => a + Math.random()*(b - a);

function pinSpots(){
  const out = [];
  for (let r = 0; r < 4; r++) for (let j = 0; j <= r; j++) out.push({x:(j - r/2)*.305, z:HEAD - r*.264});
  return out;
}
function computeScore(fr, n){
  const flat = [], start = [];
  fr.forEach(f => { start.push(flat.length); flat.push(...f); });
  let total = 0, broken = false; const cum = [];
  for (let k = 0; k < n; k++){
    const f = fr[k]; let val = null;
    if (f && !broken){
      if (k === n - 1){ if (f.length === 3 || (f.length === 2 && f[0] + f[1] < 10)) val = f.reduce((a, b) => a + b, 0); }
      else if (f[0] === 10){ const nx = flat.slice(start[k] + 1, start[k] + 3); if (nx.length === 2) val = 10 + nx[0] + nx[1]; }
      else if (f.length === 2){ if (f[0] + f[1] === 10){ const nx = flat[start[k] + 2]; if (nx !== undefined) val = 10 + nx; } else val = f[0] + f[1]; }
    }
    if (val === null){ broken = true; cum.push(null); } else { total += val; cum.push(total); }
  }
  // running total that includes unfinished frames at face value, for live standings
  const raw = flat.reduce((a, b) => a + b, 0);
  return {cum, total, live:Math.max(total, broken ? total + 0 : total) || raw*0 + total};
}
function marks(f, last){
  const out = [];
  for (let i = 0; i < f.length; i++){
    const v = f[i];
    if (v === 10 && (i === 0 || last && (f[i-1] === 10 || (i === 2 && f[0] + f[1] === 10)))) out.push("X");
    else if (i > 0 && !(last && f[i-1] === 10) && !(last && i === 2 && f[0] + f[1] === 10) && f[i-1] + v === 10 && f[i-1] !== 10) out.push("/");
    else out.push(v === 0 ? "-" : String(v));
  }
  return out.join(" ");
}

class Bowling {
  constructor(core, opts){
    this.core = core; this.frames = +opts.frames || 10; this.views = 1;
    this.n = core.playing.length;
    const scene = this.scene = new THREE.Scene();
    const sun = core.makeRoom(scene, {sky:0x161d42, fogNear:22, fogFar:48, shadow:11, sunX:1.5, sunZ:-8});
    sun.target.position.set(0, 0, -9);
    this.buildLane();
    this.cam = new THREE.PerspectiveCamera(50, 1, .05, 80);
    this.camPos = new THREE.Vector3(0, 1.5, 2.6); this.camLook = new THREE.Vector3(0, .25, -18);
    this.buddies = core.playing.map((_, i) => { const b = core.makeBuddy(core.pSeat(i).col); b.rotation.y = Math.PI; b.visible = false; scene.add(b); return b; });
    this.fr = core.playing.map(() => []);
    this.turn = 0; this.frame = 0; this.phase = "idle"; this.t = 0;
    this.ball = {x:0, z:.3, vx:0, vz:0, curve:0, live:false, gutter:false, y:BR};
    this.msg = "";
  }
  buildLane(){
    const s = this.scene, M = (c, o={}) => new THREE.MeshStandardMaterial(Object.assign({color:c, roughness:.6}, o));
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 60), M(0x232a55, {roughness:.95})); floor.rotation.x = -Math.PI/2; floor.position.set(0, -.01, -12); floor.receiveShadow = true; s.add(floor);
    // lane boards via a canvas texture
    const cv = document.createElement("canvas"); cv.width = 128; cv.height = 1024; const x = cv.getContext("2d");
    for (let i = 0; i < 16; i++){ x.fillStyle = i % 2 ? "#e2b47a" : "#d9a86c"; x.fillRect(i*8, 0, 8, 1024); }
    x.fillStyle = "rgba(255,255,255,.08)"; for (let i = 0; i < 40; i++) x.fillRect(Math.random()*128, Math.random()*1024, 1, 40);
    // target arrows
    x.fillStyle = "#7a3b16";
    for (const k of [-3, -2, -1, 0, 1, 2, 3]){ const cx = 64 + k*16, cy = 860 - Math.abs(k)*14; x.beginPath(); x.moveTo(cx, cy - 18); x.lineTo(cx - 5, cy); x.lineTo(cx + 5, cy); x.fill(); }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const lane = new THREE.Mesh(new THREE.BoxGeometry(LW*2, .04, 20), new THREE.MeshStandardMaterial({map:tex, roughness:.25, metalness:.05}));
    lane.position.set(0, -.02, -9.6); lane.receiveShadow = true; s.add(lane);
    const foul = new THREE.Mesh(new THREE.BoxGeometry(LW*2 + .3, .005, .03), M(0x222222)); foul.position.set(0, .001, 0); s.add(foul);
    const gut = M(0x3a3f55, {roughness:.4});
    for (const sx of [-1, 1]){
      const g = new THREE.Mesh(new THREE.BoxGeometry(.2, .02, 20), gut); g.position.set(sx*(LW + .1), -.06, -9.6); g.receiveShadow = true; s.add(g);
      const wall = new THREE.Mesh(new THREE.BoxGeometry(.08, .25, 20.5), M(0x2d3a7a)); wall.position.set(sx*(LW + .24), .05, -9.8); wall.castShadow = true; s.add(wall);
    }
    const pit = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, .2), M(0x0b0f22)); pit.position.set(0, .5, PIT - .9); s.add(pit);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(2.2, .5, 1.6), M(0x2d3a7a)); hood.position.set(0, 1.35, PIT - .3); s.add(hood);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(1.6, .12, .02), M(0xffd23f, {emissive:0x443300})); sign.position.set(0, 1.3, PIT + .51); s.add(sign);
    // neighbouring lanes for atmosphere
    for (const sx of [-1, 1]){ const n = new THREE.Mesh(new THREE.BoxGeometry(LW*2, .04, 20), new THREE.MeshStandardMaterial({map:tex, roughness:.3})); n.position.set(sx*1.6, -.02, -9.6); n.receiveShadow = true; s.add(n); }
    // pins
    const prof = [[0,0],[.028,0],[.04,.04],[.06,.13],[.058,.2],[.04,.27],[.024,.3],[.022,.33],[.03,.36],[.035,.38],[.03,.4],[0,.405]].map(p => new THREE.Vector2(p[0], p[1]));
    const pinGeo = new THREE.LatheGeometry(prof, 18), pinMat = M(0xffffff, {roughness:.3}), bandMat = M(0xd8262b, {roughness:.4});
    const bandGeo = new THREE.TorusGeometry(.024, .006, 6, 18);
    this.pins = pinSpots().map(p => {
      const g = new THREE.Group(); const m = new THREE.Mesh(pinGeo, pinMat); m.castShadow = true; g.add(m);
      const b1 = new THREE.Mesh(bandGeo, bandMat); b1.rotation.x = Math.PI/2; b1.position.y = .3; g.add(b1);
      const b2 = b1.clone(); b2.position.y = .285; g.add(b2);
      s.add(g);
      return {home:p, g, x:p.x, z:p.z, vx:0, vz:0, down:false, gone:false, tilt:0, dir:0};
    });
    this.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BR, 28, 20), M(0xffffff, {roughness:.15, metalness:.1})); this.ballMesh.castShadow = true; s.add(this.ballMesh);
    const holeMat = M(0x111111);
    for (const [a, b] of [[.3, .2], [-.3, .2], [0, -.25]]){ const h = new THREE.Mesh(new THREE.CircleGeometry(.014, 10), holeMat); h.position.set(a*BR*1.2, b*BR*1.2 + BR*.4, BR*.92); h.lookAt(h.position.clone().multiplyScalar(2)); this.ballMesh.add(h); }
    this.arrow = new THREE.Mesh(new THREE.PlaneGeometry(.05, 4), new THREE.MeshBasicMaterial({color:0xffd23f, transparent:true, opacity:.55, depthWrite:false}));
    this.arrow.rotation.x = -Math.PI/2; this.arrow.position.y = .005; s.add(this.arrow);
  }
  fitCamera(cam){ cam.fov = clamp(2*Math.atan(Math.tan(32*Math.PI/180)/Math.max(.5, cam.aspect))*180/Math.PI, 30, 70); }

  begin(){ this.turn = 0; this.frame = 0; this.startTurn(); }
  startTurn(){
    for (const p of this.pins){ Object.assign(p, {x:p.home.x, z:p.home.z, vx:0, vz:0, down:false, gone:false, tilt:0}); p.g.visible = true; }
    this.fr[this.turn][this.frame] = this.fr[this.turn][this.frame] || [];
    this.buddies.forEach((b, i) => b.visible = i === this.turn);
    this.prepRoll();
    this.core.banner(-1, `${esc(this.core.pName(this.turn))}<small>Frame ${this.frame + 1} of ${this.frames}</small>`, 1.4);
  }
  prepRoll(){
    Object.assign(this.ball, {x:0, z:.25, vx:0, vz:0, curve:0, live:false, gutter:false, y:BR, spinA:0});
    this.phase = "aim"; this.t = 0; this.plan = null; this.aimT = this.core.gt;
  }
  aimAngle(){
    const s = this.core.pSeat(this.turn);
    if (this.core.pBot(this.turn) || s.mo === "t") return this.botAim || 0;
    return clamp(s.yaw/40, -1, 1)*.035;
  }
  swing(slot, sw){
    if (slot !== this.turn || this.phase !== "aim" || this.core.gt - this.aimT < .6) return;
    const touch = sw.touch, ang = touch ? clamp(sw.yaw/40, -1, 1)*.035 : (sw.bot ? sw.ang : clamp(sw.yaw/40, -1, 1)*.035);
    const tw = sw.yawEnd - sw.yaw, curve = touch ? 0 : clamp((Math.abs(tw) < 8 ? 0 : tw - Math.sign(tw)*8)/40, -1, 1);
    const sp = 5.2 + sw.power*4.6;
    Object.assign(this.ball, {vx:Math.sin(ang)*sp, vz:-Math.cos(ang)*sp, curve:sw.bot ? sw.curve : curve, live:true});
    this.phase = "roll"; this.t = 0; this.hitPins = false;
    if (!this.core.pBot(slot)) this.core.pSeat(slot).hit++;
    Sfx.tone(90, 60, .5, "sine", .18);
    if (Math.abs(this.ball.curve) > .3) this.core.feedback(0, this.ball.curve > 0 ? "Hooking right" : "Hooking left", "#ffd23f", 1.2);
  }
  step(dt){
    const gt = this.core.gt, b = this.ball;
    if (this.phase === "aim"){
      if (this.core.pBot(this.turn)){
        if (!this.plan){ const st = this.pins.filter(p => !p.down); const cx = st.length ? st.reduce((a, p) => a + p.x, 0)/st.length : 0; this.botAim = Math.atan2(cx, 18.3) + rnd(-.03, .03); this.plan = {t:gt + rnd(1.4, 2.4), sw:{power:rnd(.5, .95), bot:true, ang:this.botAim + rnd(-.01, .01), curve:rnd(-.5, .5), yaw:0, yawEnd:0}}; }
        if (gt >= this.plan.t) this.swing(this.turn, this.plan.sw);
      } else if (gt - this.aimT > 15){ this.core.feedback(0, "Auto throw", "#9aa7d6"); this.swing(this.turn, {power:.5, bot:true, ang:0, curve:0, yaw:0, yawEnd:0}); }
      return;
    }
    if (this.phase === "roll"){
      this.t += dt;
      if (b.live){
        if (!b.gutter){
          if (b.z < -7) b.vx += b.curve*.5*dt;
          if (Math.abs(b.x) > LW - BR*.3){ b.gutter = true; b.x = Math.sign(b.x)*(LW + .1); b.vx = 0; Sfx.tone(140, 80, .3, "triangle", .12); this.core.feedback(0, "Gutter!", "#ff6b6b"); }
        }
        b.x += b.vx*dt; b.z += b.vz*dt; b.vz *= 1 - .02*dt;
        b.spinA += b.vz*dt/BR;
        if (b.z < PIT){ b.live = false; }
        if (!b.gutter) for (const p of this.pins) if (!p.gone) this.collide(b, p, BR + PR, MB, MP, true);
      }
      for (const p of this.pins){
        if (p.gone) continue;
        const sp = Math.hypot(p.vx, p.vz);
        if (sp > 0){ const f = Math.max(0, sp - (p.down ? 1.8 : 3.5)*dt)/sp; p.vx *= f; p.vz *= f; }
        p.x += p.vx*dt; p.z += p.vz*dt;
        if (!p.down && sp > .2){ p.down = true; p.dir = Math.atan2(p.vx, p.vz); Sfx.click(900 + Math.random()*600, .25); }
        if (p.down) p.tilt = Math.min(Math.PI/2, p.tilt + dt*7);
        if (p.z < PIT - .1 || Math.abs(p.x) > LW + .08){ p.gone = true; p.down = true; }
      }
      for (let i = 0; i < 10; i++) for (let j = i + 1; j < 10; j++){ const a = this.pins[i], c = this.pins[j]; if (!a.gone && !c.gone) this.collide(a, c, PR*2 + (a.down ? .05 : 0) + (c.down ? .05 : 0), MP, MP, false); }
      const moving = this.pins.some(p => !p.gone && Math.hypot(p.vx, p.vz) > .03);
      if ((!b.live && !moving && this.t > 1) || this.t > 7) this.endRoll();
      return;
    }
    if (this.phase === "settle"){
      this.t -= dt;
      if (this.t <= 0) this.next();
    }
  }
  collide(a, c, rad, ma, mc, isBall){
    const dx = c.x - a.x, dz = c.z - a.z, d = Math.hypot(dx, dz);
    if (d >= rad || d < 1e-6) return;
    const nx = dx/d, nz = dz/d, push = (rad - d);
    const ta = mc/(ma + mc), tc = ma/(ma + mc);
    a.x -= nx*push*ta; a.z -= nz*push*ta; c.x += nx*push*tc; c.z += nz*push*tc;
    const rv = (c.vx - a.vx)*nx + (c.vz - a.vz)*nz; if (rv > 0) return;
    const e = .8, j = -(1 + e)*rv/(1/ma + 1/mc);
    a.vx -= j*nx/ma; a.vz -= j*nz/ma; c.vx += j*nx/mc; c.vz += j*nz/mc;
    // a little scatter so no two strikes look the same
    c.vx += (Math.random() - .5)*.25*Math.abs(rv);
    if (isBall && !this.hitPins){ this.hitPins = true; Sfx.click(700, .6); }
  }
  endRoll(){
    const f = this.fr[this.turn][this.frame];
    const standing = this.pins.filter(p => !p.down).length;
    const prevDown = this.pinsDownBefore || 0;
    const knocked = 10 - standing - prevDown;
    f.push(knocked);
    const last = this.frame === this.frames - 1;
    let msg = knocked === 0 ? (this.ball.gutter ? "Gutter ball" : "Miss") : knocked + (knocked === 1 ? " pin" : " pins");
    if (standing === 0 && prevDown === 0) msg = "Strike!";
    else if (standing === 0) msg = "Spare!";
    this.msg = msg;
    this.core.banner(-1, msg, 1.3);
    if (msg === "Strike!" || msg === "Spare!"){ Sfx.chime(true); if (!this.core.pBot(this.turn)) this.core.pSeat(this.turn).pt++; }
    // what happens next
    let more = false, reset = false;
    if (!last){ more = f.length === 1 && f[0] < 10; }
    else {
      if (f.length === 1){ more = true; reset = f[0] === 10; }
      else if (f.length === 2){ more = f[0] === 10 || f[0] + f[1] === 10; reset = (f[0] === 10 && f[1] === 10) || (f[0] !== 10 && f[0] + f[1] === 10) || (f[0] === 10 && standing === 0); }
    }
    this.more = more; this.reset = reset || standing === 0;
    this.phase = "settle"; this.t = 1.6;
  }
  next(){
    if (this.more){
      if (this.reset){ for (const p of this.pins){ Object.assign(p, {x:p.home.x, z:p.home.z, vx:0, vz:0, down:false, gone:false, tilt:0}); } this.pinsDownBefore = 0; }
      else { for (const p of this.pins) if (p.down){ p.gone = true; } this.pinsDownBefore = this.pins.filter(p => p.down).length; }
      for (const p of this.pins){ p.g.visible = !p.gone; if (!p.down){ p.vx = p.vz = 0; } }
      return this.prepRoll();
    }
    this.pinsDownBefore = 0;
    this.turn++;
    if (this.turn >= this.n){ this.turn = 0; this.frame++; }
    if (this.frame >= this.frames) return this.end();
    this.startTurn();
  }
  totals(){ return this.fr.map(f => computeScore(f, this.frames).total); }
  end(){
    this.phase = "done";
    const tot = this.totals(), order = tot.map((t, i) => i).sort((a, b) => tot[b] - tot[a]);
    const ranking = []; for (const i of order){ const g = ranking.find(r => tot[r[0]] === tot[i]); if (g) g.push(i); else ranking.push([i]); }
    const w = ranking[0];
    this.core.finish(ranking.map(r => r.length === 1 ? r[0] : r), w.map(i => this.core.pName(i)).join(" & ") + (w.length > 1 ? " tie!" : " wins!"), order.map(i => this.core.pName(i) + " " + tot[i]).join(" · "));
  }
  padState(slot){
    const tot = this.totals(), sub = `Score ${tot[slot]}`;
    if (this.phase === "done") return {msg:tot[slot] === Math.max(...tot) ? "You win!" : "Good game", sub};
    if (slot !== this.turn) return {msg:"Watching", sub:`${this.core.pName(this.turn)} is bowling · ${sub}`};
    if (this.phase === "aim") return {msg:"Your turn", sub:"Twist to aim, then swing underhand"};
    if (this.phase === "roll") return {msg:"Rolling…", sub};
    return {msg:this.msg, sub};
  }
  key(e){ if (e.key === " " ) return; }
  draw(dt){
    const core = this.core, b = this.ball, gt = core.gt;
    // ball
    let by = BR; if (b.gutter) by = BR - .06;
    const holdX = -.06;
    if (this.phase === "aim"){ this.ballMesh.position.set(holdX, .5 + Math.sin(gt*2)*.01, .55); }
    else this.ballMesh.position.set(b.x, by, b.z);
    this.ballMesh.rotation.x = -(b.spinA || 0);
    this.ballMesh.material.color.set(core.pSeat(this.turn).col);
    // aim arrow
    const ang = this.aimAngle();
    this.arrow.visible = this.phase === "aim";
    this.arrow.rotation.z = -ang; this.arrow.position.set(Math.sin(ang)*2.2, .005, -Math.cos(ang)*2.2);
    this.arrow.material.color.set(core.pSeat(this.turn).col);
    // bowler
    const bud = this.buddies[this.turn];
    if (bud){ const lunge = this.phase === "roll" ? Math.min(1, this.t*3) : 0; bud.position.set(-.32, 0, .8 - lunge*.45); bud.userData.body.rotation.x = -lunge*.35; }
    // pins
    for (const p of this.pins){
      p.g.visible = !p.gone || (this.phase === "roll" && p.z > PIT - .5);
      p.g.position.set(p.x, 0, p.z);
      p.g.rotation.set(0, 0, 0); if (p.tilt > 0){ p.g.rotation.y = p.dir; p.g.rotateX(p.tilt); }
    }
    // camera: behind the bowler, then chase the ball, then watch the pins
    let tp, tl;
    if (this.phase === "aim"){ tp = new THREE.Vector3(.38, 1.4, 3.4); tl = new THREE.Vector3(0, .15, -17); }
    else { const z = Math.max(b.z + 3.4, -12.6); tp = new THREE.Vector3(b.x*.4, 1.05 + Math.max(0, -z)*.02, z); tl = new THREE.Vector3(b.x*.3, .15, Math.max(b.z - 6, HEAD)); }
    const k = Math.min(1, dt*4); this.camPos.lerp(tp, k); this.camLook.lerp(tl, k);
    this.cam.position.copy(this.camPos); this.cam.lookAt(this.camLook);
    // scoreboard
    const F = this.frames, show = Math.min(F, 10);
    let html = `<table style="border-collapse:collapse;font-size:clamp(.7rem,1.3vw,1rem)"><tr><td></td>${Array.from({length:show}, (_, k) => `<td style="padding:0 6px;color:#9aa7d6;text-align:center">${k + 1}</td>`).join("")}<td style="padding:0 8px;color:#9aa7d6">Total</td></tr>`;
    core.playing.forEach((_, i) => {
      const sc = computeScore(this.fr[i], F);
      html += `<tr style="${i === this.turn && this.phase !== "done" ? "background:rgba(255,210,63,.15)" : ""}"><td style="padding:2px 10px 2px 2px;color:${core.pSeat(i).col};text-align:left">${esc(core.pName(i))}</td>${Array.from({length:show}, (_, k) => { const f = this.fr[i][k]; return `<td style="padding:2px 6px;text-align:center;min-width:2.6em;border-left:1px solid rgba(255,255,255,.12)"><div style="font-size:.8em;color:#e8ecff">${f ? marks(f, k === F - 1) : ""}</div><div>${sc.cum[k] ?? ""}</div></td>`; }).join("")}<td style="padding:2px 8px;font-size:1.2em">${sc.total}</td></tr>`;
    });
    html += "</table>";
    core.hudSet(0, "sb", html);
    let tip = "";
    if (this.phase === "aim" && !core.pBot(this.turn)) tip = core.pSeat(this.turn).mo === "t" ? `${esc(core.pName(this.turn))}: swipe up to bowl (angle the swipe to aim)` : `${esc(core.pName(this.turn))}: twist to aim, then swing underhand. Twist as you release to hook it.`;
    core.hudSet(0, "tip", tip);
    core.renderViews(this.scene, [this.cam]);
  }
  destroy(){ this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material){ (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); } }); }
}

registerGame({
  id:"bowling", name:"Bowling", icon:"🎳", tag:"Up to 4 · take turns", min:1, max:4, fill:2,
  padMode:"pendulum",
  options:[{key:"frames", label:"Frames", values:[10, 5, 3]}],
  howto:"Take turns bowling. Twist the phone left or right to aim the arrow, then swing your arm underhand like a real throw. Swing harder for a faster ball, and twist your wrist as you let go to hook it. No motion? Swipe up on the phone, angled to aim.",
  pad:"Hold the phone screen forward and tap Recenter. Twist to aim, then swing underhand to bowl.",
  season:{frames:2}, seasonRules:"2 frames each, highest score wins",
  create(core, opts){ return new Bowling(core, opts); }
});
})();
