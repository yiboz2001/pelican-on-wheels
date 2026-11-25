/**
 * 时间轴 + 折纸脚本装配 (与渲染无关，可以在 node 里跑)
 */
import * as THREE from 'three';
import { clamp, lerp, easeInOut, easeOut, T } from './model.js';
import { buildPelicanScript, FINAL, PELICAN } from './pelican.js';
import { buildBike } from './bike.js';

export function createTimeline(model) {
  const bike = buildBike(model.material, model.lineMat);
  const tracks = [];
  const cam = { yaw: 0, pitch: 54, dist: 4.7, tx: 0, ty: 0.05, tz: 0 };
  const camUser = { dyaw: 0, dpitch: 0, ddist: 0 };


/* ---------------- 骑行：曲柄 + 腿部 IK ---------------- */
const invRoot = new THREE.Matrix4();
const HIP = { L: { u: -0.40, v: 0.26, y: 0.035 }, R: { u: -0.36, v: 0.28, y: -0.12 } };

function placeStrip(piece, L0, from, to, k = 1) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const zAxis = dir.clone().normalize();
  let xAxis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), zAxis);
  if (xAxis.lengthSq() < 1e-8) xAxis.set(1, 0, 0);
  xAxis.normalize();
  const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
  const cur = piece.state;
  const tgt = { to: { u: from.x, v: from.z }, y: from.y, q, su: 1, sv: len / L0 };
  piece.state = k >= 1 ? tgt : {
    to: { u: lerp(cur.to.u, tgt.to.u, k), v: lerp(cur.to.v, tgt.to.v, k) },
    y: lerp(cur.y, tgt.y, k),
    q: cur.q.clone().slerp(tgt.q, k),
    su: lerp(cur.su, tgt.su, k), sv: lerp(cur.sv, tgt.sv, k),
  };
  piece.apply(piece.state);
}
function placeFoot(piece, at, q, k = 1) {
  const cur = piece.state;
  const tgt = { to: { u: at.x, v: at.z }, y: at.y, q: q.clone(), su: 1, sv: 1 };
  piece.state = k >= 1 ? tgt : {
    to: { u: lerp(cur.to.u, tgt.to.u, k), v: lerp(cur.to.v, tgt.to.v, k) },
    y: lerp(cur.y, tgt.y, k),
    q: cur.q.clone().slerp(tgt.q, k),
    su: lerp(cur.su, tgt.su, k), sv: lerp(cur.sv, tgt.sv, k),
  };
  piece.apply(piece.state);
}
function kneeOf(hip, ankle, l1, l2, bendRef) {
  const d = new THREE.Vector3().subVectors(ankle, hip);
  const dist = clamp(d.length(), 0.02, l1 + l2 - 0.01);
  const cosA = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
  const ang = Math.acos(cosA);
  const dn = d.clone().normalize();
  const axis = new THREE.Vector3().crossVectors(dn, bendRef).normalize();
  return hip.clone().add(dn.clone().applyAxisAngle(axis, ang).multiplyScalar(l1));
}

  const tl = {
    steps: [], total: 0, cam, camUser, bike, model,
    step(s) { this.steps.push(s); return s; },
    anim(t0, t1, from, to, apply, ease = easeInOut, delay = 0) {
      tracks.push({ t0, t1, from, to, apply, ease, delay });
    },
    stepIndexAt(time) {
      for (let i = 0; i < this.steps.length; i++) if (time < this.steps[i].t1 - 1e-6) return i;
      return this.steps.length - 1;
    },
  };

  function camTo(from, to, e) { for (const k in to) cam[k] = lerp(from[k], to[k], e); }

  const P = buildPelicanScript(model, tl);

  /* 折叠阶段镜头不动 */
  const FOLD_TOTAL = tl.steps.reduce((s, x) => s + x.dur, 0);
  tl.anim(0, FOLD_TOTAL, 0, 1, () => {}, easeInOut);
  const FOLD_VIEW = { yaw: 0, pitch: 54, dist: 4.7, tx: 0, ty: 0.05, tz: 0 };
  const STAND_VIEW = { yaw: 26, pitch: 20, dist: 5.1, tx: -0.05, ty: 1.05, tz: 0 };
  const RIDE_VIEW = { yaw: 27, pitch: 14, dist: 5.15, tx: -0.05, ty: 1.05, tz: 0 };

  /* 站起来 */
  tl.step({
    title: '让鹈鹕站起来',
    desc: '捏住身体两侧把折好的鹈鹕立起来 —— 一张纸，变成一只鸟。',
    dur: 1.7,
    fn(t0, t1) {
      tl.anim(t0, t1, 0, 1, (e) => {
        model.root.rotation.x = (e * Math.PI) / 2;
        model.root.position.set(0.06 * e, 1.05 * e, 0);
      }, easeInOut);
      tl.anim(t0, t1, 0, 1, (e) => camTo(FOLD_VIEW, STAND_VIEW, e), easeInOut);
    },
  });

  /* 自行车 */
  const BIKE_STEP = tl.step({
    title: '折出一辆自行车',
    desc: '另外两张纸条：卷出两只车轮，再折出车架、车座和把手。',
    dur: 2.3,
    fn(t0, t1) {
      tl.anim(t0, t1, 0, 1, (e) => camTo(STAND_VIEW, RIDE_VIEW, e), easeInOut);
    },
  });

  /* 骑上去 */
  tl.step({
    title: '鹈鹕坐上自行车',
    desc: '双脚踩上踏板，翅膀收在身上，长长的喙指向远方。',
    dur: 1.4,
    fn(t0, t1) {
      tl.anim(t0, t0 + 0.85, 0, 1, (e) => {
        model.root.position.y = lerp(1.05, 1.22, e) + Math.sin(e * Math.PI) * 0.05;
        model.root.rotation.z = Math.sin(e * Math.PI * 2) * 0.02;
      }, (x) => x);
      tl.anim(t0, t1, 0, 1, (e) => camTo(RIDE_VIEW, { yaw: 27, pitch: 14, dist: 5.15, tx: -0.05, ty: 1.05, tz: 0 }, e), easeInOut);
    },
  });

  /* 出发 */
  const RIDE_STEP = tl.step({
    title: '出发！',
    desc: '一只纸折的鹈鹕，骑着纸折的自行车，摇摇晃晃地上路了。',
    dur: 4.0,
    fn(t0) {
      tl.anim(t0, t0 + 1.5, 0, 1, (e) => {
        model.root.position.y = lerp(1.22, 1.22, e);
        model.root.rotation.z = lerp(0.009, 0, e);
      }, easeOut);
    },
  });

  let t = 0;
  for (const s of tl.steps) { s.t0 = t; s.t1 = t + s.dur; t = s.t1; if (s.fn) s.fn(s.t0, s.t1); }
  tl.total = t;
  tl.bikeStep = BIKE_STEP;
  tl.rideStep = RIDE_STEP;
  tl.P = P;

  tl.bikeTimeAt = function (time) {
    if (time < BIKE_STEP.t0) return -0.4;
    return clamp(-0.4 + ((time - BIKE_STEP.t0) / BIKE_STEP.dur) * 2.1, -0.4, 1.7);
  };

  const FOOT_Q = (function () {
    const f = FINAL.footL;
    const q = new THREE.Quaternion();
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0));
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -(f.a || 0) * Math.PI / 180));
    const ax = new THREE.Vector3(f.tilt[0], 0, f.tilt[1]).normalize();
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(ax, (f.tilt[2] || 0) * Math.PI / 180));
    return q;
  })();

  function updateLegs(angle, k = 1) {
    invRoot.copy(model.root.matrixWorld).invert();
    const defs = [
      { side: 'L', thigh: P.thighL, shin: P.shinL, foot: P.footL, pedal: bike.pedalPos(0, angle) },
      { side: 'R', thigh: P.thighR, shin: P.shinR, foot: P.footR, pedal: bike.pedalPos(1, angle) },
    ];
    for (const d of defs) {
      const hp = HIP[d.side];
      const hip = new THREE.Vector3(hp.u, hp.y, hp.v);
      const ankle = d.pedal.clone().applyMatrix4(invRoot);
      ankle.y += 0.025;
      const knee = kneeOf(hip, ankle, 0.38, 0.40, new THREE.Vector3(1, 0, 0));
      placeStrip(d.thigh, 0.38, hip, knee, k);
      placeStrip(d.shin, 0.40, knee, ankle, k);
      placeFoot(d.foot, ankle, FOOT_Q, k);
    }
  }

  tl.applyTime = function (time, rideT = 0) {
    model.setTime(time);
    const root = model.root;
    root.rotation.set(0, 0, 0);
    root.position.set(0, 0, 0);
    for (const tr of tracks) {
      if (time < tr.t0) continue;
      const e = tr.ease(clamp((time - tr.t0 - tr.delay) / Math.max(1e-6, tr.t1 - tr.t0 - tr.delay), 0, 1));
      tr.apply(lerp(tr.from, tr.to, e));
    }
    bike.setTime(tl.bikeTimeAt(time));
    if (time >= RIDE_STEP.t0 - 0.05) {
      const crank = rideT * 2.0;
      bike.setRide(crank);
      bike.spinWheels(-rideT * 3.4);
      updateLegs(crank, clamp(rideT / 0.8, 0, 1));
      const bob = Math.sin(rideT * 4.0) * 0.014;
      root.position.y += bob;
      root.rotation.z += Math.sin(rideT * 2.0) * 0.02;
      const nod = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.sin(rideT * 4.0 + 1.0) * 0.045);
      for (const role of ['neck', 'head', 'beak', 'pouch']) {
        const pc = P[role];
        pc.state.q.premultiply(nod);
        pc.apply(pc.state);
      }
    }
    tl.rideT = rideT;
    root.updateMatrixWorld(true);
  };

  return tl;
}
