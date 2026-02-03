const canvas = document.getElementById('scene');
const ctx = canvas.getContext('2d');

const modeSignalBtn = document.getElementById('modeSignal');
const modeHeatBtn = document.getElementById('modeHeat');
const playToggleBtn = document.getElementById('playToggle');
const generateSignalBtn = document.getElementById('generateSignal');
const generateHeatBtn = document.getElementById('generateHeat');
const clearBtn = document.getElementById('clearGraph');

const state = {
  nodes: [],
  edges: [],
  nextNodeId: 1,
  nextEdgeId: 1,
  mode: 'signal',
  playing: false,
  drag: {
    active: false,
    startNode: null,
    current: { x: 0, y: 0 },
    longPressTimer: null,
    longPressTriggered: false,
    start: { x: 0, y: 0 },
  },
  lastTick: 0,
  time: 0,
};

const config = {
  nodeRadius: 18,
  hitRadius: 22,
  longPressMs: 320,
  signalDecay: 0.9,
  signalTransfer: 0.25,
  heatDiffusion: 0.2,
  heatCooling: 0.02,
  heatEdgeCoolingBoost: 0.03,
};

const resize = () => {
  const { width, height } = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
};

window.addEventListener('resize', resize);
resize();

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const findNodeAt = (point) => {
  return state.nodes.find((node) => distance(node, point) <= config.hitRadius) || null;
};

const edgeExists = (a, b) => {
  return state.edges.some(
    (edge) =>
      (edge.a === a.id && edge.b === b.id) ||
      (edge.a === b.id && edge.b === a.id)
  );
};

const addNode = (point) => {
  state.nodes.push({
    id: state.nextNodeId++,
    x: point.x,
    y: point.y,
    signal: 0,
    heat: 0,
    pulseHeat: false,
  });
};

const removeNode = (node) => {
  state.nodes = state.nodes.filter((item) => item.id !== node.id);
  state.edges = state.edges.filter((edge) => edge.a !== node.id && edge.b !== node.id);
};

const addEdge = (a, b) => {
  if (a.id === b.id || edgeExists(a, b)) return;
  const weight = 0.6 + Math.random() * 0.9;
  const delay = 1 + Math.floor(Math.random() * 4);
  state.edges.push({
    id: state.nextEdgeId++,
    a: a.id,
    b: b.id,
    weight,
    delay,
    bufferAB: Array(delay).fill(0),
    bufferBA: Array(delay).fill(0),
  });
};

const resetSimulation = () => {
  state.nodes.forEach((node) => {
    node.signal = 0;
    node.heat = 0;
    node.pulseHeat = false;
  });
  state.edges.forEach((edge) => {
    edge.bufferAB = Array(edge.delay).fill(0);
    edge.bufferBA = Array(edge.delay).fill(0);
  });
};

const toCanvasPoint = (event) => {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
};

const clearDrag = () => {
  state.drag.active = false;
  state.drag.startNode = null;
  state.drag.longPressTriggered = false;
  if (state.drag.longPressTimer) {
    clearTimeout(state.drag.longPressTimer);
    state.drag.longPressTimer = null;
  }
};

const handlePointerDown = (event) => {
  const point = toCanvasPoint(event);
  const targetNode = findNodeAt(point);

  if (state.playing) {
    if (targetNode) {
      if (state.mode === 'signal') {
        targetNode.signal += event.shiftKey ? -1.2 : 1.2;
      } else {
        targetNode.pulseHeat = !targetNode.pulseHeat;
      }
    }
    return;
  }

  if (targetNode) {
    state.drag.active = true;
    state.drag.startNode = targetNode;
    state.drag.start = { ...point };
    state.drag.current = { ...point };

    state.drag.longPressTimer = setTimeout(() => {
      state.drag.longPressTriggered = true;
    }, config.longPressMs);
  } else {
    addNode(point);
  }
};

