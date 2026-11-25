/**
 * 纸做的自行车：轮子(纸圈+辐条)、车架(纸条)、车座、把手、曲柄踏板
 * 组装过程用"从一端长出来 / 转着圈出现"的方式折叠成形。
 */
import * as THREE from 'three';
import { easeOut, clamp, lerp } from './model.js';

export const BIKE = {
  z: -0.07,
  wheelR: 0.45,
  rear: new THREE.Vector3(-0.62, 0.45, -0.07),
  front: new THREE.Vector3(0.62, 0.45, -0.07),
  bb: new THREE.Vector3(-0.02, 0.45, -0.07),
  seat: new THREE.Vector3(-0.28, 0.88, -0.07),
  bar: new THREE.Vector3(0.60, 0.94, -0.07),
  crankR: 0.15,
  pedalZ: 0.075,
};

export function buildBike(material, lineMat) {
  const group = new THREE.Group();
  const items = [];
  const add = (obj) => { group.add(obj); return obj; };

  /* ---------- 纸条 (从一端生长) ---------- */
  function strip(a, b, w = 0.055, th = 0.02, t0 = 0, dur = 0.5, mat = material) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, len, th), mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    add(mesh);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    const item = {
      obj: mesh, t0, dur,
      apply(e) {
        const s = 0.02 + 0.98 * e;
        mesh.quaternion.copy(q);
        mesh.scale.set(1, s, 1);
        mesh.position.copy(a).addScaledVector(dir, (len * s) / 2);
        mesh.visible = e > 0.001;
      },
    };
    items.push(item);
    return item;
  }

  /* ---------- 车轮 ---------- */
  function wheel(center, t0) {
    const g = new THREE.Group();
    g.position.copy(center);
    add(g);
    const spoke = new THREE.Group();
    g.add(spoke);
    const R = BIKE.wheelR;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.028, 4, 44), material);
    rim.castShadow = true; rim.receiveShadow = true;
    spoke.add(rim);
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.012, R * 1.86, 0.014), material);
      s.castShadow = true;
      s.rotation.z = (i / 10) * Math.PI * 2;
      spoke.add(s);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.07, 8), material);
    hub.rotation.x = Math.PI / 2;
    hub.castShadow = true;
    spoke.add(hub);
    items.push({
      obj: g, t0, dur: 0.7,
      apply(e) {
        const s = clamp(e * 1.6, 0.001, 1);
        g.scale.setScalar(s);
        g.visible = e > 0.001;
      },
    });
    return { group: g, spin: spoke };
  }

  const rearW = wheel(BIKE.rear, 0.0);
  const frontW = wheel(BIKE.front, 0.18);

  /* ---------- 车架 ---------- */
  const { bb, seat, bar, rear, front } = BIKE;
  strip(rear, bb, 0.055, 0.02, 0.05, 0.45);                    // 后下叉
  strip(rear, seat.clone().add(new THREE.Vector3(0, -0.06, 0)), 0.045, 0.02, 0.1, 0.45); // 后上叉
  strip(bb, seat.clone().add(new THREE.Vector3(0, -0.08, 0)), 0.055, 0.02, 0.15, 0.45); // 座管
  strip(seat.clone().add(new THREE.Vector3(0, -0.08, 0)), bar, 0.05, 0.02, 0.25, 0.45);  // 上管
  strip(bb, bar, 0.055, 0.02, 0.3, 0.45);                       // 下管
  strip(front, bar, 0.05, 0.02, 0.4, 0.45);                     // 前叉

  /* ---------- 车座 ---------- */
  {
    const shape = new THREE.Shape();
    shape.moveTo(-0.16, 0.03); shape.lineTo(0.13, 0.055);
    shape.lineTo(0.16, -0.01); shape.lineTo(-0.13, -0.045);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false });
    geo.translate(0, 0, -0.015);
    const m = new THREE.Mesh(geo, material);
    m.position.copy(seat); m.castShadow = true; m.receiveShadow = true;
    add(m);
    items.push({
      obj: m, t0: 0.35, dur: 0.4,
      apply(e) { m.scale.setScalar(clamp(e * 1.5, 0.001, 1)); m.visible = e > 0.001; },
    });
  }

  /* ---------- 把手 ---------- */
  {
    const barG = new THREE.Group();
    barG.position.copy(bar);
    add(barG);
    const hb = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.36, 8), material);
    hb.rotation.z = Math.PI / 2;
    hb.castShadow = true;
    barG.add(hb);
    for (const sx of [-0.16, 0.16]) {
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.09, 8), material);
      grip.rotation.z = Math.PI / 2;
      grip.position.x = sx;
      grip.castShadow = true;
      barG.add(grip);
    }
    items.push({
      obj: barG, t0: 0.5, dur: 0.4,
      apply(e) {
        const s = clamp(e * 1.5, 0.001, 1);
        barG.scale.set(s, s, s);
        barG.visible = e > 0.001;
      },
    });
  }

  /* ---------- 曲柄 + 踏板 ---------- */
  const crank = new THREE.Group();
  crank.position.copy(bb);
  add(crank);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.014, 4, 20), material);
  crank.add(ring);
  const pedals = [];
  for (const [side, phase] of [[1, 0], [-1, Math.PI]]) {
    const armG = new THREE.Group();
    armG.rotation.z = phase;
    crank.add(armG);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.035, BIKE.crankR * 2, 0.022), material);
    arm.castShadow = true;
    armG.add(arm);
    const ped = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.022, 0.055), material);
    ped.position.set(0, -BIKE.crankR, side * 0.02);
    ped.castShadow = true;
    armG.add(ped);
    pedals.push({ obj: ped, side, armG });
  }
  items.push({
    obj: crank, t0: 0.55, dur: 0.4,
    apply(e) { crank.scale.setScalar(clamp(e * 1.5, 0.001, 1)); crank.visible = e > 0.001; },
  });

  /* ---------- 组装动画 ---------- */
  function setTime(t) {
    for (const it of items) {
      const e = easeOut(clamp((t - it.t0) / it.dur, 0, 1));
      it.apply(e);
    }
  }
  setTime(-1);

  /** 踏板在世界坐标里的位置 */
  function pedalPos(i, angle) {
    const phase = angle + (i === 0 ? 0 : Math.PI);
    const p = bb.clone();
    p.x += Math.cos(phase) * BIKE.crankR;
    p.y += Math.sin(phase) * BIKE.crankR;
    p.z += (i === 0 ? 1 : -1) * BIKE.pedalZ;
    p.x += Math.sin(phase) * 0.02;
    return p;
  }

  function setRide(angle) {
    crank.rotation.z = angle;
    for (const p of pedals) p.armG.rotation.z = angle + (p.side === 1 ? 0 : Math.PI);
  }

  function spinWheels(rot) {
    rearW.spin.rotation.z = rot;
    frontW.spin.rotation.z = rot * 1.0;
  }

  return { group, items, setTime, setRide, pedalPos, spinWheels, crank, rearW, frontW };
}
