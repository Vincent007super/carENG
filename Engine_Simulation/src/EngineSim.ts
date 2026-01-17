// src/engineSim.ts
export type Stroke = "intake" | "compression" | "power" | "exhaust";

export type EngineConfig = {
  cylinders: number;
  idleRpm: number;
  redlineRpm: number;
  // crank/rod for piston motion (visual)
  crankRadius: number; // pixels-ish scale handled by renderer
  rodLength: number;

  // piston phase offsets (0..2π) for crank motion visuals
  crankPhases: number[];

  // 4-stroke cycle offsets per cylinder (0..4π) for stroke state
  cycleOffsets: number[];
};

export class EngineSim {
  cfg: EngineConfig;

  rpm = 850;
  throttle = 0.01;        // current throttle 0..1 (smoothed)
  throttleTarget = 0;  // input target 0..1
  crankAngle720 = 0;   // 0..4π (two crank revolutions)

  brake = 0;        // smoothed brake 0..1
  brakeTarget = 0;  // input target 0..1

  setBrakeTarget(v: number) {
    this.brakeTarget = clamp(v, 0, 1);
  }


  constructor(cfg: EngineConfig) {
    this.cfg = cfg;
    this.rpm = cfg.idleRpm;
  }

  setThrottleTarget(v: number) {
    this.throttleTarget = clamp(v, 0, 1);
  }

  update(dt: number) {
    dt = clamp(dt, 0, 0.05);

    // Smooth inputs
    const throttleTau = this.throttleTarget > this.throttle ? 0.10 : 0.14; // slower than before
    this.throttle += (this.throttleTarget - this.throttle) * (1 - Math.exp(-dt / throttleTau));

    const brakeTau = this.brakeTarget > this.brake ? 0.06 : 0.08;
    this.brake += (this.brakeTarget - this.brake) * (1 - Math.exp(-dt / brakeTau));

    const { idleRpm, redlineRpm } = this.cfg;

    // Base target from throttle
    const baseTarget = idleRpm + this.throttle * (redlineRpm - idleRpm);

    // Brake reduces "effective target" strongly (simulated load)
    const brakeCut = 1 - this.brake * 0.92; // 0.08..1
    const target = idleRpm + (baseTarget - idleRpm) * brakeCut;

    // Slower RPM response (engine inertia)
    const tauUp = 0.45;   // was ~0.18
    const tauDown = 0.75; // was ~0.40
    const tau = target > this.rpm ? tauUp : tauDown;

    // Core approach-to-target
    this.rpm += (target - this.rpm) * (1 - Math.exp(-dt / tau));

    // Passive friction (always pulling toward idle a bit)
    const friction = 85; // rpm/sec at higher rpm
    this.rpm -= friction * (this.rpm / redlineRpm) * dt;

    // Engine braking: when throttle is low, extra drag (feels like letting off the gas)
    const engineBrakeStrength = 220; // rpm/sec
    const offThrottle = 1 - this.throttle;
    this.rpm -= engineBrakeStrength * offThrottle * (this.rpm / redlineRpm) * dt;

    // Brake: strong extra drag
    const brakeStrength = 1400; // rpm/sec (tune this)
    this.rpm -= brakeStrength * this.brake * (this.rpm / redlineRpm) * dt;

    // Clamp near idle so it doesn't "stall" in this simplified model
    if (this.rpm < idleRpm) this.rpm = idleRpm;

    // Soft limiter
    if (this.rpm > redlineRpm) this.rpm = redlineRpm - 50;

    // Advance crank angle (720° domain)
    const omega = (this.rpm / 60) * Math.PI * 2;
    this.crankAngle720 = (this.crankAngle720 + omega * dt) % (Math.PI * 4);
  }


  // 0..2π crank angle (one revolution)
  get crankAngle360() {
    return this.crankAngle720 % (Math.PI * 2);
  }

  // Stroke for a cylinder based on 0..4π cycle angle
  getStroke(cylIndex: number): Stroke {
    const a = (this.crankAngle720 + this.cfg.cycleOffsets[cylIndex]) % (Math.PI * 4);
    const phase = Math.floor(a / Math.PI); // each stroke is 180° = π rad in 720-domain
    if (phase === 0) return "intake";
    if (phase === 1) return "compression";
    if (phase === 2) return "power";
    return "exhaust";
  }

  // Quick event booleans (for spark/injection visuals)
  isIgniting(cylIndex: number): boolean {
    const a = (this.crankAngle720 + this.cfg.cycleOffsets[cylIndex]) % (Math.PI * 4);
    // ignition near start of power stroke (a ~ 2π)
    return nearAngle(a, Math.PI * 2, 0.18);
  }

  isInjecting(cylIndex: number): boolean {
    const a = (this.crankAngle720 + this.cfg.cycleOffsets[cylIndex]) % (Math.PI * 4);
    // injection near end of intake stroke (a ~ π)
    return nearAngle(a, Math.PI * 1, 0.22);
  }

  // Piston motion (crank-slider), returns 0..1 where 0=top, 1=bottom
  pistonT(cylIndex: number): number {
    const theta = (this.crankAngle360 + this.cfg.crankPhases[cylIndex]) % (Math.PI * 2);
    // crank-slider displacement (normalized-ish)
    // Use r=1, l=rodRatio for shape; renderer scales it
    const r = 1;
    const l = this.cfg.rodLength / this.cfg.crankRadius;
    const sin = Math.sin(theta);
    const cos = Math.cos(theta);
    const y = r * cos + Math.sqrt(Math.max(1e-6, l * l - (r * sin) * (r * sin)));
    // Map y range to 0..1
    // y is max at TDC; min at BDC. Approx:
    const yMax = r * 1 + l;
    const yMin = r * -1 + l;
    return (yMax - y) / (yMax - yMin); // 0 top, 1 bottom
  }
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function nearAngle(a: number, target: number, tol: number) {
  let d = Math.abs(a - target);
  // wrap around 4π
  d = Math.min(d, Math.abs(a - target + Math.PI * 4), Math.abs(a - target - Math.PI * 4));
  return d < tol;
}