const handlePointerMove = (event) => {
  if (!state.drag.active || state.playing) return;
  const point = toCanvasPoint(event);
  state.drag.current = { ...point };

  if (distance(state.drag.start, point) > 6 && !state.drag.longPressTriggered) {
    clearTimeout(state.drag.longPressTimer);
    state.drag.longPressTimer = null;
  }
};

const handlePointerUp = (event) => {
  if (state.playing) return;
  if (!state.drag.active) return;

  const point = toCanvasPoint(event);
  const targetNode = findNodeAt(point);

  if (state.drag.longPressTriggered) {
    if (targetNode && state.drag.startNode) {
      addEdge(state.drag.startNode, targetNode);
    }
  } else if (state.drag.startNode && distance(state.drag.start, point) < 6) {
    removeNode(state.drag.startNode);
  }

  clearDrag();
};

canvas.addEventListener('pointerdown', handlePointerDown);
canvas.addEventListener('pointermove', handlePointerMove);
canvas.addEventListener('pointerup', handlePointerUp);
canvas.addEventListener('pointerleave', handlePointerUp);

const stepSignal = () => {
  const incoming = new Map();
  state.nodes.forEach((node) => incoming.set(node.id, 0));

  state.edges.forEach((edge) => {
    const a = state.nodes.find((node) => node.id === edge.a);
    const b = state.nodes.find((node) => node.id === edge.b);
    if (!a || !b) return;

    const outA = a.signal * edge.weight * config.signalTransfer;
    const outB = b.signal * edge.weight * config.signalTransfer;

    edge.bufferAB.push(outA);
    edge.bufferBA.push(outB);

    const deliveredToB = edge.bufferAB.shift();
    const deliveredToA = edge.bufferBA.shift();

    incoming.set(b.id, incoming.get(b.id) + deliveredToB);
    incoming.set(a.id, incoming.get(a.id) + deliveredToA);
  });

  state.nodes.forEach((node) => {
    node.signal = node.signal * config.signalDecay + incoming.get(node.id);
  });
};

const stepHeat = () => {
  const nextValues = new Map();

  state.nodes.forEach((node) => {
    const neighbors = state.edges
      .filter((edge) => edge.a === node.id || edge.b === node.id)
      .map((edge) => (edge.a === node.id ? edge.b : edge.a))
      .map((id) => state.nodes.find((other) => other.id === id))
      .filter(Boolean);

    if (neighbors.length === 0) {
      nextValues.set(node.id, Math.max(0, node.heat - config.heatCooling));
      return;
    }

    const avg =
      neighbors.reduce((sum, item) => sum + item.heat, 0) / neighbors.length;
    let next = node.heat + (avg - node.heat) * config.heatDiffusion;

    const extraCooling = neighbors.length <= 1 ? config.heatEdgeCoolingBoost : 0;
    next = Math.max(0, next - config.heatCooling - extraCooling);
    nextValues.set(node.id, next);
  });

  state.nodes.forEach((node) => {
    node.heat = nextValues.get(node.id);
    if (node.pulseHeat) {
      node.heat += 0.08 + 0.08 * Math.sin(state.time * 0.004 + node.id);
    }
  });
};

const tick = (time) => {
  state.time = time;
  if (state.playing) {
    const delta = time - state.lastTick;
    if (delta > 30) {
      if (state.mode === 'signal') {
        stepSignal();
      } else {
        stepHeat();
      }
      state.lastTick = time;
    }
  }
  draw();
  requestAnimationFrame(tick);
};

const drawEdge = (edge) => {
  const a = state.nodes.find((node) => node.id === edge.a);
  const b = state.nodes.find((node) => node.id === edge.b);
  if (!a || !b) return;

  const weightIntensity = Math.min(1, Math.max(0.2, edge.weight));
  const stroke = state.mode === 'signal'
    ? `rgba(90, 240, 178, ${0.15 + weightIntensity * 0.4})`
    : `rgba(255, 158, 102, ${0.12 + weightIntensity * 0.4})`;

  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2 + weightIntensity;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
};

