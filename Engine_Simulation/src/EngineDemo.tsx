import React, { useEffect, useMemo, useRef, useState } from "react";
import { EngineSim, type EngineConfig, type Stroke } from "./EngineSim";

type AudioState =
    | { kind: "off" }
    | { kind: "on"; ctx: AudioContext; osc: OscillatorNode; gain: GainNode; filter: BiquadFilterNode };

export default function EngineDemo() {
    const cutRef = useRef<HTMLCanvasElement | null>(null);
    const topRef = useRef<HTMLCanvasElement | null>(null);

    const [holding, setHolding] = useState(false);
    const [braking, setBraking] = useState(false);
    const [audio, setAudio] = useState<AudioState>({ kind: "off" });

    const holdingRef = useRef(holding);
    useEffect(() => {
        holdingRef.current = holding;
    }, [holding]);

    const brakingRef = useRef(braking);
    useEffect(() => {
        brakingRef.current = braking;
    }, [braking]);

    const audioRef = useRef(audio);
    useEffect(() => {
        audioRef.current = audio;
    }, [audio]);

    const cfg: EngineConfig = useMemo(() => {
        // V6: keep it visually interesting; refine later.
        const cylinders = 6;

        // piston phases in 0..2π (crank domain)
        const crankPhases = Array.from({ length: cylinders }, (_, i) => (i * Math.PI) / 3); // 60°

        // 720-cycle offsets spaced evenly (each cylinder’s stroke is offset)
        const cycleOffsets = Array.from({ length: cylinders }, (_, i) => i * (2 * Math.PI / 3)); // 120° in 720-domain

        return {
            cylinders,
            idleRpm: 750,
            redlineRpm: 6500,
            crankRadius: 40, // renderer scale
            rodLength: 140,
            crankPhases,
            cycleOffsets,
        };
    }, []);

    const sim = useMemo(() => new EngineSim(cfg), [cfg]);

    // Input: spacebar + mouse/touch hold
    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.code === "Space") {
                e.preventDefault();
                setHolding(true);
            }
        };
        const up = (e: KeyboardEvent) => {
            if (e.code === "Space") {
                e.preventDefault();
                setHolding(false);
            }
        };
        window.addEventListener("keydown", down, { passive: false });
        window.addEventListener("keyup", up, { passive: false });
        return () => {
            window.removeEventListener("keydown", down);
            window.removeEventListener("keyup", up);
        };

    }, []);
    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.code === "Space") { e.preventDefault(); setHolding(true); }
            if (e.code === "ShiftLeft" || e.code === "ShiftRight") { e.preventDefault(); setBraking(true); }
        };
        const up = (e: KeyboardEvent) => {
            if (e.code === "Space") { e.preventDefault(); setHolding(false); }
            if (e.code === "ShiftLeft" || e.code === "ShiftRight") { e.preventDefault(); setBraking(false); }
        };
        window.addEventListener("keydown", down, { passive: false });
        window.addEventListener("keyup", up, { passive: false });
        return () => {
            window.removeEventListener("keydown", down);
            window.removeEventListener("keyup", up);
        };
    }, []);
    // Main loop
    useEffect(() => {
        let raf = 0;
        let last = performance.now();
        let throttleTarget = 0;

        const tick = (now: number) => {
            const dt = (now - last) / 1000;
            last = now;

            const rampUpRate = 0.55;
            const rampDownRate = 1.2;
            if (holdingRef.current) {
                throttleTarget = Math.min(1, throttleTarget + dt * rampUpRate);
            } else {
                throttleTarget = Math.max(0, throttleTarget - dt * rampDownRate);
            }

            sim.setThrottleTarget(throttleTarget);
            sim.setBrakeTarget(brakingRef.current ? 1 : 0);
            sim.update(dt);


            // Update audio (placeholder synth)
            const currentAudio = audioRef.current;
            if (currentAudio.kind === "on") {
                const firingHz = sim.rpm / 20; // V6 4-stroke: 3 fires per rev => rpm/60*3 => rpm/20
                // Use a harmonic multiple to make it audible and engine-ish
                const toneHz = Math.max(30, firingHz * 6);
                currentAudio.osc.frequency.setTargetAtTime(toneHz, currentAudio.ctx.currentTime, 0.02);
                currentAudio.gain.gain.setTargetAtTime(0.05 + sim.throttle * 0.18, currentAudio.ctx.currentTime, 0.05);
                currentAudio.filter.frequency.setTargetAtTime(180 + sim.throttle * 900, currentAudio.ctx.currentTime, 0.05);
            }

            drawCutaway(cutRef.current, sim);
            drawTopDown(topRef.current, sim);

            raf = requestAnimationFrame(tick);
        };

        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [sim]);

    const startAudio = async () => {
        if (audio.kind === "on") return;
        const ctx = new AudioContext();

        // Simple synth placeholder:
        // sawtooth through a lowpass to mimic a throaty tone
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";

        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 400;

        const gain = ctx.createGain();
        gain.gain.value = 0.0;

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        osc.start();
        setAudio({ kind: "on", ctx, osc, gain, filter });
    };

    const stopAudio = async () => {
        if (audio.kind !== "on") return;
        audio.gain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.05);
        setTimeout(() => {
            try {
                audio.osc.stop();
                audio.ctx.close();
            } catch { }
            setAudio({ kind: "off" });
        }, 120);
    };

    return (
        <div style={styles.page}>
            <div style={styles.header}>
                <div>
                    <div style={styles.title}>V6 Engine Browser Sim (2D)</div>
                    <div style={styles.sub}>
                        Hold <b>Space</b> or hold the <b>Throttle</b> button. Two views: cutaway + top-down.
                    </div>
                </div>

                <div style={styles.controls}>
                    {audio.kind === "off" ? (
                        <button style={styles.button} onClick={startAudio}>
                            Start audio
                        </button>
                    ) : (
                        <button style={styles.button} onClick={stopAudio}>
                            Stop audio
                        </button>
                    )}

                    <button
                        style={{ ...styles.button, ...(holding ? styles.buttonOn : null) }}
                        onPointerDown={(e) => {
                            e.currentTarget.setPointerCapture(e.pointerId);
                            setHolding(true);
                        }}
                        onPointerUp={() => setHolding(false)}
                        onPointerCancel={() => setHolding(false)}
                        onPointerLeave={() => setHolding(false)}
                    >
                        Throttle (hold)
                    </button>
                    <button
                        style={{ ...styles.button, ...(braking ? styles.buttonOn : null) }}
                        onPointerDown={(e) => {
                            e.currentTarget.setPointerCapture(e.pointerId);
                            setBraking(true);
                        }}
                        onPointerUp={() => setBraking(false)}
                        onPointerCancel={() => setBraking(false)}
                        onPointerLeave={() => setBraking(false)}
                    >
                        Brake (hold)
                    </button>

                </div>
            </div>

            <div style={styles.grid}>
                <div style={styles.panel}>
                    <div style={styles.panelTitle}>Cutaway</div>
                    <canvas ref={cutRef} style={styles.canvas} />
                </div>

                <div style={styles.panel}>
                    <div style={styles.panelTitle}>Top-down</div>
                    <canvas ref={topRef} style={styles.canvas} />
                </div>
            </div>

            <div style={styles.footer}>
                Next upgrades: proper firing order, valve timing, particle airflow, and real audio loops crossfaded by RPM.
            </div>
        </div>
    );
}

