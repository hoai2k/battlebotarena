export function captureRigidBodyMotion(fighter) {
  const lin = fighter.rb.linvel();
  const ang = fighter.rb.angvel();
  return {
    lin: { x: lin.x, y: lin.y, z: lin.z },
    ang: { x: ang.x, y: ang.y, z: ang.z },
  };
}

export function stepPhysicsArena({
  physics,
  world,
  arena,
  fighters,
  inputs,
  dt,
  updateWeapon,
  stabilizeFighter,
  afterGyro = null,
  afterStabilize = null,
  syncWeaponColliderBindings,
  beforeWeaponImpacts = null,
  weaponActiveForImpact = () => false,
  weaponImpactCallbacksFor = () => ({}),
  afterStepCallbacks = {},
} = {}) {
  if (!physics || !world || !arena || !fighters?.length) return null;
  // Hot path: this runs once per physics substep inside the animation frame.
  // Keep callbacks passed into this stepper scalar/physics-only. Any mesh traversal,
  // geometry splitting, collider rebuilding, DOM work, logging dumps, or preview
  // construction must be queued to an idle/worker path by the callback itself.
  world.integrationParameters.dt = dt;
  physics.updateWedgeStates(arena, dt);
  fighters.forEach((fighter, index) => physics.driveFighter(fighter, inputs[index] || {}, dt));
  fighters.forEach((fighter, index) => updateWeapon?.(fighter, dt, Boolean(inputs[index]?.weapon)));
  fighters.forEach((fighter, index) => physics.applySpinnerGyro(fighter, inputs[index] || {}, dt));
  fighters.forEach((fighter, index) => afterGyro?.(fighter, index));
  fighters.forEach((fighter) => stabilizeFighter?.(fighter));
  fighters.forEach((fighter, index) => afterStabilize?.(fighter, index));
  fighters.forEach((fighter) => syncWeaponColliderBindings?.(fighter));
  beforeWeaponImpacts?.();
  fighters.forEach((fighter, index) => {
    physics.applyWeaponImpacts({
      arena,
      attacker: fighter,
      active: Boolean(weaponActiveForImpact(fighter, inputs[index] || {}, index)),
      dt,
      callbacks: weaponImpactCallbacksFor(fighter, index),
    });
  });
  const preStepMotion = new Map(fighters.map((fighter) => [fighter, captureRigidBodyMotion(fighter)]));
  world.step();
  fighters.forEach((fighter) => stabilizeFighter?.(fighter));
  physics.afterStep({
    arena,
    fighters,
    inputs,
    preStepMotion,
    dt,
    callbacks: afterStepCallbacks,
  });
  return { preStepMotion };
}
