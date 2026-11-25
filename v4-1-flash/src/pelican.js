/**
 * 鹈鹕的纸片分解图 (平铺 = 一张正方形纸) + 折叠脚本
 * 平铺坐标: u,v ∈ [-1,1]，v 向下 (v 小 = 立起来之后的"上方")
 * 造型坐标: 同纸面坐标系，最终鹈鹕头朝 -v，喙朝 +u
 */
import * as THREE from 'three';
import { T, DEG, unfoldPiece, foldPieces, orient, rotateAbout, clamp } from './model.js';

/* ---------------- 平铺：把方纸剪成这些纸片 ---------------- */
export const PARTS = [
  // 脖子 (细长条)
  { role: 'neck', flat: [[-1.00, -1.00], [-0.85, -1.00], [-0.85, -0.55], [-1.00, -0.55]], anchor: [-0.925, -0.55] },
  // 头
  { role: 'head', flat: [[-0.85, -1.00], [-0.55, -1.00], [-0.55, -0.75], [-0.85, -0.75]], anchor: [-0.70, -0.75] },
  // 长喙 (细长三角，尖端朝 +u)
  { role: 'beak', flat: [[-0.55, -1.00], [-0.05, -1.00], [-0.55, -0.85]], anchor: [-0.55, -0.925] },
  // 喉囊
  { role: 'pouch', flat: [[-0.55, -0.85], [-0.55, -0.60], [-0.25, -0.75]], anchor: [-0.55, -0.85] },
  // 近翅 / 远翅
  { role: 'wingNear', flat: [[-1.00, -0.55], [-0.25, -0.55], [-0.25, -0.10], [-1.00, -0.10]], anchor: [-0.25, -0.325] },
  { role: 'wingFar', flat: [[-1.00, -0.10], [-0.25, -0.10], [-0.25, 0.30], [-1.00, 0.30]], anchor: [-0.25, 0.10] },
  // 身体
  { role: 'body', flat: [[-0.20, -0.10], [0.50, -0.10], [0.50, 0.35], [-0.20, 0.35]], anchor: [0.15, 0.125] },
  // 尾羽
  { role: 'tail', flat: [[-1.00, 0.35], [-0.60, 0.35], [-1.00, 0.80]], anchor: [-0.80, 0.35] },
  // 双腿：大腿 + 小腿
  { role: 'thighL', flat: [[-0.60, 0.35], [-0.50, 0.35], [-0.50, 0.73], [-0.60, 0.73]], anchor: [-0.55, 0.35] },
  { role: 'shinL', flat: [[-0.50, 0.30], [-0.40, 0.30], [-0.40, 0.70], [-0.50, 0.70]], anchor: [-0.45, 0.30] },
  { role: 'thighR', flat: [[-0.40, 0.35], [-0.30, 0.35], [-0.30, 0.73], [-0.40, 0.73]], anchor: [-0.35, 0.35] },
  { role: 'shinR', flat: [[-0.30, 0.30], [-0.20, 0.30], [-0.20, 0.70], [-0.30, 0.70]], anchor: [-0.25, 0.30] },
  // 脚蹼
  { role: 'footL', flat: [[-0.60, 0.78], [-0.40, 0.78], [-0.50, 0.93]], anchor: [-0.50, 0.78] },
  { role: 'footR', flat: [[-0.40, 0.78], [-0.20, 0.78], [-0.30, 0.93]], anchor: [-0.30, 0.78] },
];

/* ---------------- 最终造型 (纸面坐标) ----------------
 *  to  : 锚点最终位置 [u,v]
 *  a   : 平面内旋转 (度)
 *  y   : 层高 (×T)
 *  tilt: 出平面翻折 [轴u, 轴v, 角度]
 */
