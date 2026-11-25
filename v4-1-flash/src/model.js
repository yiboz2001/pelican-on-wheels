/**
 * 折纸引擎 (origami paper engine)
 * ------------------------------------------------------------------
 * 一张正方形纸被分成若干"纸片"。每片纸是刚性多边形，随关键帧做刚体运动：
 *   状态 = { to:{u,v} 锚点位置, y 层高, q 姿态四元数, su/sv 局部缩放 }
 *
 * 纸面坐标系 (paper frame)
 *   u : 向右   (+u → world +X)
 *   v : 屏幕向下 (+v → world -Y，立起之后)
 *   y : 纸面法线 (+y → world +Z，朝向观察者)
 *
 * 关键操作
 *   fold(group, line, angle)  绕纸面上一条直线折 (真实 3D 旋转 + 层高累加)
 *   unfold(piece, target)     把纸片从折好的状态"拉"到最终造型
 */
import * as THREE from 'three';

export const T = 0.014;        // 纸张厚度
export const SHEET = 1.0;      // 半边长：纸面 u,v ∈ [-SHEET, SHEET]
export const DEG = Math.PI / 180;

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);

export function rot2(p, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return { u: p.u * c - p.v * s, v: p.u * s + p.v * c };
}
export function rotateAbout(p, c, a) {
  const d = rot2({ u: p.u - c.u, v: p.v - c.v }, a);
  return { u: c.u + d.u, v: c.v + d.v };
}
export function polyArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    s += p.u * q.v - q.u * p.v;
  }
  return Math.abs(s) / 2;
}
export function polyCentroid(poly) {
  let a = 0, cu = 0, cv = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const cr = p.u * q.v - q.u * p.v;
    a += cr; cu += (p.u + q.u) * cr; cv += (p.v + q.v) * cr;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-9) return { u: poly[0].u, v: poly[0].v };
  return { u: cu / (6 * a), v: cv / (6 * a) };
}
export function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.v > p.v) !== (b.v > p.v) && p.u < ((b.u - a.u) * (p.v - a.v)) / (b.v - a.v) + a.u) inside = !inside;
  }
  return inside;
}

/* ------------------------------------------------------------------ */
/** 由 (平面内旋转 a, 出平面翻折 tilt, 翻转 flip) 构造姿态四元数 */
export function orient({ a = 0, tiltAxis = { u: 1, v: 0 }, tiltAngle = 0, flip = false } = {}) {
  const q = new THREE.Quaternion();
  if (flip) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI));
  q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a * DEG));
  if (tiltAngle) {
    const ax = new THREE.Vector3(tiltAxis.u, 0, tiltAxis.v);
    if (ax.lengthSq() < 1e-12) ax.set(1, 0, 0);
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(ax.normalize(), tiltAngle * DEG));
  }
  return q;
}

/* ------------------------------------------------------------------ */
export class Piece {
  constructor(model, def) {
    this.model = model;
    this.role = def.role;
    this.idx = model.pieces.length;
    this.flat = def.flat.map(([u, v]) => ({ u, v }));
    this.anchor = { u: def.anchor[0], v: def.anchor[1] };
    this.keys = [];
    this.overlay = null;
    this.hidden = false;

    const shape = new THREE.Shape(this.flat.map((p) => new THREE.Vector2(p.u, p.v)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: false, curveSegments: 1 });
    geo.rotateX(Math.PI / 2);
    geo.translate(0, T, 0);
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, model.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 24), model.lineMat);
    this.mesh.add(this.edges);

    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    this.group.add(this.mesh);
    model.root.add(this.group);

    this.centroid = polyCentroid(this.flat);
    this.area = polyArea(this.flat);
    // 层号：每折一次加一层；命名纸片比补片略高一点，避免平铺时 z-fighting
    this.eps = def.role === 'filler' ? 0 : 0.35;
    this.layer = 0;
    this.state = this.flatState();
    this.apply(this.state);
  }

  layerY(layer = this.layer) { return (layer + this.eps) * T; }
  flatState() {
    return { to: { u: this.anchor.u, v: this.anchor.v }, y: this.layerY(), q: new THREE.Quaternion(), su: 1, sv: 1 };
  }

  key(t, st) {
    this.keys.push({ t, ...cloneState(st) });
    this.keys.sort((p, q) => p.t - q.t);
  }
  /** 以当前状态为起点记录关键帧 */
  keyNow(t, patch) {
    const st = Object.assign(cloneState(this.state), patch);
    this.key(t, st);
    this.state = st;
    return st;
  }

  setTime(t) {
    const k = this.keys;
    if (!k.length) return;
    let st;
    if (t <= k[0].t) st = k[0];
    else if (t >= k[k.length - 1].t) st = k[k.length - 1];
    else {
      let i = 0;
      while (i < k.length - 2 && t > k[i + 1].t) i++;
      const A = k[i], B = k[i + 1];
      const s = clamp((t - A.t) / Math.max(1e-6, B.t - A.t), 0, 1);
      st = {
        to: { u: lerp(A.to.u, B.to.u, s), v: lerp(A.to.v, B.to.v, s) },
        y: lerp(A.y, B.y, s),
        q: A.q.clone().slerp(B.q, s),
        su: lerp(A.su, B.su, s),
        sv: lerp(A.sv, B.sv, s),
      };
    }
    if (this.overlay) st = this.overlay(st);
    this.apply(st);
  }

  apply(st) {
    this.state = st;
    const M = new THREE.Matrix4().makeTranslation(st.to.u, st.y, st.to.v);
    M.multiply(new THREE.Matrix4().makeRotationFromQuaternion(st.q));
    M.multiply(new THREE.Matrix4().makeScale(st.su, 1, st.sv));
    M.multiply(new THREE.Matrix4().makeTranslation(-this.anchor.u, 0, -this.anchor.v));
    this.group.matrix.copy(M);
    this.group.matrixWorldNeedsUpdate = true;
  }
}