// -------------------- Drawing --------------------

function setupCanvas(canvas: HTMLCanvasElement | null) {
    if (!canvas) return null;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
    return { ctx, width: rect.width, height: rect.height };
}

function drawCutaway(canvas: HTMLCanvasElement | null, sim: EngineSim) {
    const s = setupCanvas(canvas);
    if (!s) return;
    const { ctx, width: W, height: H } = s;

    ctx.clearRect(0, 0, W, H);

    // Layout
    const pad = 16;
    const boreW = Math.max(20, (W - pad * 2) / 6 - 10);
    const boreH = H * 0.55;
    const topY = 50;
    const baseY = topY + boreH;

    // HUD
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillStyle = "#111";
    ctx.fillText(`RPM: ${Math.round(sim.rpm)}`, pad, 24);
    ctx.fillText(`Throttle: ${Math.round(sim.throttle * 100)}%`, pad + 140, 24);

    for (let i = 0; i < 6; i++) {
        const x = pad + i * (boreW + 10);
        const t = sim.pistonT(i);
        const stroke = sim.getStroke(i);

        // bore
        ctx.strokeStyle = "#222";
        ctx.lineWidth = 2;
        ctx.strokeRect(x, topY, boreW, boreH);

        // piston
        const pistonH = 18;
        const y = topY + t * (boreH - pistonH);
        ctx.fillStyle = "#444";
        ctx.fillRect(x + 3, y, boreW - 6, pistonH);

        // conrod hint (simple line down to a crank line)
        const rodX = x + boreW / 2;
        const rodY = y + pistonH;
        ctx.strokeStyle = "#666";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(rodX, rodY);
        ctx.lineTo(rodX, baseY + 22);
        ctx.stroke();

        // stroke label / color
        ctx.fillStyle = strokeColor(stroke);
        ctx.fillRect(x, baseY + 30, boreW, 6);

        // Injection + ignition hints
        if (sim.isInjecting(i)) {
            ctx.fillStyle = "#1b8f2a"; // green
            ctx.beginPath();
            ctx.arc(x + boreW * 0.75, topY + 10, 5, 0, Math.PI * 2);
            ctx.fill();
        }
        if (sim.isIgniting(i)) {
            ctx.fillStyle = "#ff6a00";
            ctx.beginPath();
            ctx.arc(x + boreW * 0.25, topY + 10, 6, 0, Math.PI * 2);
            ctx.fill();
        }

        // airflow arrows (fake but readable)
        drawAirArrow(ctx, x, topY, boreW, boreH, stroke);
    }

    // Crank indicator
    const cx = W - 90;
    const cy = 32;
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillText(`Brake: ${Math.round((sim as any).brake * 100)}%`, pad + 300, 24);

    const a = sim.crankAngle360;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a - Math.PI / 2) * 18, cy + Math.sin(a - Math.PI / 2) * 18);
    ctx.stroke();
}