export const FINAL = {
  body: { to: [-0.30, 0.05], a: 0, y: 0, tilt: [1, 0, 0] },
  neck: { to: [-0.16, -0.14], a: 12, y: 1.0, tilt: [1, 0, -8] },
  head: { to: [-0.07, -0.60], a: 22, y: 1.2, tilt: [1, 0, -10] },
  beak: { to: [0.055, -0.655], a: 10, y: 1.6, tilt: [1, 0, 10] },
  pouch: { to: [0.05, -0.635], a: 10, y: 2.0, tilt: [1, 0, -30] },
  wingNear: { to: [-0.34, -0.13], a: -30, y: 1.3, tilt: [1, 0, 15] },
  wingFar: { to: [-0.36, -0.06], a: -14, y: -1.2, tilt: [1, 0, -14] },
  tail: { to: [-0.62, 0.28], a: 130, y: 1.0, tilt: [1, 0, 22] },
  thighL: { to: [-0.44, 0.26], a: -25, y: 0.7, tilt: [0, 1, 10] },
  shinL: { to: [-0.279, 0.604], a: -12, y: 0.5, tilt: [0, 1, 10] },
  footL: { to: [-0.196, 0.995], a: 10, y: 0.5, tilt: [0, 1, 10] },
  thighR: { to: [-0.36, 0.26], a: -5, y: 0.3, tilt: [0, 1, -10] },
  shinR: { to: [-0.327, 0.639], a: 5, y: 0.1, tilt: [0, 1, -10] },
  footR: { to: [-0.362, 1.037], a: 22, y: 0.1, tilt: [0, 1, -10] },
};

export const PELICAN = {
  bodyCenter: { u: -0.30, v: 0.05 },   // 立起后应位于车座上方
  hip: { u: -0.40, v: 0.26 },          // 髋关节 (纸面)
  shoulder: { u: -0.50, v: -0.08 },    // 翅膀根部
};

/* ---------------- 工具 ---------------- */
function curCentroid(p) {
  const M = new THREE.Matrix4()
    .makeTranslation(p.state.to.u, p.state.y, p.state.to.v)
    .multiply(new THREE.Matrix4().makeRotationFromQuaternion(p.state.q))
    .multiply(new THREE.Matrix4().makeScale(p.state.su, 1, p.state.sv))
    .multiply(new THREE.Matrix4().makeTranslation(-p.anchor.u, 0, -p.anchor.v));
  const v = new THREE.Vector3(p.centroid.u, 0, p.centroid.v).applyMatrix4(M);
  return { u: v.x, v: v.z };
}

export function targetState(f) {
  return {
    to: { u: f.to[0], v: f.to[1] },
    y: (f.y || 0) * T,
    q: orient({ a: f.a || 0, tiltAxis: { u: f.tilt[0], v: f.tilt[1] }, tiltAngle: f.tilt[2] || 0 }),
    su: f.su ?? 1, sv: f.sv ?? 1,
  };
}

