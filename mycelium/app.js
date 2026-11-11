(() => {
  "use strict";

  /* --------------------------------------------------------------------------
     Utilities
  -------------------------------------------------------------------------- */

  const TAU = Math.PI * 2;
  const SQRT2 = Math.SQRT2;
  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const lerp = (a, b, t) => a + (b - a) * t;

  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  function normalizeAngle(angle) {
    while (angle > Math.PI) angle -= TAU;
    while (angle < -Math.PI) angle += TAU;
    return angle;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function random() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function formatInt(value) {
    return Math.round(value).toLocaleString("en-US");
  }

  function formatSeconds(seconds) {
    const safe = Math.max(0, seconds);
    const minutes = Math.floor(safe / 60);
    const rest = Math.floor(safe % 60);
    return `${pad2(minutes)}:${pad2(rest)}`;
  }

  /* --------------------------------------------------------------------------
     DOM
  -------------------------------------------------------------------------- */

  const dom = {
    app: document.getElementById("app"),
    startBtn: document.getElementById("startBtn"),
    resetBtn: document.getElementById("resetBtn"),
    methodBtn: document.getElementById("methodBtn"),
    phaseDisplay: document.getElementById("phaseDisplay"),
    phaseIndex: document.getElementById("phaseIndex"),
    phaseText: document.getElementById("phaseText"),
    simCanvas: document.getElementById("simCanvas"),
    backdropCanvas: document.getElementById("backdropCanvas"),
    cultureCanvas: document.getElementById("cultureCanvas"),
    canvasPrompt: document.getElementById("canvasPrompt"),
    guideHint: document.getElementById("guideHint"),
    guideStepPlace: document.getElementById("guideStepPlace"),
    guideStepStart: document.getElementById("guideStepStart"),
    foodCount: document.getElementById("foodCount"),
    beginBtn: document.getElementById("beginBtn"),
    hud: document.getElementById("hud"),
    hudLabel: document.getElementById("hudLabel"),
    hudTime: document.getElementById("hudTime"),
    hudNodes: document.getElementById("hudNodes"),
    hudAgents: document.getElementById("hudAgents"),
    coordValue: document.getElementById("coordValue"),
    resultPanel: document.getElementById("resultPanel"),
    statFoods: document.getElementById("statFoods"),
    statLength: document.getElementById("statLength"),
    statDuration: document.getElementById("statDuration"),
    saveBtn: document.getElementById("saveBtn"),
    againBtn: document.getElementById("againBtn"),
    cursor: document.getElementById("cursor"),
    toast: document.getElementById("toast"),
    toastText: document.getElementById("toastText"),
    methodModal: document.getElementById("methodModal"),
    closeMethodBtn: document.getElementById("closeMethodBtn"),
    doneMethodBtn: document.getElementById("doneMethodBtn"),
  };

  const simCtx = dom.simCanvas.getContext("2d", {
    alpha: true,
    desynchronized: true,
  });
  const reducedMotion = REDUCED_MOTION;

  let W = window.innerWidth;
  let H = window.innerHeight;
  let DPR = Math.min(window.devicePixelRatio || 1, 1.5);

  const state = {
    phase: "landing",
    foods: [],
    origin: null,
    engine: null,
    ripples: [],
    result: null,
    pointer: { x: 0, y: 0, active: false },
    modalOpen: false,
    phaseTimer: 0,
    toastTimer: 0,
    runToken: 0,
    counterToken: 0,
    timers: new Set(),
  };

  const PHASE_COPY = {
    landing: { index: "PHYSARUM", text: "STUDY / 001" },
    placing: { index: "STAGE 01", text: "PLACE NUTRIENTS" },
    evolving: { index: "STAGE 02", text: "EMERGENT GROWTH" },
    converging: { index: "STAGE 03", text: "CONVERGENCE" },
    result: { index: "RESULT", text: "OPTIMAL NETWORK" },
  };

  /* --------------------------------------------------------------------------
     Canvas sizing
  -------------------------------------------------------------------------- */

  function resizeViewport() {
    W = window.innerWidth;
    H = window.innerHeight;
    DPR = Math.min(window.devicePixelRatio || 1, 1.5);

    dom.simCanvas.width = Math.max(1, Math.round(W * DPR));
    dom.simCanvas.height = Math.max(1, Math.round(H * DPR));
    simCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    simCtx.imageSmoothingEnabled = true;

    if (state.engine) {
      state.engine.setViewport(W, H);
    }
    if (backdrop) {
      backdrop.resize();
    }
  }

  function safePoint(x, y) {
    const marginX = clamp(W * 0.035, 22, 52);
    const top = Math.max(W < 620 ? 92 : 108, H * 0.115);
    const baseBottom = W < 620 ? 276 : 224;
    const panelReserve = dom.resultPanel
      ? dom.resultPanel.offsetHeight + 58
      : 0;
    const bottom = Math.min(H * 0.48, Math.max(baseBottom, panelReserve));
    let minY = top;
    let maxY = H - bottom;
    if (maxY - minY < 170) {
      const center = H * 0.46;
      minY = Math.max(72, center - 85);
      maxY = Math.min(H - 120, center + 85);
    }
    if (maxY - minY < 90) {
      minY = Math.max(66, H * 0.16);
      maxY = Math.max(minY + 80, H - 110);
    }
    return {
      x: clamp(x, marginX, W - marginX),
      y: clamp(y, minY, Math.max(minY + 1, maxY)),
    };
  }

  /* --------------------------------------------------------------------------
     Ambient backdrop
  -------------------------------------------------------------------------- */

  class Backdrop {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.particles = [];
      this.pointerX = 0;
      this.pointerY = 0;
      this.width = 1;
      this.height = 1;
      this.dpr = 1;
      this.resize();
    }

    resize() {
      const nextWidth = window.innerWidth;
      const nextHeight = window.innerHeight;
      const nextDpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const count = Math.round(
        clamp((nextWidth * nextHeight) / 21000, 36, 104)
      );
      const needsSeed = count !== this.particles.length;

      this.width = nextWidth;
      this.height = nextHeight;
      this.dpr = nextDpr;
      this.canvas.width = Math.max(1, Math.round(this.width * this.dpr));
      this.canvas.height = Math.max(1, Math.round(this.height * this.dpr));
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (needsSeed) this.seed();
    }

    seed() {
      const count = Math.round(clamp((this.width * this.height) / 21000, 36, 104));
      const random = mulberry32(0x4a7c15);
      this.particles = Array.from({ length: count }, () => ({
        x: random(),
        y: random(),
        size: 0.4 + random() * 1.1,
        depth: 0.18 + random() * 0.82,
        alpha: 0.035 + random() * 0.16,
        speed: 0.0016 + random() * 0.005,
        sway: random() * TAU,
        swaySpeed: 0.08 + random() * 0.24,
        acid: random() > 0.88,
      }));
    }

    setPointer(x, y) {
      this.pointerX = x / Math.max(1, this.width) - 0.5;
      this.pointerY = y / Math.max(1, this.height) - 0.5;
    }

    draw(now, dt) {
      const ctx = this.ctx;
      const { width, height } = this;
      ctx.clearRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";

      const time = now / 1000;
      for (const particle of this.particles) {
        particle.y -= particle.speed * dt;
        if (particle.y < -0.03) {
          particle.y = 1.03;
          particle.x = Math.random();
        }
        const sway = Math.sin(time * particle.swaySpeed + particle.sway) * 7;
        const x =
          particle.x * width +
          sway * particle.depth +
          this.pointerX * particle.depth * 18;
        const y =
          particle.y * height +
          Math.cos(time * particle.swaySpeed * 0.72 + particle.sway) * 4 +
          this.pointerY * particle.depth * 12;

        ctx.fillStyle = particle.acid
          ? `rgba(217, 238, 156, ${particle.alpha * 1.25})`
          : `rgba(216, 230, 204, ${particle.alpha})`;
        ctx.beginPath();
        ctx.arc(x, y, particle.size, 0, TAU);
        ctx.fill();
      }

      ctx.globalCompositeOperation = "source-over";
    }
  }

  /* --------------------------------------------------------------------------
     Hero specimen network
  -------------------------------------------------------------------------- */

  class CultureArt {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.width = 0;
      this.height = 0;
      this.dpr = 1;
      this.branches = [];
      this.nodes = [];
      this.mainBranches = [];
      this.totalDuration = 5;
      this.start = performance.now();
      this.lastWidth = 0;
      this.lastHeight = 0;

      if ("ResizeObserver" in window && canvas.parentElement) {
        this.observer = new ResizeObserver(() => this.resize());
        this.observer.observe(canvas.parentElement);
      }
      this.resize();
    }

    resize() {
      const parent = this.canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 20) return;
      if (
        Math.abs(rect.width - this.lastWidth) < 2 &&
        Math.abs(rect.height - this.lastHeight) < 2
      ) {
        return;
      }

      this.lastWidth = rect.width;
      this.lastHeight = rect.height;
      this.width = rect.width;
      this.height = rect.height;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.max(1, Math.round(this.width * this.dpr));
      this.canvas.height = Math.max(1, Math.round(this.height * this.dpr));
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.build();
      this.start = performance.now();
    }

    makeCurve(from, to, random) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.hypot(dx, dy);
      const steps = clamp(Math.round(distance / 5), 12, 60);
      const stepLength = distance / steps;
      const phase = random() * TAU;
      const bend = (random() - 0.5) * 2.2;
      let angle = Math.atan2(dy, dx);
      let x = from.x;
      let y = from.y;
      const points = [{ x, y }];

      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        const targetAngle = Math.atan2(to.y - y, to.x - x);
        const diff = normalizeAngle(targetAngle - angle);
        angle +=
          diff * (0.12 + t * 0.11) +
          Math.sin(t * Math.PI * 2.2 + phase) * 0.085 +
          bend * 0.008 * Math.sin(t * Math.PI);
        x += Math.cos(angle) * stepLength;
        y += Math.sin(angle) * stepLength;
        points.push({ x, y });
      }
      return points;
    }

    build() {
      const width = this.width;
      const height = this.height;
      if (!width || !height) return;

      const center = { x: width * 0.5, y: height * 0.51 };
      const base = Math.min(width, height);
      const radius = base * 0.405;
      const random = mulberry32(0x51a9e + Math.round(width * 3 + height * 5));
      const scale = base / 540;

      const nodeSpecs = [
        { angle: -2.42, radius: 0.7 },
        { angle: -1.55, radius: 0.52 },
        { angle: -0.72, radius: 0.79 },
        { angle: 0.17, radius: 0.56 },
        { angle: 0.96, radius: 0.83 },
        { angle: 1.75, radius: 0.49 },
        { angle: 2.54, radius: 0.66 },
      ];

      const nodes = nodeSpecs.map((spec, index) => ({
        x: center.x + Math.cos(spec.angle) * radius * spec.radius,
        y: center.y + Math.sin(spec.angle) * radius * spec.radius,
        reveal: 0.6 + index * 0.14,
      }));

      const branches = [];
      const mainBranches = [];
      const fineBranches = [];
      const tipNodes = [];

      const addBranch = (from, to, options) => {
        const points = this.makeCurve(from, to, random);
        const branch = {
          points,
          width: options.width * scale,
          alpha: options.alpha,
          delay: options.delay,
          duration: options.duration,
          kind: options.kind,
          glow: options.glow,
        };
        branches.push(branch);
        if (options.kind === "fine" || options.kind === "hair") {
          fineBranches.push(branch);
        }
        if (
          (options.kind === "fine" || options.kind === "hair") &&
          points.length > 2 &&
          random() > 0.55
        ) {
          tipNodes.push(points[points.length - 1]);
        }
        return branch;
      };

      nodes.forEach((node, index) => {
        const branch = addBranch(center, node, {
          width: 1.15,
          alpha: 0.46,
          delay: 0.12 + index * 0.1,
          duration: 1.8 + random() * 0.85,
          kind: "main",
          glow: true,
        });
        mainBranches.push(branch);
      });

      const denseCount = Math.round(13 + base / 42);
      for (let i = 0; i < denseCount; i += 1) {
        const angle = random() * TAU;
        const length = radius * (0.3 + random() * 0.55);
        const node = {
          x: center.x + Math.cos(angle) * length,
          y: center.y + Math.sin(angle) * length,
        };
        addBranch(center, node, {
          width: 0.62,
          alpha: 0.32,
          delay: 0.45 + random() * 1.5,
          duration: 1.6 + random() * 1.1,
          kind: "fine",
          glow: false,
        });
      }

      mainBranches.forEach((branch) => {
        const sideCount = 7 + Math.floor(random() * 4);
        for (let j = 0; j < sideCount; j += 1) {
          const index = Math.floor(
            (0.12 + random() * 0.78) * (branch.points.length - 2)
          );
          const from = branch.points[index];
          const next = branch.points[Math.min(index + 1, branch.points.length - 1)];
          const tangent = Math.atan2(next.y - from.y, next.x - from.x);
          const direction =
            tangent + (random() < 0.5 ? -1 : 1) * (0.45 + random() * 1.12);
          const length = radius * (0.07 + random() * 0.2);
          const to = {
            x: from.x + Math.cos(direction) * length,
            y: from.y + Math.sin(direction) * length,
          };
          const side = addBranch(from, to, {
            width: 0.68,
            alpha: 0.38,
            delay: branch.delay + branch.duration * 0.34 + random() * 0.8,
            duration: 1 + random() * 1.1,
            kind: "fine",
            glow: false,
          });

          if (random() > 0.55) {
            const secondFrom =
              side.points[Math.floor(random() * (side.points.length - 2))];
            const secondAngle = direction + (random() - 0.5) * 1.7;
            const secondLength = length * (0.38 + random() * 0.52);
            addBranch(
              secondFrom,
              {
                x: secondFrom.x + Math.cos(secondAngle) * secondLength,
                y: secondFrom.y + Math.sin(secondAngle) * secondLength,
              },
              {
                width: 0.44,
                alpha: 0.27,
                delay: side.delay + 0.45 + random() * 0.6,
                duration: 0.8 + random() * 0.8,
                kind: "hair",
                glow: false,
              }
            );
          }
        }
      });

      // A few looping bridges turn the radial growth into a living network.
      for (let i = 0; i < 10; i += 1) {
        const first = mainBranches[Math.floor(random() * mainBranches.length)];
        let second = mainBranches[Math.floor(random() * mainBranches.length)];
        if (second === first) second = mainBranches[(mainBranches.indexOf(first) + 1) % mainBranches.length];
        if (!first || !second) continue;
        const firstPoint =
          first.points[Math.floor((0.25 + random() * 0.55) * (first.points.length - 1))];
        const secondPoint =
          second.points[Math.floor((0.25 + random() * 0.55) * (second.points.length - 1))];
        if (Math.hypot(firstPoint.x - secondPoint.x, firstPoint.y - secondPoint.y) > radius * 1.15) {
          continue;
        }
        addBranch(firstPoint, secondPoint, {
          width: 0.55,
          alpha: 0.23,
          delay: 2.35 + random() * 1.1,
          duration: 1.6 + random() * 0.9,
          kind: "link",
          glow: false,
        });
      }

      const randomTip = () => tipNodes[Math.floor(random() * tipNodes.length)];
      for (let i = 0; i < 6; i += 1) {
        if (!tipNodes.length) break;
        const from = randomTip();
        const angle = random() * TAU;
        const length = radius * (0.03 + random() * 0.07);
        addBranch(
          from,
          {
            x: from.x + Math.cos(angle) * length,
            y: from.y + Math.sin(angle) * length,
          },
          {
            width: 0.36,
            alpha: 0.19,
            delay: 3.1 + random() * 1.1,
            duration: 0.8 + random() * 0.7,
            kind: "hair",
            glow: false,
          }
        );
      }

      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const distance = Math.hypot(
            nodes[i].x - nodes[j].x,
            nodes[i].y - nodes[j].y
          );
          if (distance < radius * 0.95 && random() > 0.48) {
            addBranch(nodes[i], nodes[j], {
              width: 0.58,
              alpha: 0.24,
              delay: 2.1 + random() * 1.05,
              duration: 1.8 + random() * 0.9,
              kind: "link",
              glow: false,
            });
          }
        }
      }

      this.branches = branches;
      this.nodes = nodes;
      this.mainBranches = mainBranches;
      this.fineBranches = fineBranches;
      this.tipNodes = tipNodes;
      this.center = center;
      this.base = base;
      this.radius = radius;
      this.totalDuration =
        branches.reduce(
          (max, branch) => Math.max(max, branch.delay + branch.duration),
          0
        ) + 0.2;
    }

    partialPath(points, progress) {
      if (progress <= 0) return [];
      if (progress >= 1) return points;
      const exact = progress * (points.length - 1);
      const fullIndex = Math.floor(exact);
      const fraction = exact - fullIndex;
      const result = points.slice(0, fullIndex + 1);
      if (fullIndex < points.length - 1) {
        const a = points[fullIndex];
        const b = points[fullIndex + 1];
        result.push({
          x: lerp(a.x, b.x, fraction),
          y: lerp(a.y, b.y, fraction),
        });
      }
      return result;
    }

    strokePoints(points, color, width) {
      if (points.length < 2) return;
      const ctx = this.ctx;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i += 1) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    }

    draw(now) {
      const width = this.width;
      const height = this.height;
      if (!width || !height) return;

      const ctx = this.ctx;
      const elapsed = reducedMotion ? 999 : (now - this.start) / 1000;
      const base = this.base || Math.min(width, height);
      const center = this.center;

      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.beginPath();
      ctx.arc(width * 0.5, height * 0.5, Math.min(width, height) * 0.5 - 2, 0, TAU);
      ctx.clip();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (center) {
        const atmosphere = ctx.createRadialGradient(
          center.x,
          center.y,
          0,
          center.x,
          center.y,
          base * 0.55
        );
        atmosphere.addColorStop(0, "rgba(113, 143, 90, 0.06)");
        atmosphere.addColorStop(0.55, "rgba(73, 98, 62, 0.025)");
        atmosphere.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = atmosphere;
        ctx.fillRect(0, 0, width, height);
      }

      for (const branch of this.branches) {
        const raw = clamp((elapsed - branch.delay) / branch.duration, 0, 1);
        if (raw <= 0) continue;
        const progress = easeOutCubic(raw);
        const points = this.partialPath(branch.points, progress);
        if (points.length < 2) continue;

        if (branch.glow) {
          ctx.globalCompositeOperation = "lighter";
          this.strokePoints(
            points,
            `rgba(147, 179, 121, ${branch.alpha * 0.12})`,
            branch.width * 5.5
          );
          ctx.globalCompositeOperation = "source-over";
        }

        const tint = branch.kind === "main" ? 196 : 183;
        const tintG = branch.kind === "main" ? 214 : 203;
        const tintB = branch.kind === "main" ? 178 : 170;
        this.strokePoints(
          points,
          `rgba(${tint}, ${tintG}, ${tintB}, ${branch.alpha})`,
          branch.width
        );

        if (raw < 1 && (branch.kind === "main" || branch.kind === "fine")) {
          const tip = points[points.length - 1];
          ctx.globalCompositeOperation = "lighter";
          ctx.beginPath();
          ctx.arc(tip.x, tip.y, branch.width * 1.65, 0, TAU);
          ctx.fillStyle = "rgba(225, 240, 195, 0.55)";
          ctx.fill();
          ctx.globalCompositeOperation = "source-over";
        }
      }

      if (this.tipNodes && elapsed > 3.6) {
        const alpha = clamp((elapsed - 3.6) / 1.2, 0, 1) * 0.3;
        ctx.globalCompositeOperation = "lighter";
        for (const tip of this.tipNodes) {
          ctx.beginPath();
          ctx.arc(tip.x, tip.y, 0.7, 0, TAU);
          ctx.fillStyle = `rgba(222, 234, 202, ${alpha})`;
          ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
      }

      if (this.nodes) {
        this.nodes.forEach((node, index) => {
          const revealAt = 0.65 + index * 0.14;
          if (elapsed < revealAt) return;
          const age = clamp((elapsed - revealAt) / 0.9, 0, 1);
          ctx.globalCompositeOperation = "lighter";
          const glow = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, base * 0.045);
          glow.addColorStop(0, `rgba(236, 214, 165, ${0.22 * age})`);
          glow.addColorStop(1, "rgba(236, 214, 165, 0)");
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(node.x, node.y, base * 0.045, 0, TAU);
          ctx.fill();

          ctx.beginPath();
          ctx.arc(node.x, node.y, 1.7, 0, TAU);
          ctx.fillStyle = `rgba(236, 222, 184, ${0.62 * age})`;
          ctx.fill();
          ctx.globalCompositeOperation = "source-over";
        });
      }

      if (center) {
        const pulse = (Math.sin(elapsed * 1.2) + 1) * 0.5;
        ctx.globalCompositeOperation = "lighter";
        const centerGlow = ctx.createRadialGradient(
          center.x,
          center.y,
          0,
          center.x,
          center.y,
          base * 0.09
        );
        centerGlow.addColorStop(0, `rgba(218, 238, 160, ${0.2 + pulse * 0.08})`);
        centerGlow.addColorStop(1, "rgba(218, 238, 160, 0)");
        ctx.fillStyle = centerGlow;
        ctx.beginPath();
        ctx.arc(center.x, center.y, base * 0.09, 0, TAU);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(center.x, center.y, 2.2, 0, TAU);
        ctx.fillStyle = "rgba(239, 250, 201, 0.8)";
        ctx.fill();

        const orbit = 9 + pulse * 2;
        ctx.beginPath();
        ctx.arc(center.x, center.y, orbit, 0, TAU);
        ctx.strokeStyle = "rgba(217, 238, 156, 0.16)";
        ctx.lineWidth = 0.7;
        ctx.stroke();
        ctx.globalCompositeOperation = "source-over";
      }

      if (elapsed > this.totalDuration && !reducedMotion && this.mainBranches.length) {
        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < 3; i += 1) {
          const branch = this.mainBranches[(i * 2 + 1) % this.mainBranches.length];
          const fraction = (elapsed * 0.055 + i * 0.31) % 1;
          const index = Math.floor(fraction * (branch.points.length - 1));
          const point = branch.points[index];
          ctx.beginPath();
          ctx.arc(point.x, point.y, 1.25, 0, TAU);
          ctx.fillStyle = "rgba(238, 250, 199, 0.68)";
          ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
      }

      ctx.restore();
    }
  }

  /* --------------------------------------------------------------------------
     Path utilities and min heap
  -------------------------------------------------------------------------- */

  function cumulativeLengths(points) {
    const cumulative = new Float32Array(points.length);
    for (let i = 1; i < points.length; i += 1) {
      cumulative[i] =
        cumulative[i - 1] +
        Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    return cumulative;
  }

  function pointAtFraction(points, cumulative, fraction) {
    if (!points.length) return { x: 0, y: 0, angle: 0 };
    if (points.length === 1) return { ...points[0], angle: 0 };
    const total = cumulative[cumulative.length - 1];
    const target = clamp(fraction, 0, 1) * total;
    let low = 0;
    let high = cumulative.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (cumulative[mid] < target) low = mid + 1;
      else high = mid;
    }
    const index = Math.max(1, low);
    const previous = points[index - 1];
    const current = points[index];
    const segment = cumulative[index] - cumulative[index - 1] || 1;
    const local = clamp((target - cumulative[index - 1]) / segment, 0, 1);
    return {
      x: lerp(previous.x, current.x, local),
      y: lerp(previous.y, current.y, local),
      angle: Math.atan2(current.y - previous.y, current.x - previous.x),
    };
  }

  function partialPoints(points, cumulative, fraction) {
    if (fraction <= 0 || points.length < 2) return [];
    if (fraction >= 1) return points;
    const total = cumulative[cumulative.length - 1];
    const target = total * fraction;
    const out = [points[0]];
    for (let i = 1; i < points.length; i += 1) {
      if (cumulative[i] <= target) {
        out.push(points[i]);
      } else {
        const segment = cumulative[i] - cumulative[i - 1] || 1;
        const local = clamp((target - cumulative[i - 1]) / segment, 0, 1);
        out.push({
          x: lerp(points[i - 1].x, points[i].x, local),
          y: lerp(points[i - 1].y, points[i].y, local),
        });
        break;
      }
    }
    return out;
  }

  function simplifyPoints(points, tolerance) {
    if (points.length < 3) return points.slice();
    const sqTolerance = tolerance * tolerance;
    const keep = new Uint8Array(points.length);
    keep[0] = 1;
    keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];

    while (stack.length) {
      const [start, end] = stack.pop();
      const ax = points[start].x;
      const ay = points[start].y;
      const bx = points[end].x;
      const by = points[end].y;
      const dx = bx - ax;
      const dy = by - ay;
      const lengthSq = dx * dx + dy * dy;
      let maxDistance = sqTolerance;
      let index = -1;

      for (let i = start + 1; i < end; i += 1) {
        const px = points[i].x - ax;
        const py = points[i].y - ay;
        let t = lengthSq ? (px * dx + py * dy) / lengthSq : 0;
        t = clamp(t, 0, 1);
        const projectionX = dx * t;
        const projectionY = dy * t;
        const distance = (px - projectionX) ** 2 + (py - projectionY) ** 2;
        if (distance > maxDistance) {
          maxDistance = distance;
          index = i;
        }
      }

      if (index !== -1) {
        keep[index] = 1;
        stack.push([start, index], [index, end]);
      }
    }

    return points.filter((_, index) => keep[index]);
  }

  function chaikin(points) {
    if (points.length < 3) return points.slice();
    const result = [points[0]];
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      result.push({
        x: a.x * 0.75 + b.x * 0.25,
        y: a.y * 0.75 + b.y * 0.25,
      });
      result.push({
        x: a.x * 0.25 + b.x * 0.75,
        y: a.y * 0.25 + b.y * 0.75,
      });
    }
    result.push(points[points.length - 1]);
    return result;
  }

  class MinHeap {
    constructor() {
      this.ids = [];
      this.keys = [];
      this.lastKey = 0;
    }

    get size() {
      return this.ids.length;
    }

    push(id, key) {
      const ids = this.ids;
      const keys = this.keys;
      ids.push(id);
      keys.push(key);
      let index = ids.length - 1;
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (keys[parent] <= key) break;
        ids[index] = ids[parent];
        keys[index] = keys[parent];
        index = parent;
      }
      ids[index] = id;
      keys[index] = key;
    }

    pop() {
      const ids = this.ids;
      const keys = this.keys;
      const topId = ids[0];
      this.lastKey = keys[0];

      const lastId = ids.pop();
      const lastKey = keys.pop();
      if (ids.length) {
        let index = 0;
        const length = ids.length;
        while (true) {
          const left = index * 2 + 1;
          if (left >= length) break;
          const right = left + 1;
          let child = left;
          if (right < length && keys[right] < keys[left]) child = right;
          if (keys[child] >= lastKey) break;
          ids[index] = ids[child];
          keys[index] = keys[child];
          index = child;
        }
        ids[index] = lastId;
        keys[index] = lastKey;
      }
      return topId;
    }
  }

  /* --------------------------------------------------------------------------
     Physarum engine
  -------------------------------------------------------------------------- */

  const DIRECTIONS = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, SQRT2],
    [1, -1, SQRT2],
    [-1, 1, SQRT2],
    [-1, -1, SQRT2],
  ];

  function computeDijkstra(start, terminalCells, cellCount, gridWidth, gridHeight, cost) {
    const dist = new Float64Array(cellCount);
    dist.fill(Infinity);
    const previous = new Int32Array(cellCount);
    previous.fill(-1);
    const visited = new Uint8Array(cellCount);
    const terminalFlags = new Uint8Array(cellCount);
    for (const cell of terminalCells) {
      terminalFlags[cell] = 1;
    }
    let remaining = terminalCells.length;

    const heap = new MinHeap();
    dist[start] = 0;
    heap.push(start, 0);

    while (heap.size) {
      const index = heap.pop();
      const distance = heap.lastKey;
      if (visited[index]) continue;
      if (distance > dist[index] + 1e-9) continue;
      visited[index] = 1;

      if (terminalFlags[index]) {
        remaining -= 1;
        if (remaining === 0) break;
      }

      const x = index % gridWidth;
      const y = (index / gridWidth) | 0;
      const baseCost = cost[index];

      for (let d = 0; d < DIRECTIONS.length; d += 1) {
        const [dx, dy, step] = DIRECTIONS[d];
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= gridWidth || ny >= gridHeight) continue;
        const next = ny * gridWidth + nx;
        if (visited[next]) continue;
        const candidate =
          distance + step * (baseCost + cost[next]) * 0.5;
        if (candidate < dist[next]) {
          dist[next] = candidate;
          previous[next] = index;
          heap.push(next, candidate);
        }
      }
    }

    return { dist, previous };
  }

  class SlimeEngine {
    constructor(options) {
      this.canvas = options.canvas;
      this.ctx = options.ctx;
      this.W = options.width;
      this.H = options.height;
      this.onReach = options.onReach;
      this.onComplete = options.onComplete;

      this.gw = 1;
      this.gh = 1;
      this.cellX = 1;
      this.cellY = 1;

      this.foods = options.foods.map((food, index) => ({
        idx: index,
        nx: food.nx,
        ny: food.ny,
        reached: false,
        gx: 0,
        gy: 0,
      }));

      this.origin = {
        nx: options.origin.nx,
        ny: options.origin.ny,
        reached: true,
        gx: 0,
        gy: 0,
      };

      this.startTime = performance.now();
      this.elapsed = 0;
      this.duration = 0;
      this.state = "growing";
      this.finished = false;
      this.allReachedAt = 0;
      this.reachedCount = 0;
      this.reportedComplete = false;

      this.agents = [];
      this.spawnAccumulator = 0;
      this.spawnRate = 330;
      this.maxAgents = 1180;
      this.accumulator = 0;
      this.stepCount = 0;

      this.senseDistance = 5.7;
      this.senseAngle = 0.6;
      this.deposit = 0.52;
      this.decay = 0.972;
      this.diffusion = 0.058;
      this.reachRadius = 13;

      this.result = null;
      this.resultStart = 0;
      this.solved = false;
      this.trailDirty = true;

      this.buildGrid();
      this.seedPositions();
      this.spawnBurst(this.origin, 400);
      this.prepareRenderers();
      this.setViewport(this.W, this.H);
    }

    buildGrid() {
      const cellSize = clamp(Math.max(this.W, this.H) / 390, 3, 9);
      this.gw = Math.max(100, Math.round(this.W / cellSize));
      this.gh = Math.max(80, Math.round(this.H / cellSize));
      this.cellX = this.W / this.gw;
      this.cellY = this.H / this.gh;
      const count = this.gw * this.gh;
      this.trail = new Float32Array(count);
      this.nextTrail = new Float32Array(count);
      this.maxAgents = Math.round(clamp(count / 88, 760, 1200));
    }

    seedPositions() {
      this.origin.gx = this.origin.nx * this.gw;
      this.origin.gy = this.origin.ny * this.gh;
      for (const food of this.foods) {
        food.gx = food.nx * this.gw;
        food.gy = food.ny * this.gh;
      }
    }

    setViewport(width, height) {
      const changed =
        Math.abs(width - this.W) > 1 || Math.abs(height - this.H) > 1;
      this.W = width;
      this.H = height;
      this.cellX = this.W / this.gw;
      this.cellY = this.H / this.gh;
      if (changed && this.filamentCanvas) {
        this.createFilamentLayer();
      }
    }

    prepareRenderers() {
      this.trailCanvas = document.createElement("canvas");
      this.trailCanvas.width = this.gw;
      this.trailCanvas.height = this.gh;
      this.trailContext = this.trailCanvas.getContext("2d");
      this.trailImage = this.trailContext.createImageData(this.gw, this.gh);
      this.trailData = this.trailImage.data;
      this.trailContext.imageSmoothingEnabled = true;

      const sprite = document.createElement("canvas");
      sprite.width = 64;
      sprite.height = 64;
      const context = sprite.getContext("2d");
      const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, "rgba(249, 255, 225, 1)");
      gradient.addColorStop(0.14, "rgba(236, 252, 187, 0.92)");
      gradient.addColorStop(0.36, "rgba(195, 230, 139, 0.38)");
      gradient.addColorStop(0.7, "rgba(136, 184, 93, 0.08)");
      gradient.addColorStop(1, "rgba(110, 160, 80, 0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, 64, 64);
      this.pulseSprite = sprite;

      this.createFilamentLayer();
    }

    createFilamentLayer() {
      const scale = Math.min(1.15, 1280 / Math.max(this.W, this.H, 1));
      this.filamentScale = scale;
      this.filamentCanvas = document.createElement("canvas");
      this.filamentCanvas.width = Math.max(1, Math.round(this.W * scale));
      this.filamentCanvas.height = Math.max(1, Math.round(this.H * scale));
      this.filamentContext = this.filamentCanvas.getContext("2d");
      this.filamentContext.setTransform(scale, 0, 0, scale, 0, 0);
      this.filamentContext.lineCap = "round";
      this.filamentContext.lineJoin = "round";
    }

    stampFilaments(agents) {
      const ctx = this.filamentContext;
      if (!ctx) return;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      let drawn = 0;
      for (const agent of agents) {
        if (agent.fromX === undefined) continue;
        const x1 = agent.fromX * this.cellX;
        const y1 = agent.fromY * this.cellY;
        const x2 = agent.x * this.cellX;
        const y2 = agent.y * this.cellY;
        if (Math.abs(x2 - x1) + Math.abs(y2 - y1) < 0.01) continue;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        drawn += 1;
      }
      if (drawn) {
        ctx.strokeStyle = "rgba(194, 222, 155, 0.012)";
        ctx.lineWidth = 1.9;
        ctx.stroke();
        ctx.strokeStyle = "rgba(233, 249, 199, 0.033)";
        ctx.lineWidth = 0.62;
        ctx.stroke();
      }
      ctx.restore();
    }

    fadeFilaments(amount) {
      const ctx = this.filamentContext;
      if (!ctx) return;
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = `rgba(0, 0, 0, ${amount})`;
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.restore();
    }

    pickTarget(x, y) {
      const unreached = this.foods.filter((food) => !food.reached);
      let best = -1;
      let bestScore = Infinity;

      if (unreached.length) {
        for (const food of unreached) {
          const distance = Math.hypot(food.gx - x, food.gy - y);
          const score = distance * (0.72 + Math.random() * 0.56);
          if (score < bestScore) {
            bestScore = score;
            best = food.idx;
          }
        }
        return best;
      }

      for (const food of this.foods) {
        const distance = Math.hypot(food.gx - x, food.gy - y);
        const score = distance * (0.8 + Math.random() * 0.5);
        if (score < bestScore) {
          bestScore = score;
          best = food.idx;
        }
      }
      return best;
    }

    reachedNodes() {
      const nodes = [this.origin];
      for (const food of this.foods) {
        if (food.reached) nodes.push(food);
      }
      return nodes;
    }

    spawnAgent(node, explicitTarget) {
      if (this.agents.length >= this.maxAgents) return;
      const wild = Math.random() < 0.12;
      let target = explicitTarget;
      if (target === undefined || target === null) {
        target = this.pickTarget(node.gx, node.gy);
      }
      this.agents.push({
        x: node.gx + (Math.random() - 0.5) * 3,
        y: node.gy + (Math.random() - 0.5) * 3,
        angle: Math.random() * TAU,
        speed: wild ? 0.28 + Math.random() * 0.11 : 0.34 + Math.random() * 0.15,
        age: 0,
        maxAge: 760 + Math.random() * 900,
        target,
        wild,
        wobble: Math.random() * TAU,
      });
    }

    spawnBurst(node, count) {
      for (let i = 0; i < count; i += 1) {
        if (this.agents.length >= this.maxAgents) break;
        this.spawnAgent(node);
      }
    }

    randomReachedNode() {
      const nodes = this.reachedNodes();
      return nodes[Math.floor(Math.random() * nodes.length)];
    }

    sampleTrail(x, y) {
      if (x < 0 || y < 0 || x >= this.gw || y >= this.gh) return -1;
      return this.trail[(y | 0) * this.gw + (x | 0)];
    }

    hitFood(x, y) {
      const r2 = this.reachRadius * this.reachRadius;
      for (const food of this.foods) {
        if (food.reached) continue;
        const dx = food.gx - x;
        const dy = food.gy - y;
        if (dx * dx + dy * dy <= r2) return food;
      }
      return null;
    }

    reachFood(food) {
      if (food.reached) return;
      food.reached = true;
      this.reachedCount += 1;
      if (this.onReach) {
        this.onReach(food.idx);
      }

      this.spawnBurst(food, 140);

      if (this.reachedCount >= this.foods.length) {
        this.allReachedAt = performance.now();
        this.state = "settling";
        for (let i = 0; i < 4; i += 1) {
          this.spawnBurst(this.randomReachedNode(), 70);
        }
      }
    }

    step(dt) {
      if (this.finished) return;

      this.elapsed = (performance.now() - this.startTime) / 1000;

      if (this.state === "growing" && !this.allReachedAt) {
        this.spawnAccumulator += dt * this.spawnRate;
        let guard = 0;
        while (
          this.spawnAccumulator >= 1 &&
          this.agents.length < this.maxAgents &&
          guard < 24
        ) {
          this.spawnAccumulator -= 1;
          this.spawnAgent(this.randomReachedNode());
          guard += 1;
        }
      }

      const trail = this.trail;
      const gw = this.gw;
      const gh = this.gh;

      for (let i = this.agents.length - 1; i >= 0; i -= 1) {
        const agent = this.agents[i];
        agent.age += 1;

        let target = this.foods[agent.target];
        if (
          !target ||
          (target.reached && this.reachedCount < this.foods.length)
        ) {
          agent.target = this.pickTarget(agent.x, agent.y);
          target = this.foods[agent.target];
        }

        const forward = this.sampleTrail(
          agent.x + Math.cos(agent.angle) * this.senseDistance,
          agent.y + Math.sin(agent.angle) * this.senseDistance
        );
        const left = this.sampleTrail(
          agent.x + Math.cos(agent.angle - this.senseAngle) * this.senseDistance,
          agent.y + Math.sin(agent.angle - this.senseAngle) * this.senseDistance
        );
        const right = this.sampleTrail(
          agent.x + Math.cos(agent.angle + this.senseAngle) * this.senseDistance,
          agent.y + Math.sin(agent.angle + this.senseAngle) * this.senseDistance
        );

        let trailDirection = agent.angle;
        let bestTrail = forward;
        if (left > bestTrail) {
          bestTrail = left;
          trailDirection = agent.angle - this.senseAngle;
        }
        if (right > bestTrail) {
          bestTrail = right;
          trailDirection = agent.angle + this.senseAngle;
        }

        let desiredDirection = agent.angle;
        if (target && !target.reached) {
          const dx = target.gx - agent.x;
          const dy = target.gy - agent.y;
          const distance = Math.hypot(dx, dy);
          const targetDirection = Math.atan2(dy, dx);
          const targetMix = agent.wild
            ? 0.28
            : clamp(0.56 + (distance < 70 ? 0.16 : 0), 0, 0.86);
          if (bestTrail < 0.035) {
            desiredDirection = targetDirection;
          } else {
            desiredDirection =
              trailDirection +
              normalizeAngle(targetDirection - trailDirection) * targetMix;
          }
        } else if (bestTrail > 0.035) {
          desiredDirection = trailDirection;
        } else {
          desiredDirection = agent.angle + (Math.random() - 0.5) * 0.5;
        }

        const turn = normalizeAngle(desiredDirection - agent.angle);
        agent.angle += turn * (agent.wild ? 0.13 : 0.21);
        agent.angle +=
          (Math.random() - 0.5) * (agent.wild ? 0.26 : 0.062) +
          Math.sin(agent.wobble + agent.age * 0.016) * 0.008;

        agent.x += Math.cos(agent.angle) * agent.speed;
        agent.y += Math.sin(agent.angle) * agent.speed;

        if (agent.x < 2) {
          agent.x = 2;
          agent.angle = Math.PI - agent.angle;
        } else if (agent.x > gw - 2) {
          agent.x = gw - 2;
          agent.angle = Math.PI - agent.angle;
        }
        if (agent.y < 2) {
          agent.y = 2;
          agent.angle = -agent.angle;
        } else if (agent.y > gh - 2) {
          agent.y = gh - 2;
          agent.angle = -agent.angle;
        }

        const gx = agent.x | 0;
        const gy = agent.y | 0;
        if (gx > 0 && gy > 0 && gx < gw - 1 && gy < gh - 1) {
          const index = gy * gw + gx;
          const current = trail[index];
          trail[index] = Math.min(
            28,
            current + this.deposit / (1 + current * 0.12)
          );
        }

        const hit = this.hitFood(agent.x, agent.y);
        if (hit) {
          this.reachFood(hit);
          agent.target = this.pickTarget(agent.x, agent.y);
        }

        if (agent.age > agent.maxAge) {
          this.agents[i] = this.agents[this.agents.length - 1];
          this.agents.pop();
        }
      }

      const next = this.nextTrail;
      const diffusion = this.diffusion;
      const centerWeight = 1 - diffusion * 4;
      const decay = this.decay;

      for (let y = 1; y < gh - 1; y += 1) {
        const row = y * gw;
        for (let x = 1; x < gw - 1; x += 1) {
          const index = row + x;
          const value =
            trail[index] * centerWeight +
            (trail[index - 1] +
              trail[index + 1] +
              trail[index - gw] +
              trail[index + gw]) *
              diffusion;
          next[index] = value * decay;
        }
      }

      const oldTrail = this.trail;
      this.trail = this.nextTrail;
      this.nextTrail = oldTrail;
      this.trailDirty = true;
      this.stepCount += 1;

      const now = performance.now();
      if (!this.reportedComplete) {
        if (
          (this.allReachedAt && now - this.allReachedAt > 1800) ||
          now - this.startTime > 19000
        ) {
          this.finish(now);
        }
      }
    }

    finish(now) {
      if (this.reportedComplete) return;
      this.reportedComplete = true;
      this.finished = true;
      this.state = "done";
      this.duration = (now - this.startTime) / 1000;
      if (this.onComplete) this.onComplete();
    }

    update(dt) {
      if (this.finished) return;
      this.accumulator += dt;
      for (const agent of this.agents) {
        agent.fromX = agent.x;
        agent.fromY = agent.y;
      }
      let steps = 0;
      while (this.accumulator >= 1 / 60 && steps < 2) {
        this.accumulator -= 1 / 60;
        this.step(1 / 60);
        steps += 1;
        if (this.finished) break;
      }
      if (steps > 0) {
        this.stampFrame = (this.stampFrame || 0) + 1;
        if (this.stampFrame % 2 === 0) {
          this.fadeFilaments(0.018);
        }
        this.stampFilaments(this.agents);
      }
      if (this.accumulator > 0.12) this.accumulator = 0;
    }

    updateTrailTexture() {
      const data = this.trailData;
      const trail = this.trail;
      const count = trail.length;
      for (let i = 0; i < count; i += 1) {
        const value = trail[i];
        const offset = i * 4;
        if (value < 0.035) {
          data[offset + 3] = 0;
          continue;
        }
        const tone = 1 - Math.exp(-Math.max(0, value - 0.1) * 0.62);
        const alpha = Math.min(232, Math.pow(tone, 1.7) * 252);
        data[offset] = 82 + 126 * tone;
        data[offset + 1] = 113 + 112 * tone;
        data[offset + 2] = 80 + 76 * tone;
        data[offset + 3] = alpha;
      }
      this.trailContext.putImageData(this.trailImage, 0, 0);
      this.trailDirty = false;
    }

    drawTrails(now, opacity = 1) {
      if (!this.trail) return;
      this.textureFrame = (this.textureFrame || 0) + 1;
      if (
        this.trailDirty &&
        (this.textureFrame % 2 === 0 || this.finished || this.solved)
      ) {
        this.updateTrailTexture();
      }
      const ctx = this.ctx;
      const W = this.W;
      const H = this.H;

      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.globalCompositeOperation = "lighter";

      ctx.globalAlpha = 0.14 * opacity;
      ctx.drawImage(this.trailCanvas, -5, -5, W + 10, H + 10);

      ctx.globalAlpha = 0.46 * opacity;
      ctx.drawImage(this.trailCanvas, 0, 0, W, H);

      if (this.filamentCanvas) {
        ctx.globalAlpha = 0.96 * opacity;
        ctx.drawImage(this.filamentCanvas, 0, 0, W, H);
      }

      if (!this.solved) {
        ctx.fillStyle = "rgba(238, 250, 196, 0.6)";
        ctx.globalAlpha = 0.28 * opacity;
        for (let i = 0; i < this.agents.length; i += 9) {
          const agent = this.agents[i];
          ctx.fillRect(agent.x * this.cellX, agent.y * this.cellY, 0.85, 0.85);
        }
      }

      ctx.restore();
    }

    solve() {
      if (this.result) return this.result;
      const now = performance.now();
      const gw = this.gw;
      const gh = this.gh;
      const W = this.W;
      const H = this.H;
      const count = gw * gh;

      const terms = [
        {
          nx: this.origin.nx,
          ny: this.origin.ny,
          name: "origin",
        },
        ...this.foods.map((food, index) => ({
          nx: food.nx,
          ny: food.ny,
          name: `food-${index}`,
        })),
      ];

      const termCells = Array.from(
        new Set(
          terms.map((term) =>
            clamp(
              Math.round(term.ny * gh) * gw + Math.round(term.nx * gw),
              0,
              count - 1
            )
          )
        )
      );

      const cost = new Float32Array(count);
      for (let i = 0; i < count; i += 1) {
        const value = Math.max(0, this.trail[i]);
        cost[i] = 0.35 + 11 / (1 + value * 3.2);
      }

      const searches = [];
      for (let i = 0; i < terms.length; i += 1) {
        const start = clamp(
          Math.round(terms[i].ny * gh) * gw + Math.round(terms[i].nx * gw),
          0,
          count - 1
        );
        searches.push(
          computeDijkstra(start, termCells, count, gw, gh, cost)
        );
      }

      const n = terms.length;
      const cells = terms.map((term) =>
        clamp(
          Math.round(term.ny * gh) * gw + Math.round(term.nx * gw),
          0,
          count - 1
        )
      );

      const inTree = new Uint8Array(n);
      const best = new Float64Array(n);
      best.fill(Infinity);
      const parent = new Int32Array(n);
      parent.fill(-1);
      best[0] = 0;
      const edges = [];

      for (let iteration = 0; iteration < n; iteration += 1) {
        let vertex = -1;
        for (let i = 0; i < n; i += 1) {
          if (!inTree[i] && (vertex === -1 || best[i] < best[vertex])) {
            vertex = i;
          }
        }
        if (vertex === -1 || !isFinite(best[vertex])) break;
        inTree[vertex] = 1;
        if (parent[vertex] !== -1) {
          edges.push({ a: parent[vertex], b: vertex });
        }
        for (let u = 0; u < n; u += 1) {
          if (inTree[u]) continue;
          const distance = searches[vertex].dist[cells[u]];
          if (distance < best[u]) {
            best[u] = distance;
            parent[u] = vertex;
          }
        }
      }

      const adjacency = Array.from({ length: n }, () => []);
      edges.forEach((edge, index) => {
        adjacency[edge.a].push({ node: edge.b, index });
        adjacency[edge.b].push({ node: edge.a, index });
      });
      const levels = new Int32Array(n);
      levels.fill(-1);
      levels[0] = 0;
      const queue = [0];
      while (queue.length) {
        const current = queue.shift();
        for (const connection of adjacency[current]) {
          if (levels[connection.node] === -1) {
            levels[connection.node] = levels[current] + 1;
            queue.push(connection.node);
          }
        }
      }

      const seenEdges = new Set();
      let networkLength = 0;
      const paths = [];
      const cellW = W / gw;
      const cellH = H / gh;

      const addUniqueCellEdge = (from, to) => {
        const key = from < to ? from * count + to : to * count + from;
        if (seenEdges.has(key)) return;
        seenEdges.add(key);
        const ax = (from % gw) * cellW;
        const ay = ((from / gw) | 0) * cellH;
        const bx = (to % gw) * cellW;
        const by = ((to / gw) | 0) * cellH;
        networkLength += Math.hypot(bx - ax, by - ay);
      };

      for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
        const edge = edges[edgeIndex];
        let raw = [];
        const search = searches[edge.a];
        let current = cells[edge.b];
        let target = cells[edge.a];
        const guardLimit = count + 8;
        let guard = 0;
        while (current !== -1 && guard < guardLimit) {
          raw.push(current);
          if (current === target) break;
          current = search.previous[current];
          guard += 1;
        }

        if (raw.length < 2 || raw[raw.length - 1] !== target) {
          raw = [cells[edge.a], cells[edge.b]];
        } else {
          raw.reverse();
        }

        if (raw.length === 2 && raw[0] === raw[1]) {
          continue;
        }

        for (let i = 1; i < raw.length; i += 1) {
          addUniqueCellEdge(raw[i - 1], raw[i]);
        }

        let points = raw.map((cell) => ({
          x: (cell % gw) * cellW,
          y: ((cell / gw) | 0) * cellH,
        }));

        const startTerm = terms[edge.a];
        const endTerm = terms[edge.b];
        points[0] = { x: startTerm.nx * W, y: startTerm.ny * H };
        points[points.length - 1] = { x: endTerm.nx * W, y: endTerm.ny * H };

        if (levels[edge.a] > levels[edge.b]) {
          points.reverse();
        }

        points = simplifyPoints(points, 2.2);
        points = chaikin(chaikin(points));
        const normalized = points.map((point) => ({
          x: point.x / W,
          y: point.y / H,
        }));
        const cumulative = cumulativeLengths(normalized);
        const level = Math.max(levels[edge.a], levels[edge.b], 0);
        paths.push({
          points: normalized,
          cumulative,
          level,
          delay: 0.08 + level * 0.15 + edgeIndex * 0.035,
          pulses: [],
        });
      }

      const coveredNodes = new Set([0]);
      edges.forEach((edge) => {
        coveredNodes.add(edge.a);
        coveredNodes.add(edge.b);
      });

      // If a terminal could not be reached on the pheromone field, keep the
      // result legible with a quiet direct fallback instead of dropping it.
      const addFallbackPath = (nodeIndex) => {
        if (nodeIndex === 0 || coveredNodes.has(nodeIndex)) return;
        const start = { x: terms[0].nx * W, y: terms[0].ny * H };
        const end = { x: terms[nodeIndex].nx * W, y: terms[nodeIndex].ny * H };
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.hypot(dx, dy);
        if (length < 2) return;
        const bow = Math.min(70, length * 0.09) * (nodeIndex % 2 === 0 ? 1 : -1);
        const control = {
          x: (start.x + end.x) * 0.5 - (dy / length) * bow,
          y: (start.y + end.y) * 0.5 + (dx / length) * bow,
        };
        let points = [];
        const steps = 28;
        for (let i = 0; i <= steps; i += 1) {
          const t = i / steps;
          const inverse = 1 - t;
          points.push({
            x:
              inverse * inverse * start.x +
              2 * inverse * t * control.x +
              t * t * end.x,
            y:
              inverse * inverse * start.y +
              2 * inverse * t * control.y +
              t * t * end.y,
          });
        }
        points = chaikin(points);
        const normalized = points.map((point) => ({
          x: point.x / W,
          y: point.y / H,
        }));
        const cumulative = cumulativeLengths(normalized);
        networkLength += length;
        coveredNodes.add(nodeIndex);
        paths.push({
          points: normalized,
          cumulative,
          level: 1,
          delay: 0.2,
          pulses: [],
        });
      };

      for (let i = 1; i < n; i += 1) {
        addFallbackPath(i);
      }

      paths.sort((a, b) => a.level - b.level || a.delay - b.delay);
      paths.forEach((path, index) => {
        const length = path.cumulative[path.cumulative.length - 1];
        const pulseCount = clamp(Math.round(length / 0.32), 1, 2);
        path.pulses = Array.from({ length: pulseCount }, (_, pulseIndex) => ({
          offset: (pulseIndex + Math.random()) / pulseCount,
          speed: 0.025 + Math.random() * 0.024,
          size: 14 + Math.random() * 9,
        }));
        path.revealDelay = 0.12 + index * 0.12;
        path.revealDuration = 0.78;
      });

      this.result = {
        paths,
        networkLength,
        duration: this.duration,
        foodCount: this.foods.length,
        nodeCount: coveredNodes.size,
        origin: this.origin,
        foods: this.foods,
        createdAt: now,
      };
      this.resultStart = now;
      this.solved = true;
      this.trailDirty = true;
      return this.result;
    }

    drawNetwork(now) {
      if (!this.result) return;
      const ctx = this.ctx;
      const W = this.W;
      const H = this.H;
      const elapsed = (now - this.resultStart) / 1000;
      const paths = this.result.paths;

      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      const visible = [];
      for (const path of paths) {
        const fraction = clamp(
          (elapsed - path.revealDelay) / path.revealDuration,
          0,
          1
        );
        if (fraction <= 0) continue;
        const eased = easeOutCubic(fraction);
        const partial = partialPoints(path.points, path.cumulative, eased);
        if (partial.length < 2) continue;
        visible.push({ path, fraction, partial });
      }

      // A soft under-vein, used as a diffused aura.
      ctx.globalCompositeOperation = "lighter";
      for (const item of visible) {
        const points = item.partial.map((point) => ({
          x: point.x * W,
          y: point.y * H,
        }));
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i += 1) {
          ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.strokeStyle = "rgba(169, 207, 107, 0.105)";
        ctx.lineWidth = 9.5;
        ctx.stroke();

        ctx.strokeStyle = "rgba(191, 224, 138, 0.16)";
        ctx.lineWidth = 4.2;
        ctx.stroke();
      }

      // The living edge.
      for (const item of visible) {
        const points = item.partial.map((point) => ({
          x: point.x * W,
          y: point.y * H,
        }));
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i += 1) {
          ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.strokeStyle = "rgba(220, 242, 167, 0.68)";
        ctx.lineWidth = 1.65;
        ctx.stroke();

        ctx.strokeStyle = "rgba(248, 255, 220, 0.92)";
        ctx.lineWidth = 0.7;
        ctx.stroke();

        if (item.fraction < 1) {
          const tip = points[points.length - 1];
          const radius = 7 + Math.sin(now * 0.008) * 1.4;
          const glow = ctx.createRadialGradient(
            tip.x,
            tip.y,
            0,
            tip.x,
            tip.y,
            radius * 3
          );
          glow.addColorStop(0, "rgba(245, 255, 213, 0.72)");
          glow.addColorStop(0.3, "rgba(211, 240, 152, 0.28)");
          glow.addColorStop(1, "rgba(211, 240, 152, 0)");
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(tip.x, tip.y, radius * 3, 0, TAU);
          ctx.fill();
        }
      }

      // Pulses drift out from the origin through the finished veins.
      const revealDone = visible.length === paths.length && visible.every((item) => item.fraction >= 1);
      if (revealDone) {
        const fade = clamp((elapsed - 1.6) / 0.8, 0, 1);
        if (fade > 0) {
          for (const path of paths) {
            for (const pulse of path.pulses) {
              const fraction = (pulse.offset + elapsed * pulse.speed) % 1;
              if (fraction <= 0.02 || fraction >= 0.985) continue;
              const point = pointAtFraction(path.points, path.cumulative, fraction);
              const x = point.x * W;
              const y = point.y * H;
              const size = pulse.size * (0.85 + Math.sin(elapsed * 2 + pulse.offset * 12) * 0.15);
              ctx.globalAlpha = 0.42 * fade;
              ctx.drawImage(
                this.pulseSprite,
                x - size,
                y - size,
                size * 2,
                size * 2
              );
              ctx.globalAlpha = 0.8 * fade;
              ctx.fillStyle = "rgba(249, 255, 225, 0.9)";
              ctx.beginPath();
              ctx.arc(x, y, 1.2, 0, TAU);
              ctx.fill();
            }
          }
          ctx.globalAlpha = 1;
        }
      }

      ctx.restore();
    }
  }

  /* --------------------------------------------------------------------------
     App state / rendering
  -------------------------------------------------------------------------- */

  let backdrop = null;
  let culture = null;
  let resizeTimer = 0;
  let lastFrame = performance.now();
  let lastBackdropFrame = 0;
  let lastHudFrame = 0;

  function phaseLabel(phase, immediate = false) {
    const copy = PHASE_COPY[phase] || PHASE_COPY.landing;
    if (immediate) {
      dom.phaseIndex.textContent = copy.index;
      dom.phaseText.textContent = copy.text;
      dom.phaseDisplay.classList.remove("is-changing");
      return;
    }
    dom.phaseDisplay.classList.add("is-changing");
    window.clearTimeout(state.phaseTimer);
    state.phaseTimer = window.setTimeout(() => {
      dom.phaseIndex.textContent = copy.index;
      dom.phaseText.textContent = copy.text;
      dom.phaseDisplay.classList.remove("is-changing");
    }, 180);
  }

  function syncResetVisibility() {
    const visible =
      state.phase !== "landing" &&
      (state.phase !== "placing" || state.foods.length > 0);
    dom.resetBtn.classList.toggle("is-visible", visible);
    dom.resetBtn.disabled = !visible;
    dom.simCanvas.tabIndex = state.phase === "placing" ? 0 : -1;
  }

  function setPhase(phase) {
    state.phase = phase;
    dom.app.dataset.phase = phase;
    phaseLabel(phase);
    syncResetVisibility();

    if (phase !== "placing") {
      hideCursor();
    }

    if (phase === "placing") {
      dom.resultPanel.setAttribute("aria-hidden", "true");
    } else if (phase !== "result") {
      dom.resultPanel.setAttribute("aria-hidden", "true");
    }
  }

  function updateGuide() {
    const count = state.foods.length;
    dom.foodCount.textContent = pad2(count);
    dom.guideStepPlace.classList.toggle("is-active", count === 0);
    dom.guideStepStart.classList.toggle("is-active", count > 0);
    dom.canvasPrompt.classList.toggle("is-hidden", count > 0);

    if (count === 0) {
      dom.guideHint.textContent = "建议放置 3–6 处食物，最后右键种下菌核";
    } else if (count < 3) {
      dom.guideHint.textContent = `已放置 ${count} 处 · 可继续添加，或右键开始演化`;
    } else {
      dom.guideHint.textContent = "右键种下菌核，开始脉络演化";
    }

    dom.beginBtn.disabled = count === 0;
    dom.beginBtn.textContent = count === 0 ? "先放置食物" : "开始演化";
    syncResetVisibility();
  }

  function updateHud(now) {
    if (!state.engine) return;
    const engine = state.engine;
    const connected = engine.reachedCount;
    const total = engine.foods.length;
    dom.hudTime.textContent = formatSeconds((now - engine.startTime) / 1000);
    dom.hudNodes.textContent = `${connected} / ${total}`;
    dom.hudAgents.textContent = formatInt(engine.agents.length);

    if (state.phase === "converging") {
      dom.hudLabel.textContent = "CONVERGING / 正在求解最优脉络";
    } else if (connected >= total) {
      dom.hudLabel.textContent = "LIVE / 网络贯通 · 正在收敛";
    } else {
      dom.hudLabel.textContent = "LIVE / 网络生长中";
    }
  }

  function showToast(text, duration = 2300) {
    dom.toastText.textContent = text;
    dom.toast.classList.add("is-visible");
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => {
      dom.toast.classList.remove("is-visible");
    }, duration);
  }

  function hideToast() {
    window.clearTimeout(state.toastTimer);
    dom.toast.classList.remove("is-visible");
  }

  function addRipple(x, y, type = "food") {
    const palette =
      type === "origin"
        ? { color: "217, 238, 156", alpha: 0.55, max: 118 }
        : type === "reach"
          ? { color: "217, 238, 156", alpha: 0.4, max: 74 }
          : { color: "235, 217, 172", alpha: 0.5, max: 54 };
    state.ripples.push({
      x,
      y,
      start: performance.now(),
      duration: type === "origin" ? 1300 : 900,
      maxRadius: palette.max,
      color: palette.color,
      alpha: palette.alpha,
      type,
    });
  }

  function drawRipples(now) {
    const ctx = simCtx;
    state.ripples = state.ripples.filter((ripple) => {
      const progress = (now - ripple.start) / ripple.duration;
      if (progress < 0 || progress > 1) return false;
      const eased = easeOutCubic(progress);
      const radius = lerp(0, ripple.maxRadius, eased);
      const alpha = ripple.alpha * (1 - progress);
      ctx.beginPath();
      ctx.arc(ripple.x, ripple.y, radius, 0, TAU);
      ctx.strokeStyle = `rgba(${ripple.color}, ${alpha})`;
      ctx.lineWidth = ripple.type === "origin" ? 1 : 0.8;
      ctx.stroke();

      if (ripple.type === "reach") {
        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, radius * 0.66, 0, TAU);
        ctx.strokeStyle = `rgba(${ripple.color}, ${alpha * 0.45})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
      return true;
    });
  }

  function drawFoodMarkers(now) {
    const ctx = simCtx;
    const time = now / 1000;

    state.foods.forEach((food, index) => {
      const x = food.nx * W;
      const y = food.ny * H;
      const born = clamp((now - food.bornAt) / 520, 0, 1);
      const appear = easeOutCubic(born);
      const pulse = (Math.sin(time * 1.7 + index * 1.31) + 1) * 0.5;
      const active = food.reached;
      const color = active ? "217, 238, 156" : "235, 217, 172";
      const ringRadius = 8.6 + pulse * 0.7;

      ctx.save();
      ctx.translate(x, y);

      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 26);
      glow.addColorStop(0, `rgba(${color}, ${active ? 0.18 : 0.13})`);
      glow.addColorStop(0.38, `rgba(${color}, ${active ? 0.075 : 0.05})`);
      glow.addColorStop(1, `rgba(${color}, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, 26, 0, TAU);
      ctx.fill();

      ctx.scale(appear, appear);
      ctx.globalAlpha = appear;

      ctx.beginPath();
      ctx.arc(0, 0, ringRadius, 0, TAU);
      ctx.strokeStyle = `rgba(${color}, ${active ? 0.62 : 0.38})`;
      ctx.lineWidth = 0.7;
      ctx.stroke();

      ctx.beginPath();
      ctx.setLineDash([1.8, 5.4]);
      ctx.lineDashOffset = -time * (active ? 9 : 5);
      ctx.arc(0, 0, ringRadius + 4.2, 0, TAU);
      ctx.strokeStyle = `rgba(${color}, ${active ? 0.28 : 0.17})`;
      ctx.lineWidth = 0.6;
      ctx.stroke();
      ctx.setLineDash([]);

      const crossLength = 2.8;
      const crossOffset = 12.4;
      ctx.strokeStyle = `rgba(${color}, 0.34)`;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(-crossOffset - crossLength, 0);
      ctx.lineTo(-crossOffset, 0);
      ctx.moveTo(crossOffset, 0);
      ctx.lineTo(crossOffset + crossLength, 0);
      ctx.moveTo(0, -crossOffset - crossLength);
      ctx.lineTo(0, -crossOffset);
      ctx.moveTo(0, crossOffset);
      ctx.lineTo(0, crossOffset + crossLength);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, 0, 2.15, 0, TAU);
      ctx.fillStyle = active ? "rgba(226, 247, 169, 0.98)" : "rgba(244, 231, 199, 0.92)";
      ctx.fill();

      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, TAU);
      ctx.fillStyle = "rgba(255, 255, 244, 0.95)";
      ctx.fill();

      ctx.restore();

      if (appear > 0.45) {
        const placeLeft = x > W - 90;
        const labelX = placeLeft ? x - 21 : x + 21;
        const labelY = y - 16;
        ctx.save();
        ctx.globalAlpha = appear;
        ctx.strokeStyle = "rgba(235, 240, 223, 0.2)";
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(x + (placeLeft ? -8 : 8), y - 8);
        ctx.lineTo(x + (placeLeft ? -16 : 16), y - 14);
        ctx.stroke();

        ctx.font = '500 7.5px "Manrope", "Segoe UI", sans-serif';
        ctx.fillStyle = active ? "rgba(217, 238, 156, 0.8)" : "rgba(238, 242, 229, 0.54)";
        ctx.textAlign = placeLeft ? "right" : "left";
        ctx.textBaseline = "middle";
        ctx.fillText(`0${index + 1}`, labelX, labelY);
        ctx.restore();
      }
    });
  }

  function drawOrigin(now) {
    if (!state.origin) return;
    const ctx = simCtx;
    const x = state.origin.nx * W;
    const y = state.origin.ny * H;
    const time = now / 1000;
    const gone = state.phase === "result" ? 0.6 : 1;

    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = gone;

    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 34);
    glow.addColorStop(0, "rgba(217, 238, 156, 0.24)");
    glow.addColorStop(0.4, "rgba(217, 238, 156, 0.075)");
    glow.addColorStop(1, "rgba(217, 238, 156, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 34, 0, TAU);
    ctx.fill();

    const pulse = (Math.sin(time * 1.45) + 1) * 0.5;
    ctx.strokeStyle = `rgba(217, 238, 156, ${0.22 + pulse * 0.08})`;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(0, 0, 15.5 + pulse * 1.6, 0, TAU);
    ctx.stroke();

    ctx.strokeStyle = "rgba(217, 238, 156, 0.18)";
    ctx.beginPath();
    ctx.arc(0, 0, 22.5, 0, TAU);
    ctx.stroke();

    ctx.save();
    ctx.rotate(time * 0.22);
    ctx.beginPath();
    ctx.setLineDash([2.4, 7]);
    ctx.arc(0, 0, 26.5, 0, TAU);
    ctx.strokeStyle = "rgba(217, 238, 156, 0.22)";
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(0, 0, 3.1, 0, TAU);
    ctx.fillStyle = "rgba(236, 250, 189, 0.95)";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, 1.15, 0, TAU);
    ctx.fillStyle = "rgba(255, 255, 238, 1)";
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = gone * 0.72;
    ctx.font = '500 7px "Manrope", "Segoe UI", sans-serif';
    ctx.fillStyle = "rgba(238, 242, 229, 0.5)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const labelY = y > H - 280 ? y - 34 : y + 34;
    ctx.fillText("菌核 / ORIGIN", x, labelY);
    ctx.restore();
  }

  function renderStage(now) {
    const ctx = simCtx;
    ctx.clearRect(0, 0, W, H);

    if (state.engine) {
      const trailOpacity =
        state.phase === "result" ? 0.11 : state.phase === "converging" ? 0.4 : 1;
      state.engine.drawTrails(now, trailOpacity);
      if (state.phase === "result" && state.engine.solved) {
        state.engine.drawNetwork(now);
      }
    }

    drawRipples(now);
    drawFoodMarkers(now);
    drawOrigin(now);
  }

  function loop(now) {
    try {
      const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
      lastFrame = now;

      if (backdrop && now - lastBackdropFrame > 45) {
        backdrop.draw(now, dt);
        lastBackdropFrame = now;
      }
      if (state.phase === "landing" && culture) {
        culture.draw(now);
      }

      if (state.phase !== "landing") {
        if (
          state.engine &&
          !state.modalOpen &&
          (state.phase === "evolving" || state.phase === "converging")
        ) {
          state.engine.update(dt);
          if (now - lastHudFrame > 110) {
            updateHud(now);
            lastHudFrame = now;
          }
        }
        renderStage(now);
      }
    } catch (error) {
      console.error("Mycelium render frame failed:", error);
    } finally {
      requestAnimationFrame(loop);
    }
  }

  /* --------------------------------------------------------------------------
     Interaction
  -------------------------------------------------------------------------- */

  function enterExperiment() {
    if (state.phase !== "landing") return;
    state.foods = [];
    state.origin = null;
    state.engine = null;
    state.result = null;
    state.ripples = [];
    state.runToken += 1;
    hideToast();
    updateGuide();
    setPhase("placing");
    addRipple(W * 0.5, H * 0.52, "food");
    dom.simCanvas.focus({ preventScroll: true });
  }

  function resetExperiment(showMessage = true) {
    state.runToken += 1;
    state.counterToken += 1;
    for (const timer of state.timers) window.clearTimeout(timer);
    state.timers.clear();
    window.clearTimeout(state.phaseTimer);

    state.engine = null;
    state.foods = [];
    state.origin = null;
    state.result = null;
    state.ripples = [];

    dom.resultPanel.setAttribute("aria-hidden", "true");
    dom.statFoods.innerHTML = '<span class="stat-number">0</span>';
    dom.statLength.innerHTML = '<span class="stat-number">0</span><small>px</small>';
    dom.statDuration.innerHTML = '<span class="stat-number">0.0</span><small>s</small>';
    hideCursor();
    updateGuide();
    setPhase("placing");
    showToast(showMessage ? "画布已清空 · 左键放置食物" : "已开始新的实验", 1800);
    dom.simCanvas.focus({ preventScroll: true });
  }

  function addFood(x, y) {
    if (state.phase !== "placing") return;
    if (state.foods.length >= 8) {
      showToast("营养源已达到上限（8 处）");
      return;
    }

    const point = safePoint(x, y);
    if (
      state.foods.some(
        (food) => Math.hypot(food.nx * W - point.x, food.ny * H - point.y) < 38
      )
    ) {
      showToast("这里已经有一处食物了");
      return;
    }

    state.foods.push({
      nx: point.x / W,
      ny: point.y / H,
      reached: false,
      bornAt: performance.now(),
    });
    addRipple(point.x, point.y, "food");
    updateGuide();
    syncResetVisibility();
  }

  function findAutomaticOrigin() {
    const candidates = [
      [0.5, 0.5],
      [0.5, 0.38],
      [0.5, 0.65],
      [0.34, 0.5],
      [0.66, 0.5],
      [0.28, 0.32],
      [0.72, 0.32],
      [0.28, 0.7],
      [0.72, 0.7],
      [0.5, 0.8],
    ];
    for (const [nx, ny] of candidates) {
      const point = safePoint(nx * W, ny * H);
      const clear = state.foods.every(
        (food) => Math.hypot(food.nx * W - point.x, food.ny * H - point.y) >= 38
      );
      if (clear) return point;
    }
    return safePoint(W * 0.5, H * 0.5);
  }

  function startEvolutionAt(x, y) {
    if (state.phase !== "placing") return;
    if (state.foods.length === 0) {
      showToast("请先放置至少一处食物源");
      return;
    }

    const point = safePoint(x, y);
    if (
      state.foods.some(
        (food) => Math.hypot(food.nx * W - point.x, food.ny * H - point.y) < 38
      )
    ) {
      showToast("菌核需要种在食物之外，留出一点距离");
      return;
    }

    state.origin = {
      nx: point.x / W,
      ny: point.y / H,
    };
    addRipple(point.x, point.y, "origin");

    const token = ++state.runToken;
    dom.resultPanel.setAttribute("aria-hidden", "true");
    hideToast();

    const engine = new SlimeEngine({
      canvas: dom.simCanvas,
      ctx: simCtx,
      width: W,
      height: H,
      foods: state.foods,
      origin: state.origin,
      onReach: (index) => {
        if (state.engine !== engine || token !== state.runToken) return;
        const food = state.foods[index];
        if (!food) return;
        food.reached = true;
        addRipple(food.nx * W, food.ny * H, "reach");
        showToast(`NUTRIENT 0${index + 1} — 已接入脉络`, 1800);
        updateHud(performance.now());
      },
      onComplete: () => {
        if (state.engine !== engine || token !== state.runToken) return;
        handleEngineComplete(token);
      },
    });

    state.engine = engine;
    setPhase("evolving");
    updateHud(performance.now());
    showToast("菌核已种下 · 脉络开始生长", 1800);
  }

  function handleEngineComplete(token) {
    if (token !== state.runToken || !state.engine) return;
    if (state.phase !== "evolving") return;
    setPhase("converging");
    updateHud(performance.now());

    const timer = window.setTimeout(() => {
      state.timers.delete(timer);
      if (token !== state.runToken || !state.engine) return;
      const result = state.engine.solve();
      if (token !== state.runToken) return;
      showResult(result, token);
    }, 1700);
    state.timers.add(timer);
  }

  function animateCounter(element, target, decimals, duration = 1000) {
    const token = state.counterToken;
    const start = performance.now();
    const numberElement = element.querySelector(".stat-number");
    if (!numberElement) return;
    const formatter = (value) =>
      decimals > 0 ? value.toFixed(decimals) : formatInt(value);

    function frame(now) {
      if (token !== state.counterToken) return;
      const t = clamp((now - start) / duration, 0, 1);
      const value = lerp(0, target, easeOutCubic(t));
      numberElement.textContent = formatter(value);
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function showResult(result, token) {
    if (token !== state.runToken || !state.engine) return;
    state.result = result;
    for (const food of state.foods) food.reached = true;
    state.phase = "result";
    dom.app.dataset.phase = "result";
    phaseLabel("result");
    syncResetVisibility();
    hideCursor();
    dom.resultPanel.setAttribute("aria-hidden", "false");
    updateHud(performance.now());
    dom.hudLabel.textContent = "COMPLETE / 最优脉络已收敛";
    state.counterToken += 1;
    animateCounter(dom.statFoods, result.foodCount, 0, 900);
    animateCounter(dom.statLength, result.networkLength, 0, 1150);
    animateCounter(dom.statDuration, result.duration, 1, 950);
    dom.saveBtn.disabled = false;
    showToast("最优脉络已收敛 · 低效支路正在消退", 2400);
  }

  function hideCursor() {
    dom.cursor.classList.remove("is-visible", "is-down");
    state.pointer.active = false;
  }

  function updateCoordinates(x, y) {
    if (state.phase === "landing") return;
    const px = clamp(Math.round(x), 0, 9999);
    const py = clamp(Math.round(y), 0, 9999);
    dom.coordValue.textContent = `X ${String(px).padStart(4, "0")}\u00a0\u00a0Y ${String(py).padStart(4, "0")}`;
  }

  function handlePointerMove(event) {
    state.pointer.x = event.clientX;
    state.pointer.y = event.clientY;
    if (backdrop) backdrop.setPointer(event.clientX, event.clientY);
    updateCoordinates(event.clientX, event.clientY);

    if (state.modalOpen) {
      hideCursor();
      return;
    }

    const isCanvas = event.target === dom.simCanvas;
    if (state.phase === "placing" && isCanvas && event.pointerType !== "touch") {
      dom.cursor.style.left = `${event.clientX}px`;
      dom.cursor.style.top = `${event.clientY}px`;
      dom.cursor.classList.add("is-visible");
      state.pointer.active = true;
    } else if (!event.pointerType || event.pointerType !== "touch") {
      if (state.pointer.active) hideCursor();
    } else {
      dom.cursor.classList.remove("is-visible");
    }
  }

  /* --------------------------------------------------------------------------
     Export
  -------------------------------------------------------------------------- */

  function saveArtwork() {
    if (state.phase !== "result" || !state.engine || !state.result) return;
    if (dom.saveBtn.disabled) return;

    dom.saveBtn.disabled = true;
    const original = dom.saveBtn.innerHTML;
    dom.saveBtn.innerHTML = "正在生成…";
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      dom.saveBtn.disabled = false;
      dom.saveBtn.innerHTML = original;
    };

    const create = () => {
      if (state.phase !== "result" || !state.result || !state.engine) {
        finish();
        return;
      }
      try {
      const source = dom.simCanvas;      const outWidth = Math.min(2800, Math.max(1600, Math.round(W * 2)));
      const outHeight = Math.round(outWidth * (H / W));
      const canvas = document.createElement("canvas");
      canvas.width = outWidth;
      canvas.height = outHeight;
      const ctx = canvas.getContext("2d");
      const pad = Math.round(outWidth * 0.055);

      const background = ctx.createLinearGradient(0, 0, outWidth, outHeight);
      background.addColorStop(0, "#070a08");
      background.addColorStop(0.55, "#0a0e0a");
      background.addColorStop(1, "#060906");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, outWidth, outHeight);

      const atmosphere = ctx.createRadialGradient(
        outWidth * 0.76,
        outHeight * 0.38,
        0,
        outWidth * 0.76,
        outHeight * 0.38,
        outWidth * 0.55
      );
      atmosphere.addColorStop(0, "rgba(105, 135, 80, 0.16)");
      atmosphere.addColorStop(1, "rgba(105, 135, 80, 0)");
      ctx.fillStyle = atmosphere;
      ctx.fillRect(0, 0, outWidth, outHeight);

      ctx.drawImage(source, 0, 0, outWidth, outHeight);

      const scrim = ctx.createLinearGradient(0, outHeight * 0.52, 0, outHeight);
      scrim.addColorStop(0, "rgba(5, 8, 6, 0)");
      scrim.addColorStop(0.62, "rgba(5, 8, 6, 0.58)");
      scrim.addColorStop(1, "rgba(5, 8, 6, 0.94)");
      ctx.fillStyle = scrim;
      ctx.fillRect(0, 0, outWidth, outHeight);

      ctx.strokeStyle = "rgba(226, 237, 215, 0.14)";
      ctx.lineWidth = Math.max(1, outWidth / 1800);
      ctx.strokeRect(pad, pad, outWidth - pad * 2, outHeight - pad * 2);

      const displayScale = outWidth / 2400;
      ctx.fillStyle = "rgba(238, 242, 229, 0.9)";
      ctx.font = `300 ${34 * displayScale}px "Noto Serif SC", "Songti SC", serif`;
      ctx.fillText("菌络", pad + 42 * displayScale, pad + 60 * displayScale);

      ctx.fillStyle = "rgba(238, 242, 229, 0.36)";
      ctx.font = `500 ${10 * displayScale}px "Manrope", "Segoe UI", sans-serif`;
      ctx.fillText(
        "MYCELIAL INTELLIGENCE  /  PHYSARUM STUDY 001",
        pad + 42 * displayScale,
        pad + 84 * displayScale
      );

      ctx.textAlign = "right";
      ctx.fillStyle = "rgba(217, 238, 156, 0.72)";
      ctx.font = `500 ${10 * displayScale}px "Manrope", "Segoe UI", sans-serif`;
      ctx.fillText(
        "RESULT / OPTIMAL NETWORK",
        outWidth - pad - 42 * displayScale,
        pad + 60 * displayScale
      );
      ctx.fillStyle = "rgba(238, 242, 229, 0.32)";
      ctx.fillText(
        "EVOLUTION COMPLETE",
        outWidth - pad - 42 * displayScale,
        pad + 82 * displayScale
      );
      ctx.textAlign = "left";

      const titleY = outHeight - pad - 156 * displayScale;
      const titleSize = 54 * displayScale;
      ctx.fillStyle = "rgba(238, 242, 229, 0.93)";
      ctx.font = `300 ${titleSize}px "Noto Serif SC", "Songti SC", serif`;
      ctx.fillText("它找到了路。", pad + 42 * displayScale, titleY);

      ctx.strokeStyle = "rgba(217, 238, 156, 0.44)";
      ctx.beginPath();
      ctx.moveTo(pad + 42 * displayScale, titleY + 28 * displayScale);
      ctx.lineTo(pad + 122 * displayScale, titleY + 28 * displayScale);
      ctx.stroke();

      const stats = [
        ["食物节点", String(state.result.foodCount)],
        ["网络总长", `${formatInt(state.result.networkLength)} px`],
        ["演化耗时", `${state.result.duration.toFixed(1)} s`],
      ];
      ctx.font = `500 ${9 * displayScale}px "Manrope", "Segoe UI", sans-serif`;
      stats.forEach(([label, value], index) => {
        const x = pad + 42 * displayScale + index * 190 * displayScale;
        ctx.fillStyle = "rgba(238, 242, 229, 0.34)";
        ctx.fillText(label, x, titleY + 68 * displayScale);
        ctx.fillStyle = "rgba(238, 242, 229, 0.8)";
        ctx.font = `300 ${22 * displayScale}px "Manrope", "Segoe UI", sans-serif`;
        ctx.fillText(value, x, titleY + 96 * displayScale);
        ctx.font = `500 ${9 * displayScale}px "Manrope", "Segoe UI", sans-serif`;
      });

      ctx.fillStyle = "rgba(238, 242, 229, 0.26)";
      ctx.font = `500 ${8 * displayScale}px "Manrope", "Segoe UI", sans-serif`;
      ctx.fillText(
        "BIO-COMPUTATION / 自组织网络档案",
        outWidth - pad - 280 * displayScale,
        outHeight - pad - 34 * displayScale
      );

      const filename = `junluo-network-${Date.now()}.png`;
      canvas.toBlob((blob) => {
        finish();
        if (!blob) {
          showToast("图像生成失败，请重试");
          return;
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 4000);
        showToast("结果图像已保存");
      }, "image/png");
      } catch (error) {
        console.error("Export failed:", error);
        finish();
        showToast("图像生成失败，请重试");
      }
    };

    const revealDelay = state.engine
      ? Math.max(0, 2250 - (performance.now() - state.engine.resultStart))
      : 0;

    window.setTimeout(() => {
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(create, create);
      } else {
        create();
      }
    }, revealDelay);
  }

  /* --------------------------------------------------------------------------
     Method modal
  -------------------------------------------------------------------------- */

  let lastFocused = null;

  function openMethod() {
    if (state.modalOpen) return;
    lastFocused = document.activeElement;
    state.modalOpen = true;
    hideCursor();
    dom.methodModal.classList.add("is-open");
    dom.methodModal.setAttribute("aria-hidden", "false");
    dom.methodBtn.setAttribute("aria-expanded", "true");
    document.body.classList.add("is-modal-open");
    window.setTimeout(() => dom.closeMethodBtn.focus(), 80);
  }

  function closeMethod() {
    if (!state.modalOpen) return;
    state.modalOpen = false;
    dom.methodModal.classList.remove("is-open");
    dom.methodModal.setAttribute("aria-hidden", "true");
    dom.methodBtn.setAttribute("aria-expanded", "false");
    document.body.classList.remove("is-modal-open");
    if (lastFocused && typeof lastFocused.focus === "function") {
      lastFocused.focus({ preventScroll: true });
    }
  }

  /* --------------------------------------------------------------------------
     Events / init
  -------------------------------------------------------------------------- */

  function bindEvents() {
    dom.startBtn.addEventListener("click", enterExperiment);

    dom.simCanvas.addEventListener("click", (event) => {
      if (state.phase !== "placing") return;
      if (event.button !== 0) return;
      addFood(event.clientX, event.clientY);
    });

    dom.simCanvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (state.phase !== "placing") return;
      startEvolutionAt(event.clientX, event.clientY);
    });

    dom.simCanvas.addEventListener("pointerdown", (event) => {
      if (event.button === 0) dom.cursor.classList.add("is-down");
    });

    window.addEventListener("pointerup", () => {
      dom.cursor.classList.remove("is-down");
    });

    window.addEventListener("pointermove", handlePointerMove, { passive: true });

    window.addEventListener("blur", hideCursor);
    document.addEventListener("pointerleave", hideCursor);

    dom.resetBtn.addEventListener("click", () => resetExperiment(true));
    dom.againBtn.addEventListener("click", () => resetExperiment(false));
    dom.saveBtn.addEventListener("click", saveArtwork);
    dom.beginBtn.addEventListener("click", () => {
      if (state.phase !== "placing" || state.foods.length === 0) return;
      const origin = findAutomaticOrigin();
      startEvolutionAt(origin.x, origin.y);
    });

    dom.methodBtn.addEventListener("click", openMethod);
    dom.closeMethodBtn.addEventListener("click", closeMethod);
    dom.doneMethodBtn.addEventListener("click", closeMethod);
    dom.methodModal.addEventListener("click", (event) => {
      if (event.target.closest("[data-close-modal]")) closeMethod();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.modalOpen) {
        closeMethod();
      }
    });

    window.addEventListener("resize", () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizeViewport();
        if (culture) culture.resize();
      }, 120);
    });

    document.addEventListener("visibilitychange", () => {
      lastFrame = performance.now();
    });
  }

  function init() {
    resizeViewport();
    backdrop = new Backdrop(dom.backdropCanvas);
    culture = new CultureArt(dom.cultureCanvas);
    bindEvents();
    syncResetVisibility();
    updateGuide();
    phaseLabel("landing", true);
    dom.methodBtn.setAttribute("aria-expanded", "false");
    requestAnimationFrame(loop);
  }

  init();
})();