const drawNode = (node) => {
  const value = state.mode === 'signal' ? node.signal : node.heat;
  const magnitude = Math.min(1, Math.abs(value));
  const pulse = state.mode === 'signal'
    ? `rgba(90, 240, 178, ${0.2 + magnitude * 0.7})`
    : `rgba(255, 146, 88, ${0.2 + magnitude * 0.7})`;

  ctx.beginPath();
  ctx.arc(node.x, node.y, config.nodeRadius + magnitude * 10, 0, Math.PI * 2);
  ctx.fillStyle = pulse;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(node.x, node.y, config.nodeRadius, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(9, 13, 19, 0.85)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(145, 185, 230, 0.5)';
  ctx.stroke();
};

const drawLinkPreview = () => {
  if (!state.drag.longPressTriggered || !state.drag.startNode) return;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(state.drag.startNode.x, state.drag.startNode.y);
  ctx.lineTo(state.drag.current.x, state.drag.current.y);
  ctx.stroke();
  ctx.setLineDash([]);
};

const draw = () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(1, 1);

  state.edges.forEach(drawEdge);
  drawLinkPreview();
  state.nodes.forEach(drawNode);

  ctx.restore();
};

modeSignalBtn.addEventListener('click', () => {
  state.mode = 'signal';
  modeSignalBtn.classList.add('is-active');
  modeHeatBtn.classList.remove('is-active');
  document.body.classList.remove('heat-mode');
  generateSignalBtn.classList.remove('is-hidden');
  generateHeatBtn.classList.add('is-hidden');
});

modeHeatBtn.addEventListener('click', () => {
  state.mode = 'heat';
  modeHeatBtn.classList.add('is-active');
  modeSignalBtn.classList.remove('is-active');
  document.body.classList.add('heat-mode');
  generateHeatBtn.classList.remove('is-hidden');
  generateSignalBtn.classList.add('is-hidden');
});

playToggleBtn.addEventListener('click', () => {
  state.playing = !state.playing;
  playToggleBtn.textContent = state.playing ? 'Pause' : 'Play';
  playToggleBtn.classList.toggle('is-playing', state.playing);
});

const randomPoint = () => {
  const rect = canvas.getBoundingClientRect();
  const padding = 60;
  return {
    x: padding + Math.random() * Math.max(1, rect.width - padding * 2),
    y: padding + Math.random() * Math.max(1, rect.height - padding * 2),
  };
};

const generateGraph = () => {
  state.nodes = [];
  state.edges = [];
  state.nextNodeId = 1;
  state.nextEdgeId = 1;

  const nodeCount = 26;
  for (let i = 0; i < nodeCount; i += 1) {
    addNode(randomPoint());
  }

  const unvisited = new Set(state.nodes.map((node) => node.id));
  const visited = new Set();
  const [first] = state.nodes;
  if (!first) return;
  visited.add(first.id);
  unvisited.delete(first.id);

  while (unvisited.size > 0) {
    let bestPair = null;
    let bestDistance = Infinity;
    visited.forEach((aId) => {
      unvisited.forEach((bId) => {
        const a = state.nodes.find((n) => n.id === aId);
        const b = state.nodes.find((n) => n.id === bId);
        if (!a || !b) return;
        const d = distance(a, b);
        if (d < bestDistance) {
          bestDistance = d;
          bestPair = [a, b];
        }
      });
    });
    if (!bestPair) break;
    addEdge(bestPair[0], bestPair[1]);
    visited.add(bestPair[1].id);
    unvisited.delete(bestPair[1].id);
  }

  state.nodes.forEach((node) => {
    const candidates = [...state.nodes]
      .filter((other) => other.id !== node.id)
      .sort((a, b) => distance(node, a) - distance(node, b));
    for (let i = 0; i < 2; i += 1) {
      const target = candidates[i];
      if (target) addEdge(node, target);
    }
  });

  resetSimulation();
};

generateSignalBtn.addEventListener('click', generateGraph);
generateHeatBtn.addEventListener('click', generateGraph);

clearBtn.addEventListener('click', () => {
  state.nodes = [];
  state.edges = [];
  resetSimulation();
});

resetSimulation();
requestAnimationFrame(tick);