/* ---------------- 折叠脚本 ---------------- */
export function buildPelicanScript(model, tl) {
  const P = {};
  for (const part of PARTS) P[part.role] = model.addPiece(part);
  const fillers = model.addFillers();
  P.fillers = fillers;

  for (const p of model.pieces) p.key(0, p.flatState());

  // 眼睛：贴在头上的小纸点（跟着头一起动）
  {
    const eyeGeo = new THREE.CircleGeometry(0.028, 20);
    eyeGeo.rotateX(Math.PI / 2);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x3a3229, roughness: 0.5 });
    for (const [u, v] of [[-0.665, -0.895]]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(u, 2.2 * T, v);
      P.head.group.add(eye);
    }
  }

  const BC = PELICAN.bodyCenter;

  /* 1. 平铺 */
  tl.step({
    title: '一张正方形纸', desc: '方方正正，折痕清晰 —— 一切从这里开始。', dur: 1.0,
    fn() {},
  });

  /* 2. 下半张向上折 */
  tl.step({
    title: '第一次对折', desc: '把下半张向上折，盖住上半张。', dur: 1.1,
    fn(t0, t1) {
      const g = model.pieces.filter((p) => curCentroid(p).v > 0);
      foldPieces(g, { p0: { u: -1, v: 0 }, p1: { u: 1, v: 0 } }, 180, t0, t1, 0);
    },
  });

  /* 3. 左半张折到右边 */
  tl.step({
    title: '第二次对折', desc: '再把左半张折到右边，纸变厚了。', dur: 1.1,
    fn(t0, t1) {
      const g = model.pieces.filter((p) => curCentroid(p).u < 0);
      foldPieces(g, { p0: { u: 0, v: -1 }, p1: { u: 0, v: 1 } }, 180, t0, t1, 0);
    },
  });

  /* 4. 沿对角线折出鸟形底 */
  tl.step({
    title: '折出鸟形底', desc: '沿对角线把外角折进去，形成经典的"鸟形底"。', dur: 1.1,
    fn(t0, t1) {
      const g = model.pieces.filter((p) => { const c = curCentroid(p); return c.u + c.v > 0; });
      if (g.length) foldPieces(g, { p0: { u: 0, v: 0 }, p1: { u: 1, v: -1 } }, 180, t0, t1, 0);
    },
  });

  /* 5. 收拢成身体 */
  tl.step({
    title: '收拢成身体', desc: '把多出来的纸层一层层收进身体里，让它变厚变结实。', dur: 1.3,
    fn(t0, t1) {
      const bodyTot = targetState(FINAL.body);
      unfoldPiece(P.body, bodyTot, t0, t0 + (t1 - t0) * 0.6);
      fillers.forEach((f, i) => {
        const ang = ((i * 37) % 11) - 5;
        const off = { u: (i % 3 - 1) * 0.012, v: ((i * 7) % 3 - 1) * 0.012 };
        unfoldPiece(f, {
          to: { u: BC.u + off.u, v: BC.v + off.v },
          y: -T * (1 + i * 0.12),
          q: orient({ a: ang }),
          su: 0.07, sv: 0.07,
        }, t0 + (t1 - t0) * 0.3 * (i / Math.max(1, fillers.length)), t0 + (t1 - t0) * (0.55 + 0.45 * (i / Math.max(1, fillers.length))));
      });
    },
  });

  /* 6-10. 依次拉出各部件 */
  const limbSteps = [
    ['neck', '拉出长脖子', '从身体前方把脖子一节一节拉起来。', 1.0],
    ['head', '折出头', '脖子顶端折出小小的脑袋。', 0.8],
    ['beak', '折出长喙', '鹈鹕标志性的长喙，向前伸出。', 0.85],
    ['pouch', '折出喉囊', '喙下的大喉囊，用来装鱼。', 0.75],
  ];
  for (const [role, title, desc, dur] of limbSteps) {
    tl.step({
      title, desc, dur,
      fn(t0, t1) { unfoldPiece(P[role], targetState(FINAL[role]), t0, t1); },
    });
  }

  tl.step({
    title: '翻开双翅', desc: '两侧的纸片向外翻开，成为翅膀。', dur: 1.0,
    fn(t0, t1) {
      unfoldPiece(P.wingFar, targetState(FINAL.wingFar), t0, t0 + (t1 - t0) * 0.8);
      unfoldPiece(P.wingNear, targetState(FINAL.wingNear), t0 + (t1 - t0) * 0.2, t1);
    },
  });

  tl.step({
    title: '折出尾羽与双脚', desc: '后方展开尾羽，下面拉出一双带蹼的脚。', dur: 1.1,
    fn(t0, t1) {
      const q = (k) => t0 + (t1 - t0) * k;
      unfoldPiece(P.tail, targetState(FINAL.tail), q(0), q(0.5));
      unfoldPiece(P.thighR, targetState(FINAL.thighR), q(0.2), q(0.7));
      unfoldPiece(P.shinR, targetState(FINAL.shinR), q(0.3), q(0.8));
      unfoldPiece(P.footR, targetState(FINAL.footR), q(0.4), q(0.9));
      unfoldPiece(P.thighL, targetState(FINAL.thighL), q(0.2), q(0.7));
      unfoldPiece(P.shinL, targetState(FINAL.shinL), q(0.3), q(0.8));
      unfoldPiece(P.footL, targetState(FINAL.footL), q(0.4), q(0.9));
    },
  });

  return P;
}