function cloneState(s) {
  return { to: { u: s.to.u, v: s.to.v }, y: s.y, q: s.q.clone(), su: s.su, sv: s.sv };
}

/* ------------------------------------------------------------------ */
export class PaperModel {
  constructor() {
    this.root = new THREE.Group();
    this.pieces = [];
    this.material = new THREE.MeshStandardMaterial({
      color: 0xfffdf6, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide,
    });
    this.lineMat = new THREE.LineBasicMaterial({ color: 0xcbbfa8, transparent: true, opacity: 0.5 });
  }

  addPiece(def) {
    const p = new Piece(this, def);
    this.pieces.push(p);
    return p;
  }
  get(role) { return this.pieces.find((p) => p.role === role); }
  all(role) { return this.pieces.filter((p) => p.role === role); }

  /** 自动补齐残留区域，使纸片平铺正好铺满整张方纸 */
  addFillers(maxW = 0.6, maxH = 0.5, step = 0.05) {
    const n = Math.round((2 * SHEET) / step);
    const grid = new Uint8Array(n * n);
    const named = this.pieces.filter((p) => p.role !== 'filler');
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const p = { u: -SHEET + (i + 0.5) * step, v: -SHEET + (j + 0.5) * step };
        for (const pc of named) if (pointInPoly(p, pc.flat)) { grid[j * n + i] = 1; break; }
      }
    }
    const rects = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        if (grid[j * n + i]) continue;
        let w = 1;
        while (i + w < n && !grid[j * n + i + w] && w * step < maxW) w++;
        let h = 1;
        outer: while (j + h < n && h * step < maxH) {
          for (let k = 0; k < w; k++) if (grid[(j + h) * n + i + k]) break outer;
          h++;
        }
        for (let b = 0; b < h; b++) for (let a = 0; a < w; a++) grid[(j + b) * n + i + a] = 1;
        rects.push({ i0: i, j0: j, w, h });
      }
    }
    const fillers = [];
    for (const r of rects) {
      const u0 = -SHEET + r.i0 * step, v0 = -SHEET + r.j0 * step;
      const u1 = u0 + r.w * step, v1 = v0 + r.h * step;
      if ((u1 - u0) * (v1 - v0) < 0.002) continue;
      fillers.push(this.addPiece({
        role: 'filler',
        flat: [[u0, v0], [u1, v0], [u1, v1], [u0, v1]],
        anchor: [(u0 + u1) / 2, (v0 + v1) / 2],
      }));
    }
    return fillers;
  }

  validateTiling(step = 0.02) {
    const n = Math.round((2 * SHEET) / step);
    let cov = 0, over = 0, tot = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const p = { u: -SHEET + (i + 0.5) * step, v: -SHEET + (j + 0.5) * step };
        let c = 0;
        for (const pc of this.pieces) if (!pc.hidden && pointInPoly(p, pc.flat)) c++;
        tot++;
        if (c >= 1) cov++;
        if (c >= 2) over++;
      }
    }
    return { covered: (100 * cov) / tot, overlap: (100 * over) / tot, pieces: this.pieces.length };
  }

  setTime(t) { for (const p of this.pieces) if (!p.hidden) p.setTime(t); }
  areaSum() { return this.pieces.reduce((s, p) => s + p.area, 0); }
}

