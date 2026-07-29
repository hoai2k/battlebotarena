// Tiny vector/quaternion helpers so the sim runs headless (no three.js).
// All vectors are plain {x,y,z}; quaternions are plain {x,y,z,w}.

/** @typedef {{x:number, y:number, z:number}} Vec3 */
/** @typedef {{x:number, y:number, z:number, w:number}} Quat */

/** @returns {Vec3} */
export function v3(x = 0, y = 0, z = 0) {
  return { x, y, z };
}

export function clone(a) {
  return { x: a.x, y: a.y, z: a.z };
}

export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(a, s) {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function length(a) {
  return Math.hypot(a.x, a.y, a.z);
}

export function lengthXZ(a) {
  return Math.hypot(a.x, a.z);
}

/** Normalize; returns fallback (default +y) when near zero length. */
export function norm(a, fallback = { x: 0, y: 1, z: 0 }) {
  const len = length(a);
  if (len < 1e-9) return clone(fallback);
  return scale(a, 1 / len);
}

/** Project onto the horizontal (XZ) plane and normalize; null if degenerate. */
export function flatNorm(a) {
  const len = Math.hypot(a.x, a.z);
  if (len < 1e-6) return null;
  return { x: a.x / len, y: 0, z: a.z / len };
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function lerpV3(a, b, t) {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

export function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

/** @returns {Quat} */
export function qIdentity() {
  return { x: 0, y: 0, z: 0, w: 1 };
}

export function qClone(q) {
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

/** @param {Vec3} axis unit axis @param {number} angle radians @returns {Quat} */
export function qFromAxisAngle(axis, angle) {
  const half = angle * 0.5;
  const s = Math.sin(half);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(half) };
}

/** Yaw about +Y; yaw 0 faces -Z. @returns {Quat} */
export function qFromYaw(yaw) {
  return qFromAxisAngle({ x: 0, y: 1, z: 0 }, yaw);
}

export function qMul(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

/** Rotate vector v by quaternion q. */
export function qRotate(q, v) {
  const qv = { x: q.x, y: q.y, z: q.z };
  const t = scale(cross(qv, v), 2);
  return add(v, add(scale(t, q.w), cross(qv, t)));
}

/** Rotate vector v by the inverse of unit quaternion q. */
export function qRotateInv(q, v) {
  return qRotate({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, v);
}

/** Normalized lerp between quats (good enough for 1/120s frames). @returns {Quat} */
export function qNlerp(a, b, t) {
  const sign = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1;
  const x = a.x + (b.x * sign - a.x) * t;
  const y = a.y + (b.y * sign - a.y) * t;
  const z = a.z + (b.z * sign - a.z) * t;
  const w = a.w + (b.w * sign - a.w) * t;
  const len = Math.hypot(x, y, z, w) || 1;
  return { x: x / len, y: y / len, z: z / len, w: w / len };
}

/** Yaw (rotation about +Y) encoded in q; yaw 0 faces -Z. */
export function yawFromQuat(q) {
  const f = qRotate(q, { x: 0, y: 0, z: -1 });
  return Math.atan2(-f.x, -f.z);
}

export function degToRad(deg) {
  return (deg * Math.PI) / 180;
}
