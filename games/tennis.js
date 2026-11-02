/* Pocket Sports: Tennis. 1v1, split screen, phones swing as rackets, players run to the ball on their own. */
(function(){
"use strict";
const HL = 11.885, HW = 4.115, DW = 5.485, SVC = 6.4, NET_H = .95, R = .045;
const G = 9.8, SPIN_G = 4.5, EY = .74, STEP = 1/240;
const EARLY = .3, LATE = .22, RUN = 7.5;
const side = s => s === 0 ? 1 : -1;     // seat 0 at +z (left view), seat 1 at -z
const right = s => s === 0 ? 1 : -1;    // world x of each player's right hand
const rnd = (a, b) => a + Math.random()*(b - a);
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / .5;

function stepBall(b, dt, ev){
  const ay = -(G + SPIN_G*b.s), p = b.p, v = b.v, oz = p.z, oy = p.y;
  p.x += v.x*dt; p.y += v.y*dt + .5*ay*dt*dt; p.z += v.z*dt; v.y += ay*dt;
  v.x *= 1 - .08*dt; v.z *= 1 - .08*dt;
  if (!b.netHit && (oz > 0) !== (p.z > 0) && Math.abs(p.x) < DW + .9){
    const f = oz/(oz - p.z), yc = oy + (p.y - oy)*f;
    if (yc < NET_H + R){ b.netHit = true; p.z = oz > 0 ? R : -R; v.z = -v.z*.1; v.x *= .3; v.y = Math.min(v.y, 0)*.2; b.s = 0; ev && ev.push({type:"net"}); }
  }
  if (p.y < R && v.y < 0){
    p.y = R + (R - p.y)*EY;
    v.y = -v.y*EY*(1 - .1*b.s); const k = .8 + .12*b.s; v.x *= k; v.z *= k; b.s *= .4;
    ev && ev.push({type:"bounce", x:p.x, z:p.z});
  }
}
const cloneBall = b => ({p:{...b.p}, v:{...b.v}, s:b.s, netHit:b.netHit});
function solve(p0, t, T, s){ const ay = -(G + SPIN_G*s); return {x:(t.x - p0.x)/T, y:(t.y - p0.y - .5*ay*T*T)/T, z:(t.z - p0.z)/T}; }
function clearsNet(p0, v, s, margin){
  if (Math.abs(v.z) < 1e-6) return false;
  const tn = -p0.z / v.z; if (tn <= 0) return true;
  const ay = -(G + SPIN_G*s); return p0.y + v.y*tn + .5*ay*tn*tn > NET_H + R + margin;
}

class Tennis {
  constructor(core, opts){
    this.core = core; this.to = +opts.to || 7; this.views = 2;
    const scene = this.scene = new THREE.Scene();
    const sun = core.makeRoom(scene, {sky:0x6fa8dc, fogNear:40, fogFar:90, shadow:16});
    sun.position.set(6, 22, 9); const sc = sun.shadow.camera; sc.far = 60; sc.updateProjectionMatrix();
    this.buildCourt();
    this.ball = {p:{x:0, y:1, z:HL}, v:{x:0, y:0, z:0}, s:0, netHit:false};
    this.cams = [0, 1].map(() => { const c = new THREE.PerspectiveCamera(50, 1, .1, 120); c.userData.x = 0; return c; });
    this.pl = [0, 1].map(i => {
      const buddy = core.makeBuddy(core.pSeat(i).col); buddy.scale.setScalar(1.55); buddy.rotation.y = i === 0 ? Math.PI : 0; scene.add(buddy);
      const racket = this.makeRacket(); racket.scale.setScalar(1.45); scene.add(racket);
      return {buddy, racket, pos:{x:0, z:side(i)*(HL + .8)}, swingT:-9, fore:true, cool:0, plan:null, moving:0};
    });
    this.sc = [0, 0]; this.phase = "idle"; this.t = 0; this.shotId = 0; this.lastMsg = ""; this.tossId = 0;
  }
  buildCourt(){
    const s = this.scene, M = (c, o={}) => new THREE.MeshStandardMaterial(Object.assign({color:c, roughness:.85}, o));
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), M(0x3f8f4a, {roughness:1})); grass.rotation.x = -Math.PI/2; grass.receiveShadow = true; s.add(grass);
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(DW*2 + 7, HL*2 + 12), M(0x3a6fb0)); apron.rotation.x = -Math.PI/2; apron.position.y = .004; apron.receiveShadow = true; s.add(apron);
    const court = new THREE.Mesh(new THREE.PlaneGeometry(DW*2, HL*2), M(0x2f8f6a)); court.rotation.x = -Math.PI/2; court.position.y = .008; court.receiveShadow = true; s.add(court);
    const white = M(0xffffff, {roughness:.6}), line = (w, d, x, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, .004, d), white); m.position.set(x, .011, z); m.receiveShadow = true; s.add(m); };
    const L = .06;
    for (const sx of [-1, 1]){ line(L, HL*2, sx*HW, 0); line(L, HL*2, sx*DW, 0); }
    for (const sz of [-1, 1]){ line(DW*2, L, 0, sz*HL); line(HW*2, L, 0, sz*SVC); line(L, SVC, 0, sz*SVC/2); line(L, .2, 0, sz*(HL - .1)); }
    // net
    const net = new THREE.Mesh(new THREE.PlaneGeometry(DW*2 + 1.8, NET_H), new THREE.MeshStandardMaterial({color:0x101820, transparent:true, opacity:.55, side:THREE.DoubleSide}));
    net.position.set(0, NET_H/2, 0); s.add(net);
    const tape = new THREE.Mesh(new THREE.BoxGeometry(DW*2 + 1.8, .07, .03), white); tape.position.set(0, NET_H - .03, 0); s.add(tape);
    const dark = M(0x23303d);
    for (const sx of [-1, 1]){ const post = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, NET_H + .1, 10), dark); post.position.set(sx*(DW + .9), (NET_H + .1)/2, 0); post.castShadow = true; s.add(post); }
    // low walls and a few round trees for depth
    const wall = M(0x23497a);
    for (const sz of [-1, 1]){ const w = new THREE.Mesh(new THREE.BoxGeometry(DW*2 + 7, 1, .2), wall); w.position.set(0, .5, sz*(HL + 6)); w.castShadow = w.receiveShadow = true; s.add(w); }
    for (const sx of [-1, 1]){ const w = new THREE.Mesh(new THREE.BoxGeometry(.2, 1, HL*2 + 12), wall); w.position.set(sx*(DW + 3.5), .5, 0); w.receiveShadow = true; s.add(w); }
    const leaf = M(0x2e7d3a, {roughness:.9}), trunk = M(0x6b4a2f);
    for (let i = 0; i < 16; i++){
      const sx = i % 2 ? 1 : -1, z = -26 + (i >> 1)*7.4, x = sx*(DW + 7 + (i % 3));
      const t = new THREE.Mesh(new THREE.CylinderGeometry(.18, .25, 2, 8), trunk); t.position.set(x, 1, z); s.add(t);
      const c = new THREE.Mesh(new THREE.SphereGeometry(1.6 + (i % 3)*.3, 14, 10), leaf); c.position.set(x, 3.2, z); c.castShadow = true; s.add(c);
    }
    this.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(R*1.9, 18, 12), new THREE.MeshStandardMaterial({color:0xe4ff3a, emissive:0x2a3300, roughness:.5}));
    this.ballMesh.castShadow = true; s.add(this.ballMesh);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(.09, 16), new THREE.MeshBasicMaterial({color:0x000000, transparent:true, opacity:.3, depthWrite:false}));
    this.shadow.rotation.x = -Math.PI/2; s.add(this.shadow);
    this.glow = new THREE.Mesh(new THREE.SphereGeometry(R*4, 16, 12), new THREE.MeshBasicMaterial({color:0xffd23f, transparent:true, opacity:.35, depthWrite:false}));
    s.add(this.glow);
    this.marker = new THREE.Mesh(new THREE.RingGeometry(.22, .32, 24), new THREE.MeshBasicMaterial({color:0xffffff, transparent:true, opacity:.7, depthWrite:false}));
    this.marker.rotation.x = -Math.PI/2; this.marker.position.y = .02; s.add(this.marker);
  }
  makeRacket(){
    const g = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.TorusGeometry(.15, .016, 8, 28), new THREE.MeshStandardMaterial({color:0xff5d73, roughness:.4}));
    frame.scale.y = 1.25; frame.position.y = .42; frame.castShadow = true; g.add(frame);
    const str = new THREE.Mesh(new THREE.CircleGeometry(.145, 24), new THREE.MeshStandardMaterial({color:0xf3f3f3, transparent:true, opacity:.55, side:THREE.DoubleSide}));
    str.scale.y = 1.25; str.position.y = .42; g.add(str);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.018, .02, .26, 8), new THREE.MeshStandardMaterial({color:0x2b2b3a, roughness:.5})); shaft.position.y = .14; g.add(shaft);
    return g;
  }
  fitCamera(cam){ cam.fov = clamp(2*Math.atan(Math.tan(27*Math.PI/180)/cam.aspect)*180/Math.PI, 38, 78); }

  /* ---------- match flow ---------- */
  begin(){ this.sc = [0, 0]; this.first = Math.random() < .5 ? 0 : 1; this.phase = "countdown"; this.t = 3; this.cdShown = 0; }
  server(){ const n = this.sc[0] + this.sc[1]; return (this.first + Math.floor((n + 1)/2)) % 2; }
  isOver(){ const [a, b] = this.sc, to = this.to; return (a >= to || b >= to) && (to < 7 || Math.abs(a - b) >= 2); }
  serveX(){ const n = this.sc[0] + this.sc[1]; return (n % 2 === 0 ? 1 : -1)*right(this.srv)*1.1; } // deuce side first
  newPoint(){
    this.srv = this.server(); this.second = false; this.prepServe();
    const r = 1 - this.srv; this.pl[r].pos = {x:-this.serveX()*2.2, z:side(r)*(HL + .9)};
    this.pl[this.srv].pos = {x:this.serveX(), z:side(this.srv)*(HL + .3)};
  }
  prepServe(){
    this.phase = "pre"; this.t = .9; this.tosses = 0; this.awaiting = -1; this.bounces = 0; this.isServe = false;
    this.contact = null; this.lastHitter = -1; Object.assign(this.ball, {v:{x:0, y:0, z:0}, s:0, netHit:false});
    for (const p of this.pl) p.plan = null;
    this.placeServeBall();
  }
  placeServeBall(){ const s = this.srv; Object.assign(this.ball.p, {x:this.serveX() + right(s)*.15, y:1.2, z:side(s)*(HL + .1)}); }
  point(w, reason){
    if (this.phase !== "flight" && this.phase !== "toss") return;
    this.sc[w]++; this.phase = "point"; this.t = 1.9; this.awaiting = -1; this.contact = null;
    if (!this.core.pBot(w)) this.core.pSeat(w).pt++;
    this.lastMsg = reason;
    this.core.banner(-1, `${esc(reason)}<small>Point ${esc(this.core.pName(w))}</small>`, 1.7);
    Sfx.chime(true);
  }
  fault(){
    if (this.second) return this.point(1 - this.srv, "Double fault!");
    this.core.banner(-1, "Fault<small>Second serve</small>", 1.1); Sfx.tone(300, 200, .15, "triangle", .15);
    this.phase = "faultwait"; this.t = 1.2; this.second = true;
  }
  step(dt){
    const core = this.core, gt = core.gt, b = this.ball;
    if (this.phase === "countdown"){
      this.t -= dt; const n = Math.ceil(this.t);
      if (n !== this.cdShown && n > 0){ this.cdShown = n; core.banner(-1, String(n), .8); Sfx.beep(false); }
      if (this.t <= 0){ core.banner(-1, "Go!", .7); Sfx.beep(true); this.newPoint(); }
      return;
    }
    this.botThink(gt);
    this.runPlayers(dt);
    if (this.phase === "pre"){
      this.t -= dt; this.placeServeBall();
      if (this.t <= 0){ this.phase = "toss"; this.tossT0 = gt; this.tossId++; b.v = {x:0, y:5.2, z:0}; b.s = 0; this.peakT = gt + 5.2/G; }
    } else if (this.phase === "toss"){
      b.p.y += b.v.y*dt - .5*G*dt*dt; b.v.y -= G*dt;
      if (b.p.y < 1.1 && b.v.y < 0){
        this.tosses++;
        if (this.tosses >= 4){ core.feedback(this.srv, "Auto serve", "#9aa7d6"); this.serve(this.srv, {power:.4, yaw:0, spin:0, auto:true}); }
        else { this.phase = "pre"; this.t = .5; }
      }
    } else if (this.phase === "faultwait"){
      stepBall(b, dt, null); this.t -= dt;
      if (this.t <= 0){ this.prepServe(); this.pl[this.srv].pos = {x:this.serveX(), z:side(this.srv)*(HL + .3)}; }
    } else if (this.phase === "flight"){
      const ev = []; stepBall(b, dt, ev);
      for (const e of ev) this.referee(e);
      if (this.phase === "flight" && gt - this.shotT > 6) this.point(this.bounces ? this.lastHitter : 1 - this.lastHitter, "Out!");
    } else if (this.phase === "point" || this.phase === "over"){
      stepBall(b, dt, null);
      if (this.phase === "point"){
        this.t -= dt;
        if (this.t <= 0){
          if (this.isOver()){
            this.phase = "over"; const w = this.sc[0] > this.sc[1] ? 0 : 1;
            core.finish([w, 1 - w], core.pName(w) + " wins!", core.pName(0) + " " + this.sc[0] + " – " + this.sc[1] + " " + core.pName(1));
          } else this.newPoint();
        }
      }
    }
  }
  inServeBox(x, z){
    const rs = 1 - this.lastHitter, sx = -Math.sign(this.serveX());
    return Math.sign(z) === side(rs) && Math.abs(z) <= SVC + .05 && x*sx >= -.05 && Math.abs(x) <= HW + .05;
  }
  referee(e){
    const A = this.lastHitter, B = 1 - A;
    if (e.type === "net"){ Sfx.tone(140, 90, .15, "triangle", .2); return; }
    if (e.type !== "bounce") return;
    Sfx.click(700, .25);
    this.bounces++;
    if (this.bounces === 1){
      const onB = Math.sign(e.z) === side(B);
      if (this.isServe){ if (!this.inServeBox(e.x, e.z)) return this.fault(); return; }
      if (!onB) return this.point(B, this.ball.netHit ? "Net!" : "Out!");
      if (Math.abs(e.x) > HW + .04 || Math.abs(e.z) > HL + .04) return this.point(B, "Out!");
      return;
    }
    return this.point(A, this.receiverSwung ? "Missed it!" : "Winner!");
  }
  /* where and when the receiver meets the ball after its bounce */
  predictContact(slot){
    const b = cloneBall(this.ball), ev = []; let t = 0, bounced = false;
    for (let k = 0; k < 5/STEP; k++){
      stepBall(b, STEP, ev); t += STEP;
      while (ev.length){
        const e = ev.shift();
        if (e.type === "net") return null;
        if (bounced) return null;
        bounced = true;
        if (Math.sign(e.z) !== side(slot)) return null;
        if (this.isServe ? !this.inServeBox(e.x, e.z) : (Math.abs(e.x) > HW + .04 || Math.abs(e.z) > HL + .04)) return null;
      }
      if (bounced && ((b.v.y < 0 && b.p.y < 1.0) || Math.abs(b.p.z) > HL + 3.5)) return {t:this.core.gt + t, p:{...b.p}};
    }
    return null;
  }

  /* ---------- swings ---------- */
  swing(slot, sw){
    const gt = this.core.gt, P = this.pl[slot];
    if (gt < P.cool) return;
    P.cool = gt + .35; P.swingT = gt;
    const ts = gt - (sw.lag || 0);
    if (this.srv === slot && (this.phase === "toss" || this.phase === "pre")){
      if (this.phase === "pre") return;
      return this.serve(slot, sw, ts);
    }
    if (this.phase !== "flight" || this.awaiting !== slot || !this.contact) return;
    this.receiverSwung = true;
    const tau = this.contact.t - ts;
    if (tau > EARLY || !this.bounces){ this.core.feedback(slot, "Too early!", "#ffd23f"); return; }
    if (tau < -LATE){ this.core.feedback(slot, "Too late!", "#ffd23f"); return; }
    const en = tau > 0 ? tau/EARLY : tau/LATE;
    const spin = clamp(sw.spin*.8 + clamp(-(sw.pit || 0)/45, -1, 1)*.25, -1, 1);
    let aim = clamp(sw.yaw/30, -1.2, 1.2)*.55 - en*.6;
    if (Math.abs(en) > .78) aim -= Math.sign(en)*.5;
    let depth = 5 + 6*sw.power;
    if (sw.power > .93 && spin < .2) depth += rnd(0, 2);
    const p0 = {...this.ball.p}, dir = -side(slot);
    const tgt = {x:aim*HW*.8*right(slot), y:R, z:dir*depth};
    let T = lerp(1.55, .8, sw.power)*(1 - .1*spin);
    let v = solve(p0, tgt, T, spin);
    while (!clearsNet(p0, v, spin, .12) && T < 2.6){ T += .05; v = solve(p0, tgt, T, spin); }
    this.launch(slot, v, spin, false);
    const q = Math.abs(tau);
    if (q < .05) this.core.feedback(slot, "Perfect!", "#6be38f");
    else if (Math.abs(en) > .75) this.core.feedback(slot, en > 0 ? "Early!" : "Late!", "#ffd23f");
    else this.core.feedback(slot, spin > .45 ? "Topspin!" : spin < -.45 ? "Slice!" : "Nice!", "#ffffff");
    Sfx.click(520, .5 + sw.power*.4);
  }
  serve(slot, sw, ts){
    const q = sw.auto ? 0 : Math.abs((ts == null ? this.core.gt : ts) - this.peakT);
    if (q > .55){ this.core.feedback(slot, "Missed the toss", "#ffd23f"); return; }
    const sx = -Math.sign(this.serveX()), rs = 1 - slot;
    const wide = clamp(.5 + sw.yaw/50*sx*right(slot), .1, .92);
    let tx = sx*lerp(.5, HW - .4, wide), tz = side(rs)*lerp(3.6, SVC - .5, clamp(sw.power, 0, 1));
    const err = q < .08 ? 0 : (q - .08)*(sw.power > .8 ? 9 : 6), a = Math.random()*Math.PI*2;
    tx += Math.cos(a)*err; tz += Math.sin(a)*err*1.2;
    const p0 = {...this.ball.p}, T = lerp(1.05, .62, sw.power);
    let v = solve(p0, {x:tx, y:R, z:tz}, T, 0), TT = T;
    while (!clearsNet(p0, v, 0, err > 1 ? -.2 : .08) && TT < 2){ TT += .04; v = solve(p0, {x:tx, y:R, z:tz}, TT, 0); }
    this.launch(slot, v, 0, true);
    if (!sw.auto) this.core.feedback(slot, q < .08 ? "Ace timing!" : q < .22 ? "Good serve" : "Shaky toss", q < .08 ? "#6be38f" : "#ffffff");
    Sfx.click(480, .6);
  }
  launch(slot, v, spin, isServe){
    const b = this.ball; b.v = {...v}; b.s = spin; b.netHit = false;
    this.lastHitter = slot; this.awaiting = 1 - slot; this.bounces = 0; this.isServe = isServe; this.receiverSwung = false;
    this.phase = "flight"; this.shotT = this.core.gt; this.shotId++;
    if (!this.core.pBot(slot)) this.core.pSeat(slot).hit++;
    this.contact = this.predictContact(this.awaiting);
  }
  botThink(gt){
    for (const slot of [0, 1]){
      if (!this.core.pBot(slot)) continue;
      const P = this.pl[slot];
      const mk = () => ({power:rnd(.3, 1), spin:rnd(-.4, 1), yaw:rnd(-40, 40), pit:0, lag:0});
      if (this.phase === "toss" && this.srv === slot && (!P.plan || P.plan.id !== "t" + this.tossId)) P.plan = {id:"t" + this.tossId, t:this.peakT + gauss()*.12, sw:mk()};
      if (this.phase === "flight" && this.awaiting === slot && this.contact && (!P.plan || P.plan.id !== "s" + this.shotId)) P.plan = {id:"s" + this.shotId, t:this.contact.t + gauss()*.17, sw:mk()};
      if (P.plan && !P.plan.done && gt >= P.plan.t){ P.plan.done = true; this.swing(slot, P.plan.sw); }
    }
  }
  runPlayers(dt){
    const b = this.ball;
    for (const slot of [0, 1]){
      const P = this.pl[slot], sg = side(slot);
      if (this.phase === "pre" || this.phase === "toss" || this.phase === "faultwait" || this.phase === "countdown"){ P.moving = 0; continue; }
      let tx = 0, tz = sg*(HL + .8);
      if (this.phase === "flight" && this.awaiting === slot && this.contact){
        const c = this.contact.p; P.fore = (c.x - P.pos.x)*right(slot) >= -.2;
        tx = c.x - right(slot)*(P.fore ? .75 : -.75); tz = c.z + sg*.25;
      } else if (this.phase === "flight" && this.lastHitter === slot) tx = b.p.x*.3;
      const dx = tx - P.pos.x, dz = tz - P.pos.z, d = Math.hypot(dx, dz), mv = Math.min(d, RUN*dt);
      if (d > 1e-4){ P.pos.x += dx/d*mv; P.pos.z += dz/d*mv; }
      P.moving = d > .05 ? 1 : 0;
    }
  }
  key(e){
    const k = e.key.toLowerCase(), sw = {power:.6, spin:.3, yaw:0, pit:0, lag:0, touch:true};
    if (k === "a" && this.core.pBot(0) === false) this.swing(0, sw);
    if (k === "l" && this.core.pBot(1) === false) this.swing(1, sw);
  }

  padState(slot){
    const me = this.sc[slot], them = this.sc[1 - slot], sub = `You ${me} – ${them} ${this.core.pName(1 - slot)}`, ph = this.phase;
    if (ph === "countdown") return {msg:"Get ready", sub:"Hold your phone like a racket"};
    if (ph === "pre" || ph === "toss" || ph === "faultwait") return this.srv === slot ? {msg:this.second ? "Second serve" : "Your serve", sub:"Swing at the top of the toss"} : {msg:"Their serve", sub};
    if (ph === "flight") return this.awaiting === slot ? {msg:this.bounces ? "Swing!" : "Coming at you", sub} : {msg:"Nice", sub};
    if (ph === "point") return {msg:this.lastMsg, sub};
    if (ph === "over") return {msg:me > them ? "You win!" : "You lose", sub};
    return {msg:"", sub};
  }

  draw(dt){
    const core = this.core, gt = core.gt, b = this.ball;
    this.ballMesh.position.set(b.p.x, b.p.y, b.p.z);
    this.shadow.position.set(b.p.x, .015, b.p.z);
    let glow = false;
    if (this.phase === "flight" && this.bounces && this.contact && Math.abs(this.contact.t - gt) < .1){ glow = true; this.glow.material.color.set(core.pSeat(this.awaiting).col); }
    this.glow.visible = glow; this.glow.position.copy(this.ballMesh.position);
    // landing marker for the receiver
    this.marker.visible = false;
    if (this.phase === "flight" && !this.bounces){
      const c = cloneBall(b), ev = [];
      for (let k = 0; k < 900 && !ev.length; k++) stepBall(c, 1/120, ev);
      const e = ev.find(x => x.type === "bounce");
      if (e){ this.marker.visible = true; this.marker.position.set(e.x, .02, e.z); this.marker.material.color.set(core.pSeat(this.awaiting).col); }
    }
    for (const slot of [0, 1]){
      const P = this.pl[slot], sg = side(slot), seat = core.pSeat(slot);
      const serving = (this.phase === "pre" || this.phase === "toss") && this.srv === slot;
      if (serving) P.pos = {x:this.serveX(), z:sg*(HL + .3)};
      P.buddy.position.set(P.pos.x, P.moving ? Math.abs(Math.sin(gt*14))*.08 : 0, P.pos.z);
      P.buddy.rotation.y = (slot === 0 ? Math.PI : 0) + (P.moving ? Math.sin(gt*14)*.08 : 0);
      P.buddy.userData.body.scale.y = 1 + Math.sin(gt*5 + slot)*.015;
      const u = (gt - P.swingT)/.32;
      const hand = serving ? 1 : (P.fore ? 1 : -1);
      let ang = -1.1, lift = 0;
      if (u >= 0 && u <= 1){ ang = lerp(-1.6, 1.4, 1 - Math.pow(1 - u, 2)); lift = Math.sin(u*Math.PI)*.15; }
      const rx = P.pos.x + right(slot)*hand*.62, rz = P.pos.z - sg*.05;
      if (serving && u > 1 && this.phase === "toss"){ P.racket.position.set(P.pos.x + right(slot)*.4, 1.6, P.pos.z + sg*.2); P.racket.rotation.set(sg*.9, 0, 0); }
      else {
        P.racket.position.set(rx, (serving ? 1.7 : .75) + lift, rz);
        const yawLive = seat.mo === "m" && !core.pBot(slot) ? -seat.yaw*Math.PI/180*.5 : 0;
        P.racket.rotation.set(serving ? -sg*ang*.8 : 0, (slot === 0 ? Math.PI : 0) + yawLive + ang*hand*right(slot)*-.9, serving ? 0 : -hand*right(slot)*1.25, "YXZ");
      }
      const cam = this.cams[slot];
      cam.userData.x += (P.pos.x*.45 - cam.userData.x)*Math.min(1, dt*2);
      const cz = sg*(Math.max(HL, Math.abs(P.pos.z)) + 6.2);
      cam.position.set(cam.userData.x, 4.1, cz);
      cam.lookAt(cam.userData.x*.3, .6, -sg*3.5);
    }
    for (const v of [0, 1]){
      const o = 1 - v, srv = this.phase === "countdown" ? -1 : this.srv;
      const nm = i => `<span style="color:${core.pSeat(i).col}">${esc(core.pName(i))}</span>${srv === i ? '<span class="srv"></span>' : ""}`;
      core.hudSet(v, "sb", `${nm(v)}<span class="s">${this.sc[v]}</span><span class="mute">–</span><span class="s">${this.sc[o]}</span>${nm(o)}`);
      let tip = "";
      if ((this.phase === "pre" || this.phase === "toss") && this.srv === v && !core.pBot(v)) tip = (this.second ? "Second serve: " : "Your serve: ") + "swing at the top of the toss";
      else if (this.phase === "flight" && this.awaiting === v && !core.pBot(v)) tip = this.bounces ? "Swing!" : "";
      core.hudSet(v, "tip", tip);
    }
    core.renderViews(this.scene, this.cams);
  }
  destroy(){
    this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material){ (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); } });
  }
}

registerGame({
  id:"tennis", name:"Tennis", icon:"🎾", tag:"1v1 · split screen", min:1, max:2,
  options:[{key:"to", label:"Points to win", values:[7, 4, 11]}],
  howto:"You run to the ball on your own, so just swing your phone like a racket. To serve, swing when the toss is at its highest. Early swings pull the ball across your body, late swings push it the other way, and twisting the phone aims too. Swing harder to hit deeper and faster, up through the ball for topspin, down for slice. A ring shows where the ball will land. No motion sensors? Swipe up on the phone instead.",
  pad:"Hold the phone like a racket handle, screen facing the TV, and tap Recenter. Swing as the ball reaches you.",
  season:{to:3}, seasonRules:"First to 3 points",
  create(core, opts){ return new Tennis(core, opts); }
});
})();
