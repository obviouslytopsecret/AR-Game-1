/* Pocket Sports: Ping Pong. 1v1, split screen, phones swing as paddles. */
(function(){
"use strict";
const HL = 1.37, HW = .7625, H = .76, NET_H = .1525, NETTOP = H + NET_H, R = .025;
const G = 6.2, SPIN_G = 3.0, E = .86, HITZ = 1.55, STEP = 1/240;
const EARLY = .26, LATE = .2;           // swing window around the contact moment (seconds)
const side = s => s === 0 ? 1 : -1;     // seat 0 stands at +z (left view), seat 1 at -z (right view)
const right = s => s === 0 ? 1 : -1;    // world x of each player's right hand
const rnd = (a, b) => a + Math.random()*(b - a);
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / .5;

/* ---------- ball physics (shared by play, prediction and shot solving) ---------- */
function stepBall(b, dt, ev){
  const ay = -(G + SPIN_G*b.s), p = b.p, v = b.v, oz = p.z, oy = p.y;
  p.x += v.x*dt; p.y += v.y*dt + .5*ay*dt*dt; p.z += v.z*dt; v.y += ay*dt;
  if (!b.netHit && (oz > 0) !== (p.z > 0) && Math.abs(p.x) < HW + .16){
    const f = oz/(oz - p.z), yc = oy + (p.y - oy)*f;
    if (yc < NETTOP + R && yc > H - .02){
      b.netHit = true; p.z = oz > 0 ? R : -R; v.z = -v.z*.12; v.x *= .4; v.y = Math.min(v.y, 0)*.3; b.s = 0;
      ev && ev.push({type:"net"});
    }
  }
  if (v.y < 0 && p.y < H + R && oy >= H + R - 1e-6 && Math.abs(p.x) <= HW && Math.abs(p.z) <= HL){
    p.y = H + R + (H + R - p.y)*E;
    v.y = -v.y*E*(1 - .12*b.s); v.z *= 1 + .14*b.s; b.s *= .5;
    ev && ev.push({type:"table", side:p.z > 0 ? 0 : 1, x:p.x, z:p.z});
  }
  if (p.y < R && v.y < 0){ p.y = R; v.y = -v.y*.45; v.x *= .7; v.z *= .7; b.s = 0; ev && ev.push({type:"floor"}); }
}
const cloneBall = b => ({p:{...b.p}, v:{...b.v}, s:b.s, netHit:b.netHit});
function solve(p0, t, T, s){ const ay = -(G + SPIN_G*s); return {x:(t.x - p0.x)/T, y:(t.y - p0.y - .5*ay*T*T)/T, z:(t.z - p0.z)/T}; }
function clearsNet(p0, v, s){
  if (Math.abs(v.z) < 1e-6) return false;
  const tn = -p0.z / v.z; if (tn <= 0) return true;
  const ay = -(G + SPIN_G*s); return p0.y + v.y*tn + .5*ay*tn*tn > NETTOP + R + .03;
}

class PingPong {
  constructor(core, opts){
    this.core = core; this.to = +opts.to || 11; this.views = 2;
    const scene = this.scene = new THREE.Scene();
    core.makeRoom(scene, {sky:0x1a2350, fogNear:9, fogFar:24});
    this.buildArena();
    this.ball = {p:{x:0, y:H + .2, z:1.5}, v:{x:0, y:0, z:0}, s:0, netHit:false};
    this.cams = [0, 1].map(i => { const c = new THREE.PerspectiveCamera(52, 1, .05, 60); c.userData.x = 0; return c; });
    this.pl = [0, 1].map(i => {
      const buddy = core.makeBuddy(core.pSeat(i).col); buddy.rotation.y = i === 0 ? Math.PI : 0; scene.add(buddy);
      const paddle = this.makePaddle(); scene.add(paddle);
      const pos = {x:0, y:H + .2, z:side(i)*1.65};
      return {buddy, paddle, pos, swingT:-9, swingDir:1, swingSpin:0, cool:0, bodyX:0, plan:null};
    });
    this.sc = [0, 0]; this.phase = "idle"; this.t = 0; this.shotId = 0; this.lastMsg = "";
  }
  buildArena(){
    const s = this.scene, M = (c, o={}) => new THREE.MeshStandardMaterial(Object.assign({color:c, roughness:.7}, o));
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), M(0x2a3566, {roughness:.95})); floor.rotation.x = -Math.PI/2; floor.receiveShadow = true; s.add(floor);
    const court = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 9.4), M(0x8a3b3b, {roughness:.9})); court.rotation.x = -Math.PI/2; court.position.y = .002; court.receiveShadow = true; s.add(court);
    // surround barriers
    const bar = M(0x223a8f), barT = M(0xffd23f);
    const addBar = (w, x, z, ry) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, .7, .06), bar); b.position.set(x, .35, z); b.rotation.y = ry; b.castShadow = b.receiveShadow = true; s.add(b);
      const t = new THREE.Mesh(new THREE.BoxGeometry(w, .06, .07), barT); t.position.set(x, .69, z); t.rotation.y = ry; s.add(t); };
    addBar(5.6, 0, -4.7, 0); addBar(5.6, 0, 4.7, 0); addBar(9.4, -2.8, 0, Math.PI/2); addBar(9.4, 2.8, 0, Math.PI/2);
    // table
    const top = new THREE.Mesh(new THREE.BoxGeometry(HW*2, .03, HL*2), M(0x1f5fbf, {roughness:.45})); top.position.y = H - .015; top.castShadow = top.receiveShadow = true; s.add(top);
    const white = M(0xffffff, {roughness:.5}), line = (w, d, x, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, .002, d), white); m.position.set(x, H + .001, z); m.receiveShadow = true; s.add(m); };
    line(.02, HL*2, -HW + .01, 0); line(.02, HL*2, HW - .01, 0); line(HW*2, .02, 0, -HL + .01); line(HW*2, .02, 0, HL - .01); line(.006, HL*2, 0, 0);
    const dark = M(0x222633);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]){ const l = new THREE.Mesh(new THREE.BoxGeometry(.05, H - .03, .05), dark); l.position.set(sx*(HW - .12), (H - .03)/2, sz*(HL - .25)); l.castShadow = true; s.add(l); }
    const frame = new THREE.Mesh(new THREE.BoxGeometry(HW*2 - .1, .06, HL*2 - .1), dark); frame.position.y = H - .06; s.add(frame);
    // net
    const net = new THREE.Mesh(new THREE.PlaneGeometry(HW*2 + .3, NET_H), new THREE.MeshStandardMaterial({color:0x0c1430, transparent:true, opacity:.6, side:THREE.DoubleSide}));
    net.position.set(0, H + NET_H/2, 0); s.add(net);
    const tape = new THREE.Mesh(new THREE.BoxGeometry(HW*2 + .3, .016, .01), white); tape.position.set(0, NETTOP - .008, 0); s.add(tape);
    for (const sx of [-1, 1]){ const post = new THREE.Mesh(new THREE.BoxGeometry(.025, NET_H + .02, .03), dark); post.position.set(sx*(HW + .15), H + NET_H/2, 0); s.add(post); }
    // ball + glow
    this.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(R*1.25, 20, 14), new THREE.MeshStandardMaterial({color:0xfff2dc, emissive:0x3a2a10, roughness:.35}));
    this.ballMesh.castShadow = true; s.add(this.ballMesh);
    this.glow = new THREE.Mesh(new THREE.SphereGeometry(R*2.6, 16, 12), new THREE.MeshBasicMaterial({color:0xffd23f, transparent:true, opacity:.35, depthWrite:false}));
    s.add(this.glow);
  }
  makePaddle(){
    const g = new THREE.Group();
    const red = new THREE.Mesh(new THREE.CylinderGeometry(.082, .082, .007, 28), new THREE.MeshStandardMaterial({color:0xd8262b, roughness:.6}));
    red.rotation.x = Math.PI/2; red.position.z = .0035; red.castShadow = true; g.add(red);
    const blk = new THREE.Mesh(new THREE.CylinderGeometry(.082, .082, .007, 28), new THREE.MeshStandardMaterial({color:0x15151c, roughness:.6}));
    blk.rotation.x = Math.PI/2; blk.position.z = -.0035; g.add(blk);
    const h = new THREE.Mesh(new THREE.BoxGeometry(.028, .1, .022), new THREE.MeshStandardMaterial({color:0xc9935a, roughness:.8})); h.position.y = -.12; h.castShadow = true; g.add(h);
    return g;
  }
  fitCamera(cam){ cam.fov = clamp(2*Math.atan(Math.tan(25*Math.PI/180)/cam.aspect)*180/Math.PI, 34, 72); }

  /* ---------- match flow ---------- */
  begin(){
    this.sc = [0, 0]; this.first = Math.random() < .5 ? 0 : 1;
    this.phase = "countdown"; this.t = 3; this.cdShown = 0;
  }
  server(){
    const n = this.sc[0] + this.sc[1], to = this.to;
    if (to >= 11 && n >= 2*(to - 1)) return (this.first + (to - 1) + (n - 2*(to - 1))) % 2;
    return (this.first + Math.floor(n/2)) % 2;
  }
  newPoint(){
    this.srv = this.server(); this.phase = "pre"; this.t = .9; this.tosses = 0;
    this.awaiting = -1; this.landed = false; this.needOwn = false; this.contact = null; this.lastHitter = -1;
    this.ball.v = {x:0, y:0, z:0}; this.ball.s = 0; this.ball.netHit = false;
    this.placeServeBall();
    for (const p of this.pl) p.plan = null;
  }
  placeServeBall(){ const s = this.srv; Object.assign(this.ball.p, {x:right(s)*.22, y:H + .12, z:side(s)*(HL + .12)}); }
  isOver(){
    const [a, b] = this.sc, to = this.to, lead = Math.abs(a - b);
    return (a >= to || b >= to) && (to < 11 || lead >= 2);
  }
  point(w, reason){
    if (this.phase !== "flight") return;
    this.sc[w]++; this.phase = "point"; this.t = 1.8; this.awaiting = -1; this.contact = null;
    const core = this.core;
    if (!core.pBot(w)) core.pSeat(w).pt++;
    this.lastMsg = reason;
    core.banner(-1, `${esc(reason)}<small>Point ${esc(core.pName(w))}</small>`, 1.6);
    Sfx.chime(true);
  }
  step(dt){
    const core = this.core, gt = core.gt, b = this.ball;
    if (this.phase === "countdown"){
      this.t -= dt;
      const n = Math.ceil(this.t);
      if (n !== this.cdShown && n > 0){ this.cdShown = n; core.banner(-1, String(n), .8); Sfx.beep(false); }
      if (this.t <= 0){ core.banner(-1, "Go!", .7); Sfx.beep(true); this.newPoint(); }
      return;
    }
    this.botThink(gt);
    if (this.phase === "pre"){
      this.t -= dt; this.placeServeBall();
      if (this.t <= 0){ this.phase = "toss"; this.tossT0 = gt; this.tossId = (this.tossId||0) + 1; b.v = {x:0, y:2.1, z:0}; b.s = 0; }
    } else if (this.phase === "toss"){
      b.p.y += b.v.y*dt - .5*G*dt*dt; b.v.y -= G*dt;
      if (b.p.y < H + .02 && b.v.y < 0){
        this.tosses++;
        if (this.tosses >= 4){ this.serve(this.srv, {power:.35, spin:0, yaw:0, pit:0}); this.core.feedback(this.srv, "Auto serve", "#9aa7d6"); }
        else { this.phase = "pre"; this.t = .6; }
      }
    } else if (this.phase === "flight"){
      const ev = []; stepBall(b, dt, ev);
      for (const e of ev) this.referee(e);
      if (this.phase === "flight" && gt - this.shotT > 5) this.point(this.landed ? this.lastHitter : 1 - this.lastHitter, "Out!");
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
  referee(e){
    const A = this.lastHitter, B = 1 - A;
    if (e.type === "table"){
      Sfx.click(2200, .22);
      if (this.needOwn){ if (e.side === A){ this.needOwn = false; return; } return this.point(B, "Fault!"); }
      if (!this.landed){ if (e.side === B){ this.landed = true; return; } return this.point(B, "Wrong side!"); }
      return this.point(A, e.side === B ? "Two bounces!" : "Point!");
    }
    if (e.type === "net"){ Sfx.tone(160, 90, .12, "triangle", .2); return; }
    if (e.type === "floor"){
      if (this.needOwn) return this.point(B, "Fault!");
      if (!this.landed) return this.point(B, this.ball.netHit ? "Net!" : "Out!");
      return this.point(A, "Missed it!");
    }
  }
  /* where and when `slot` should meet the ball (null if it never comes to them legally) */
  predictContact(slot){
    const b = cloneBall(this.ball); let landed = this.landed && this.awaiting === slot, needOwn = this.needOwn, t = 0;
    const ev = [];
    for (let k = 0; k < 3/STEP; k++){
      const prev = {...b.p};
      stepBall(b, STEP, ev); t += STEP;
      while (ev.length){
        const e = ev.shift();
        if (e.type === "floor") return null;
        if (e.type !== "table") continue;
        if (needOwn){ needOwn = false; continue; }
        if (!landed){ if (e.side === slot){ landed = true; continue; } return null; }
        return {t:this.core.gt + t - STEP, p:prev};
      }
      if (landed && ((Math.abs(b.p.z) >= HITZ && Math.sign(b.p.z) === side(slot) && Math.abs(b.v.z) > .01 && Math.sign(b.v.z) === side(slot)) || (b.v.y < 0 && b.p.y < H + .2 && Math.sign(b.p.z) === side(slot))))
        return {t:this.core.gt + t, p:{...b.p}};
    }
    return null;
  }

  /* ---------- swings ---------- */
  swing(slot, sw){
    const gt = this.core.gt, P = this.pl[slot];
    if (gt < P.cool) return;
    P.cool = gt + .3; P.swingT = gt; P.swingSpin = sw.spin;
    P.swingDir = (this.ball.p.x - P.pos.x)*right(slot) >= -.05 ? 1 : -1;
    const ts = gt - (sw.lag || 0);
    if ((this.phase === "toss" || this.phase === "pre") && this.srv === slot){
      if (this.phase === "pre") return; // ball not up yet
      return this.serve(slot, sw);
    }
    if (this.phase !== "flight" || this.awaiting !== slot || !this.contact) return;
    const tau = this.contact.t - ts;
    if (tau > EARLY || !this.landed){ this.core.feedback(slot, "Too early!", "#ffd23f"); return; }
    if (tau < -LATE){ this.core.feedback(slot, "Too late!", "#ffd23f"); return; }
    if (Math.abs(this.ball.p.z) < .2){ return; }
    const en = tau > 0 ? tau/EARLY : tau/LATE; // +1 very early, -1 very late
    const spin = clamp(sw.spin*.75 + clamp(-sw.pit/45, -1, 1)*.3, -1, 1);
    let aim = clamp(sw.yaw/30, -1.2, 1.2)*.6 - en*.7;
    if (Math.abs(en) > .78) aim -= Math.sign(en)*.45;
    let depth = .3 + .95*sw.power;
    if (sw.power > .95 && spin < 0) depth += .3;
    const dir = -side(slot), p0 = {...this.ball.p};
    const tgt = {x:aim*HW*.78*right(slot), y:H + R, z:dir*depth};
    let T = lerp(1.05, .55, sw.power)*(1 - .12*spin);
    let v = solve(p0, tgt, T, spin);
    while (!clearsNet(p0, v, spin) && T < 1.8){ T += .04; v = solve(p0, tgt, T, spin); }
    this.launch(slot, v, spin);
    const q = Math.abs(tau);
    if (q < .05) this.core.feedback(slot, "Perfect!", "#6be38f");
    else if (Math.abs(en) > .75) this.core.feedback(slot, en > 0 ? "Early!" : "Late!", "#ffd23f");
    else this.core.feedback(slot, spin > .45 ? "Topspin!" : spin < -.45 ? "Slice!" : "Nice!", "#ffffff");
    Sfx.click(1100, .45 + sw.power*.4);
  }
  serve(slot, sw){
    const spin = clamp((sw.spin*.75 + clamp(-sw.pit/45, -1, 1)*.3)*.5, -.5, .5);
    const aim = clamp(sw.yaw/30, -1.2, 1.2)*.7;
    const v = this.solveServe(slot, aim, sw.power, spin);
    this.launch(slot, v || solve({...this.ball.p}, {x:0, y:H + R, z:-side(slot)*.8}, .9, 0), v ? spin : 0);
    this.needOwn = !!v;
    Sfx.click(1200, .5);
  }
  solveServe(slot, aim, power, spin){
    const sg = side(slot), p0 = {...this.ball.p};
    const tx = aim*HW*.7*right(slot), tz = -sg*(.45 + .75*power);
    let best = null;
    for (const zf of [.35, .55, .75]) for (let T1 = .18; T1 <= .76; T1 += .02){
      const zb = sg*zf*HL, frac = (p0.z - zb)/(p0.z - tz), xb = p0.x + (tx - p0.x)*frac;
      const v = solve(p0, {x:xb, y:H + R, z:zb}, T1, spin);
      const b = {p:{...p0}, v:{...v}, s:spin, netHit:false}, ev = [];
      let own = false, res = null;
      for (let k = 0; k < 720 && !res; k++){
        stepBall(b, STEP, ev);
        while (ev.length && !res){
          const e = ev.shift();
          if (e.type === "table"){ if (!own){ if (e.side !== slot) res = "bad"; else own = true; } else res = e.side === slot ? "bad" : e; }
          else res = "bad";
        }
      }
      if (res && res !== "bad"){
        const err = Math.hypot(res.x - tx, res.z - tz) + (Math.abs(res.x) > HW - .04 || Math.abs(res.z) > HL - .04 ? 5 : 0);
        if (!best || err < best.err) best = {err, v};
      }
    }
    return best && best.err < 4 ? best.v : null;
  }
  launch(slot, v, spin){
    const b = this.ball; b.v = {...v}; b.s = spin; b.netHit = false;
    this.lastHitter = slot; this.awaiting = 1 - slot; this.landed = false; this.needOwn = false;
    this.phase = "flight"; this.shotT = this.core.gt; this.shotId++;
    this.contact = null;
    if (!this.core.pBot(slot)) this.core.pSeat(slot).hit++;
    // prediction runs after needOwn is settled by serve(); defer a tick
    this.needPredict = true;
  }
  botThink(gt){
    if (this.needPredict){ this.needPredict = false; this.contact = this.predictContact(this.awaiting); }
    for (const slot of [0, 1]){
      if (!this.core.pBot(slot)) continue;
      const P = this.pl[slot];
      const mk = () => ({power:rnd(.3, .98), spin:rnd(-.4, 1), yaw:rnd(-34, 34), pit:rnd(-10, 10), lag:0, touch:false});
      if (this.phase === "toss" && this.srv === slot && (!P.plan || P.plan.id !== "t" + this.tossId)) P.plan = {id:"t" + this.tossId, t:this.tossT0 + rnd(.3, .55), sw:mk()};
      if (this.phase === "flight" && this.awaiting === slot && this.contact && (!P.plan || P.plan.id !== "s" + this.shotId)) P.plan = {id:"s" + this.shotId, t:this.contact.t + gauss()*.1, sw:mk()};
      if (P.plan && !P.plan.done && gt >= P.plan.t){ P.plan.done = true; this.swing(slot, P.plan.sw); }
    }
  }
  key(e){
    const k = e.key.toLowerCase();
    const sw = {power:.6, spin:.3, yaw:0, pit:0, lag:0, touch:true};
    if (k === "a" && this.core.pBot(0) === false) this.swing(0, sw);
    if (k === "l" && this.core.pBot(1) === false) this.swing(1, sw);
  }

  /* ---------- phone status ---------- */
  padState(slot){
    const me = this.sc[slot], them = this.sc[1 - slot], sub = `You ${me} – ${them} ${this.core.pName(1 - slot)}`;
    const ph = this.phase;
    if (ph === "countdown") return {msg:"Get ready", sub:"Hold your phone like a paddle"};
    if (ph === "pre" || ph === "toss") return this.srv === slot ? {msg:"Your serve", sub:"Swing as the ball drops"} : {msg:"Their serve", sub};
    if (ph === "flight"){
      if (this.awaiting === slot) return {msg:this.landed ? "Swing!" : "Coming at you", sub};
      return {msg:"Nice", sub};
    }
    if (ph === "point") return {msg:this.lastMsg, sub};
    if (ph === "over") return {msg:me > them ? "You win!" : "You lose", sub};
    return {msg:"", sub};
  }

  /* ---------- drawing ---------- */
  draw(dt){
    const core = this.core, gt = core.gt, b = this.ball;
    this.ballMesh.position.set(b.p.x, b.p.y, b.p.z);
    // receiver's hit window glow
    let glow = false;
    if (this.phase === "flight" && this.landed && this.contact && Math.abs(this.contact.t - gt) < .1){ glow = true; this.glow.material.color.set(core.pSeat(this.awaiting).col); }
    this.glow.visible = glow; this.glow.position.copy(this.ballMesh.position);
    for (const slot of [0, 1]){
      const P = this.pl[slot], sg = side(slot), seat = core.pSeat(slot);
      let tgt = {x:0, y:H + .22, z:sg*1.7};
      if ((this.phase === "pre" || this.phase === "toss") && this.srv === slot) tgt = {x:b.p.x + right(slot)*.14, y:H + .2, z:sg*(HL + .2)};
      else if (this.phase === "flight" && this.awaiting === slot && this.contact){ const c = this.contact.p; tgt = {x:clamp(c.x, -1.3, 1.3), y:clamp(c.y, H + .05, H + .95), z:sg*clamp(Math.abs(c.z) + .05, 1.35, 2.6)}; }
      const k = Math.min(1, dt*9);
      P.pos.x += (tgt.x - P.pos.x)*k; P.pos.y += (tgt.y - P.pos.y)*k; P.pos.z += (tgt.z - P.pos.z)*k;
      // forehand when the ball is on the right of the body, backhand otherwise
      const fore = (b.p.x - P.bodyX)*right(slot) >= 0 || this.phase === "pre" || this.phase === "toss";
      const bodyT = P.pos.x - right(slot)*(fore ? .32 : -.22);
      P.bodyX += (bodyT - P.bodyX)*Math.min(1, dt*6);
      P.buddy.position.set(P.bodyX, 0, sg*(Math.abs(P.pos.z) + .45));
      P.buddy.userData.body.scale.y = 1 + Math.sin(gt*5 + slot)*.015;
      // paddle pose: face toward the opponent, tilted by the phone, plus a swing arc
      const u = (gt - P.swingT)/.28;
      let arc = 0, fwd = 0, lift = 0;
      if (u >= 0 && u <= 1){ arc = lerp(-1.1, 1.0, 1 - Math.pow(1 - u, 2)); fwd = Math.sin(u*Math.PI)*.16; lift = lerp(-.1, .12, u)*Math.sign(P.swingSpin || .01); }
      const dirSign = fore ? 1 : -1;
      P.paddle.position.set(P.pos.x, P.pos.y + lift, P.pos.z - sg*fwd);
      const yawLive = seat.mo === "m" && !core.pBot(slot) ? -seat.yaw*Math.PI/180*.6 : 0;
      const pitLive = seat.mo === "m" && !core.pBot(slot) ? -seat.pit*Math.PI/180*.6 : 0;
      P.paddle.rotation.set(pitLive*sg, (slot === 0 ? Math.PI : 0) + yawLive + arc*.9*dirSign*-1*(slot === 0 ? 1 : -1), fore ? -.35*right(slot) : .35*right(slot), "YXZ");
      // camera behind each player
      const cam = this.cams[slot];
      cam.userData.x += (P.pos.x*.35 - cam.userData.x)*Math.min(1, dt*2.5);
      cam.position.set(cam.userData.x, 1.82, sg*3.35);
      cam.lookAt(cam.userData.x*.4, .8, -sg*.45);
    }
    // hud
    for (const v of [0, 1]){
      const o = 1 - v, srv = this.phase === "countdown" ? -1 : this.srv;
      const nm = i => `<span style="color:${core.pSeat(i).col}">${esc(core.pName(i))}</span>${srv === i ? '<span class="srv"></span>' : ""}`;
      core.hudSet(v, "sb", `${nm(v)}<span class="s">${this.sc[v]}</span><span class="mute">–</span><span class="s">${this.sc[o]}</span>${nm(o)}`);
      let tip = "";
      if ((this.phase === "pre" || this.phase === "toss") && this.srv === v) tip = core.pBot(v) ? "" : "Your serve: swing as the ball drops";
      else if (this.phase === "flight" && this.awaiting === v && !core.pBot(v)) tip = this.landed ? "Swing!" : "";
      core.hudSet(v, "tip", tip);
    }
    core.renderViews(this.scene, this.cams);
  }
  destroy(){
    this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material){ (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); } });
  }
}

registerGame({
  id:"pingpong", name:"Ping Pong", icon:"🏓", tag:"1v1 · split screen", min:1, max:2,
  options:[{key:"to", label:"Points to win", values:[11, 5, 21, 3]}],
  howto:"Swing your phone like a paddle. The paddle moves to the ball for you, so you only time the swing. Early swings go left, late swings go right, and twisting the phone face aims too. Swing up through the ball for topspin, chop down for slice, swing harder to hit deeper. A yellow glow on the ball means now. No motion sensors? Swipe up on the phone instead.",
  pad:"Hold the phone like a paddle handle, screen facing the TV, and tap Recenter. Then swing when the ball reaches you.",
  season:{to:3}, seasonRules:"First to 3 points",
  create(core, opts){ return new PingPong(core, opts); }
});
})();