function drawTopDown(canvas: HTMLCanvasElement | null, sim: EngineSim) {
    const s = setupCanvas(canvas);
    if (!s) return;
    const { ctx, width: W, height: H } = s;

    ctx.clearRect(0, 0, W, H);

    const pad = 18;
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillStyle = "#111";
    ctx.fillText("Banks (3 + 3) — stroke colors per cylinder", pad, 24);

    // bank positions
    const bankGap = 40;
    const rowY = 70;
    const cylR = Math.min(28, (W - pad * 2 - bankGap) / 8);

    const leftX = pad + cylR + 10;
    const rightX = W - pad - cylR - 10;

    // intake/exhaust sides (just a diagram convention)
    ctx.fillStyle = "#0b4aa2";
    ctx.fillText("Intake", pad, H - 18);
    ctx.fillStyle = "#a20b0b";
    ctx.fillText("Exhaust", W - pad - 56, H - 18);

    // Left bank cylinders 0,1,2
    for (let j = 0; j < 3; j++) {
        const i = j;
        const x = leftX;
        const y = rowY + j * (cylR * 2 + 18);
        drawCylinderTop(ctx, x, y, cylR, sim.getStroke(i), sim.isInjecting(i), sim.isIgniting(i));
        ctx.fillStyle = "#111";
        ctx.fillText(`#${i + 1}`, x - 10, y + 4);
        drawFlowHint(ctx, x, y, cylR, sim.getStroke(i));
    }

    // Right bank cylinders 3,4,5
    for (let j = 0; j < 3; j++) {
        const i = j + 3;
        const x = rightX;
        const y = rowY + j * (cylR * 2 + 18);
        drawCylinderTop(ctx, x, y, cylR, sim.getStroke(i), sim.isInjecting(i), sim.isIgniting(i));
        ctx.fillStyle = "#111";
        ctx.fillText(`#${i + 1}`, x - 10, y + 4);
        drawFlowHint(ctx, x, y, cylR, sim.getStroke(i));
    }

    // Center crank + angle
    const cx = W / 2;
    const cy = H / 2 + 20;
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 34, 0, Math.PI * 2);
    ctx.stroke();

    const a = sim.crankAngle360;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a - Math.PI / 2) * 34, cy + Math.sin(a - Math.PI / 2) * 34);
    ctx.stroke();

    ctx.fillStyle = "#111";
    ctx.fillText("Crank angle", cx - 34, cy + 56);
}