/* ------------------------------------------------------------------ */
/**
 * 绕纸面上一条直线折纸。pieces 是要被折的那一叠纸。
 *   line: { p0:{u,v}, p1:{u,v} }   折痕
 *   angle: 折叠角度(度)，正负号自动决定"向上折"
 *   t0,t1 : 时间区间；yAdd: 折完之后的层高补偿
 */
export function foldPieces(pieces, line, angle, t0, t1, _unused = 0, samples = 7) {
  const dir = new THREE.Vector3(line.p1.u - line.p0.u, 0, line.p1.v - line.p0.v).normalize();
  const start = pieces.map((p) => cloneState(p.state));
  // 折轴放在"静止纸层之上"，折过去正好叠在上面（纸有厚度，用整数层号记）
  const statMax = statLayerMax(pieces);
  const dL = statMax + 1;
  const h = dL * T;
  const P = new THREE.Vector3(line.p0.u, h, line.p0.v);

  // 折的方向：让纸片先"抬高"
  const nrm = new THREE.Vector3(-dir.z, 0, dir.x);
  const mid = pieces.reduce((s, p) => {
    s.x += p.state.to.u; s.z += p.state.to.v; return s;      // 用当前位置判断在折痕哪一侧
  }, { x: 0, z: 0 });
  mid.x /= pieces.length; mid.z /= pieces.length;
  const s = rel0(mid, P, nrm);
  const phi = (s >= 0 ? -1 : 1) * angle * DEG;

  for (const p of pieces) p.key(t0, p.state);                // 保持：动画开始前不动
  const rot = new THREE.Quaternion().setFromAxisAngle(dir, phi);
  const arcEnd = start.map((st0) => {
    const A = new THREE.Vector3(st0.to.u, st0.y, st0.to.v);
    return A.sub(P).applyQuaternion(rot).add(P).y;
  });
  const yEnd = pieces.map((p) => p.layerY(p.layer + dL));

  for (let k = 1; k <= samples; k++) {
    const t = k / samples;
    const e = easeInOut(t);
    const tt = t0 + (t1 - t0) * t;
    const q = new THREE.Quaternion().setFromAxisAngle(dir, phi * e);
    pieces.forEach((p, i) => {
      const st0 = start[i];
      const A = new THREE.Vector3(st0.to.u, st0.y, st0.to.v);
      A.sub(P).applyQuaternion(q).add(P);
      p.key(tt, {
        to: { u: A.x, v: A.z }, y: A.y + (yEnd[i] - arcEnd[i]) * e,
        q: q.clone().multiply(st0.q), su: st0.su, sv: st0.sv,
      });
    });
  }
  pieces.forEach((p, i) => { p.layer += dL; p.state = cloneState(p.keys[p.keys.length - 1]); });
}

function rel0(mid, P, nrm) {
  return (mid.x - P.x) * nrm.x + (mid.z - P.z) * nrm.z;
}
/** 没被折的纸片中的最大层号 */
function statLayerMax(moving) {
  const set = new Set(moving);
  let m = 0;
  for (const p of moving[0].model.pieces) if (!set.has(p)) m = Math.max(m, p.layer);
  return m;
}

/** 把纸片从当前位置"拉/翻"到最终造型 */
export function unfoldPiece(piece, target, t0, t1, samples = 6) {
  const st0 = cloneState(piece.state);
  const hinge = { u: st0.to.u, v: st0.to.v };
  // 平面内角度差
  const e0 = new THREE.Euler().setFromQuaternion(st0.q, 'YXZ');
  const e1 = new THREE.Euler().setFromQuaternion(target.q, 'YXZ');
  const da = e1.y - e0.y;
  const arcEnd = rotateAbout(st0.to, hinge, -da); // rotation.y = -a ⇒ 平面内角度 a 变化 -da
  const shift = { u: target.to.u - arcEnd.u, v: target.to.v - arcEnd.v };
  piece.key(t0, st0);                             // 保持：动画开始前不动
  for (let k = 1; k <= samples; k++) {
    const t = k / samples;
    const e = easeInOut(t);
    const p0 = rotateAbout(st0.to, hinge, -da * e);
    piece.key(t0 + (t1 - t0) * t, {
      to: { u: p0.u + shift.u * e, v: p0.v + shift.v * e },
      y: lerp(st0.y, target.y, e),
      q: st0.q.clone().slerp(target.q, e),
      su: target.su, sv: target.sv,
    });
  }
  piece.state = cloneState(piece.keys[piece.keys.length - 1]);
}