function strokeColor(s: Stroke) {
    switch (s) {
        case "intake":
            return "#2b6cff";
        case "compression":
            return "#777";
        case "power":
            return "#ff8a2b";
        case "exhaust":
            return "#ff2b2b";
    }
}

function drawAirArrow(
    ctx: CanvasRenderingContext2D,
    x: number,
    topY: number,
    boreW: number,
    boreH: number,
    stroke: Stroke
) {
    ctx.strokeStyle = stroke === "intake" ? "#2b6cff" : stroke === "exhaust" ? "#ff2b2b" : "#bbb";
    ctx.lineWidth = 2;

    const midX = x + boreW / 2;
    const y1 = topY + boreH + 10;
    const y2 = topY + boreH + 22;

    // Intake arrow pointing into cylinder (down-ish), exhaust pointing out (up-ish) — purely symbolic
    ctx.beginPath();
    if (stroke === "intake") {
        ctx.moveTo(midX, y1);
        ctx.lineTo(midX, y2);
        ctx.lineTo(midX - 5, y2 - 6);
        ctx.moveTo(midX, y2);
        ctx.lineTo(midX + 5, y2 - 6);
    } else if (stroke === "exhaust") {
        ctx.moveTo(midX, y2);
        ctx.lineTo(midX, y1);
        ctx.lineTo(midX - 5, y1 + 6);
        ctx.moveTo(midX, y1);
        ctx.lineTo(midX + 5, y1 + 6);
    } else {
        ctx.moveTo(midX - 8, y2);
        ctx.lineTo(midX + 8, y2);
    }
    ctx.stroke();
}

function drawCylinderTop(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    stroke: Stroke,
    injecting: boolean,
    igniting: boolean
) {
    ctx.fillStyle = strokeColor(stroke);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2;
    ctx.stroke();

    // injection marker (green)
    if (injecting) {
        ctx.fillStyle = "#1b8f2a";
        ctx.beginPath();
        ctx.arc(x + r * 0.35, y - r * 0.35, 5, 0, Math.PI * 2);
        ctx.fill();
    }

    // ignition marker (orange)
    if (igniting) {
        ctx.fillStyle = "#ff6a00";
        ctx.beginPath();
        ctx.arc(x - r * 0.35, y - r * 0.35, 6, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawFlowHint(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, stroke: Stroke) {
    // Simple arrows: intake from bottom, exhaust to top (diagram convention)
    ctx.strokeStyle = stroke === "intake" ? "#2b6cff" : stroke === "exhaust" ? "#ff2b2b" : "#bbb";
    ctx.lineWidth = 2;

    ctx.beginPath();
    if (stroke === "intake") {
        ctx.moveTo(x, y + r + 12);
        ctx.lineTo(x, y + r + 2);
    } else if (stroke === "exhaust") {
        ctx.moveTo(x, y - r - 2);
        ctx.lineTo(x, y - r - 12);
    } else {
        ctx.moveTo(x - 10, y + r + 10);
        ctx.lineTo(x + 10, y + r + 10);
    }
    ctx.stroke();
}

// -------------------- Styles --------------------

const styles: Record<string, React.CSSProperties> = {
    page: { padding: 18, fontFamily: "system-ui, sans-serif", color: "#111" },
    header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 14 },
    title: { fontSize: 18, fontWeight: 700 },
    sub: { fontSize: 13, opacity: 0.85 },
    controls: { display: "flex", gap: 10, alignItems: "center" },
    button: {
        border: "1px solid #111",
        background: "#fff",
        padding: "10px 12px",
        borderRadius: 10,
        cursor: "pointer",
        fontWeight: 600,
    },
    buttonOn: { background: "#111", color: "#fff" },
    grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 },
    panel: { border: "1px solid #ddd", borderRadius: 12, padding: 12, background: "#fafafa" },
    panelTitle: { fontWeight: 700, marginBottom: 8 },
    canvas: { width: "100%", height: 420, background: "#fff", borderRadius: 10, border: "1px solid #e5e5e5" },
    footer: { marginTop: 12, fontSize: 13, opacity: 0.8 },
};
