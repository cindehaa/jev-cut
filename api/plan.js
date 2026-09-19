const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

const PRIMITIVES = {
  AbsoluteFill: "Full-bleed layer. Default wrapper for a scene.",
  Sequence: "Time-shift children. Overlays if layout is absolute-fill.",
  Series: "Play children one after another. Use for a linear cut.",
  Loop: "Repeat children. Use for pulses, tickers, repeating motion.",
  Freeze: "Hold a child on one frame. Use for a still beat.",
  Img: "Still image layer.",
  OffthreadVideo: "Video clip layer.",
  Audio: "Soundtrack track.",
};

const MOTION = {
  spring: "Physics 0-1. Entrances, pops, overshoot.",
  interpolate: "Map frame ranges to values. Fades, pans, type-on.",
  interpolateColors: "Map time to a color ramp.",
  easing_bezier: "Custom curve on interpolate.",
  none: "No motion. Static layout.",
};

const LAYOUT = {
  center: "Single block in the middle of AbsoluteFill.",
  split: "Two AbsoluteFill columns side by side.",
  stack: "Series of full-bleed Sequence beats.",
  overlay: "Base AbsoluteFill plus a later Sequence overlay.",
};

const FORMAT = {
  landscape: "1920x1080 Composition",
  portrait: "1080x1920 Composition",
  square: "1080x1080 Composition",
};

function questions() {
  return {
    format: { type: "choice", instructions: "Composition size.", criteria: FORMAT },
    layout: { type: "choice", instructions: "How layers are arranged.", criteria: LAYOUT },
    motion: { type: "choice", instructions: "Animation primitive for the cut.", criteria: MOTION },
    layer_0: { type: "choice", instructions: "Root / first layer primitive.", criteria: PRIMITIVES },
    layer_1: { type: "choice", instructions: "Second layer primitive.", criteria: PRIMITIVES },
    layer_2: { type: "choice", instructions: "Third layer primitive. Prefer Sequence, Series, or Loop.", criteria: PRIMITIVES },
    use_audio: { type: "noul", instructions: "Should an Audio track be included?" },
    density: { type: "score", instructions: "How many timed beats (Series.Sequence children)?", criteria: ["2", "3", "4", "5"] },
  };
}

async function askJev(state, qs, apiKey) {
  if (!apiKey) return heuristic(state, qs);
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "jev-latest", state, questions: qs }),
  });
  if (!res.ok) {
    const t = await res.text();
    return { ...heuristic(state, qs), fallback: `jev http ${res.status}` };
  }
  return res.json();
}

function heuristic(state, qs) {
  const p = JSON.stringify(state).toLowerCase();
  const answers = {};
  for (const [id, q] of Object.entries(qs)) {
    if (q.type === "choice") {
      const keys = Object.keys(q.criteria);
      let choice = keys[0];
      if (id === "format") choice = /portrait|tiktok|short/.test(p) ? "portrait" : /square/.test(p) ? "square" : "landscape";
      if (id === "layout") choice = /step|loop|after|stack/.test(p) ? "stack" : /vs|compare/.test(p) ? "split" : /caption|lower/.test(p) ? "overlay" : "center";
      if (id === "motion") choice = /punch|pop|spring/.test(p) ? "spring" : /fade|pan|type/.test(p) ? "interpolate" : /color|grade/.test(p) ? "interpolateColors" : "spring";
      if (id === "layer_0") choice = "AbsoluteFill";
      if (id === "layer_1") choice = /clip|footage|video/.test(p) ? "OffthreadVideo" : /image|photo/.test(p) ? "Img" : "Sequence";
      if (id === "layer_2") choice = /repeat|pulse/.test(p) ? "Loop" : "Series";
      const probabilities = Object.fromEntries(keys.map((k) => [k, k === choice ? 0.72 : 0.28 / Math.max(1, keys.length - 1)]));
      answers[id] = { type: "choice", choice, probabilities, confidence: 0.55 };
    } else if (q.type === "score") answers[id] = { type: "score", score: 1, confidence: 0.5 };
    else answers[id] = { type: "noul", noul: /music|audio|sound/.test(p) ? 0.7 : 0.15 };
  }
  return { model: "heuristic-jev-standin", answers, usage: { input_tokens: 0, output_tokens: 0 } };
}

function sizeOf(format) {
  if (format === "portrait") return { width: 1080, height: 1920 };
  if (format === "square") return { width: 1080, height: 1080 };
  return { width: 1920, height: 1080 };
}

function titleFrom(prompt) {
  const q = prompt.match(/"([^"]+)"/);
  if (q) return q[1];
  const f = prompt.match(/for ([A-Z][^,:]{2,40})/);
  if (f) return f[1].trim();
  return prompt.split(/[:.]/)[0].slice(0, 48);
}

function assemble(prompt, jev) {
  const a = jev.answers || {};
  const format = a.format?.choice || "landscape";
  const layout = a.layout?.choice || "center";
  const motion = a.motion?.choice || "spring";
  const layers = ["layer_0", "layer_1", "layer_2"].map((id) => ({
    id,
    primitive: a[id]?.choice || "AbsoluteFill",
    confidence: a[id]?.confidence,
    probabilities: a[id]?.probabilities,
  }));
  const beats = Math.min(5, Math.max(2, 2 + Math.round(a.density?.score || 1)));
  const fps = 30;
  const durationInFrames = beats * 45;
  const { width, height } = sizeOf(format);
  const title = titleFrom(prompt);
  const words = prompt.split(/[:.,]/).map((s) => s.trim()).filter((s) => s.length > 2).slice(0, beats);
  const tree = {
    type: "Composition",
    id: "PromptVideo",
    fps, width, height, durationInFrames,
    children: buildTree({ layout, motion, layers, beats, words, title, audio: (a.use_audio?.noul || 0) > 0.5 }),
  };
  return {
    meta: { prompt, model: jev.model, format, layout, motion, fps, width, height, durationInFrames, usage: jev.usage },
    jev: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { type: v.type, choice: v.choice, score: v.score, noul: v.noul, confidence: v.confidence }])),
    layers,
    tree,
    remotionTsx: emitTsx(tree, motion),
  };
}

function buildTree({ layout, motion, layers, beats, words, title, audio }) {
  const rootPrim = layers[0]?.primitive || "AbsoluteFill";
  const kids = [];
  if (layout === "stack" || layers.some((l) => l.primitive === "Series")) {
    kids.push({
      type: "Series",
      children: Array.from({ length: beats }, (_, i) => ({
        type: "Series.Sequence",
        durationInFrames: 45,
        children: [{ type: "AbsoluteFill", motion, text: words[i] || title, beat: i }],
      })),
    });
  } else if (layout === "split") {
    kids.push({
      type: "AbsoluteFill",
      style: "row",
      children: [
        { type: "Sequence", from: 0, text: words[0] || "A", motion },
        { type: "Sequence", from: 8, text: words[1] || "B", motion },
      ],
    });
  } else if (layout === "overlay") {
    kids.push({ type: "AbsoluteFill", text: title, motion });
    kids.push({ type: "Sequence", from: 20, durationInFrames: 40, text: words[1] || title, overlay: true });
  } else {
    kids.push({ type: rootPrim === "Img" || rootPrim === "OffthreadVideo" ? rootPrim : "AbsoluteFill", text: title, motion });
    if (layers[1]?.primitive === "Sequence" || layers[1]?.primitive === "Loop") {
      kids.push({ type: layers[1].primitive, from: 10, text: words[1] || title, motion });
    }
  }
  if (audio) kids.push({ type: "Audio", src: "soundtrack.mp3" });
  return kids;
}

function emitTsx(tree, motion) {
  const m =
    motion === "spring"
      ? "const t = spring({ frame, fps, config: { damping: 14 } });"
      : motion === "interpolateColors"
        ? 'const color = interpolateColors(frame, [0, durationInFrames], ["#0B1020", "#7C9CFF"]);'
        : 'const t = interpolate(frame, [0, 18, durationInFrames - 12, durationInFrames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });';
  const renderNode = (n, indent) => {
    const pad = "  ".repeat(indent);
    if (n.type === "Series") return pad + "<Series>\n" + (n.children || []).map((c) => renderNode(c, indent + 1)).join("\n") + "\n" + pad + "</Series>";
    if (n.type === "Series.Sequence") return pad + "<Series.Sequence durationInFrames={" + n.durationInFrames + "}>\n" + (n.children || []).map((c) => renderNode(c, indent + 1)).join("\n") + "\n" + pad + "</Series.Sequence>";
    if (n.type === "Sequence") {
      const dur = n.durationInFrames ? " durationInFrames={" + n.durationInFrames + "}" : "";
      return pad + "<Sequence from={" + (n.from || 0) + "}" + dur + ">\n" + pad + "  <AbsoluteFill style={{ opacity: t }}><h1>" + esc(n.text || "") + "</h1></AbsoluteFill>\n" + pad + "</Sequence>";
    }
    if (n.type === "Loop") return pad + "<Loop durationInFrames={20}>\n" + pad + "  <AbsoluteFill><p>" + esc(n.text || "") + "</p></AbsoluteFill>\n" + pad + "</Loop>";
    if (n.type === "Audio") return pad + '<Audio src={staticFile("soundtrack.mp3")} />';
    if (n.type === "Img") return pad + '<Img src={staticFile("still.png")} />';
    if (n.type === "OffthreadVideo") return pad + '<OffthreadVideo src={staticFile("clip.mp4")} />';
    const inner = n.text ? '<h1 style={{ transform: `scale(${t})` }}>' + esc(n.text) + "</h1>" : (n.children || []).map((c) => renderNode(c, indent + 1)).join("\n");
    return pad + "<AbsoluteFill" + (n.style === "row" ? ' style={{ flexDirection: "row" }}' : "") + ">\n" + pad + "  " + inner + "\n" + pad + "</AbsoluteFill>";
  };
  return "import { AbsoluteFill, Sequence, Series, Loop, Audio, Img, OffthreadVideo, spring, interpolate, interpolateColors, useCurrentFrame, useVideoConfig, staticFile } from \"remotion\";\n\nexport const PromptVideo = () => {\n  const frame = useCurrentFrame();\n  const { fps, durationInFrames } = useVideoConfig();\n  " + m + "\n  return (\n" + renderNode({ type: "AbsoluteFill", children: tree.children }, 2) + "\n  );\n};\n";
}

function esc(s) {
  return String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("`", "");
}

function previewHtml(spec) {
  const { meta, tree } = spec;
  const leaves = [];
  const walk = (n) => { if (n.text) leaves.push(n); (n.children || []).forEach(walk); };
  walk(tree);
  const hold = 1.8;
  return "<!doctype html><html><meta charset=\"utf-8\"/><style>body{margin:0;background:#07070b;color:#f4f1ea;font-family:ui-sans-serif,system-ui}.stage{position:relative;width:100%;aspect-ratio:" + meta.width + "/" + meta.height + ";background:#0B1020;overflow:hidden}.layer{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:48px;opacity:0;animation:hold " + hold + "s ease both}h1{font-size:clamp(28px,6vw,64px);letter-spacing:-.04em;margin:0;text-align:center}.tag{position:absolute;top:16px;left:16px;font:11px ui-monospace,monospace;color:#7C9CFF;letter-spacing:.12em;text-transform:uppercase}@keyframes hold{0%{opacity:0;transform:scale(.96)}12%{opacity:1;transform:none}86%{opacity:1}100%{opacity:0}}" + leaves.map((_, i) => "#l" + i + "{animation-delay:" + (i * hold) + "s}").join("") + "</style><body><div class=\"stage\">" + leaves.map((n, i) => "<div class=\"layer\" id=\"l" + i + "\"><div class=\"tag\">" + esc(n.type) + " \u00b7 " + esc(spec.meta.motion) + "</div><h1>" + esc(n.text) + "</h1></div>").join("") + "</div></body></html>";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const prompt = String(req.body?.prompt || "").trim();
  if (!prompt) return res.status(400).json({ error: "prompt required" });
  const t0 = Date.now();
  const jev = await askJev({ user_prompt: prompt, remotion: Object.keys(PRIMITIVES) }, questions(), process.env.TYPESAFE_API_KEY || "");
  const tJev = Date.now();
  const spec = assemble(prompt, jev);
  spec.previewHtml = previewHtml(spec);
  spec.timing = { jevMs: tJev - t0, assembleMs: Date.now() - tJev, totalMs: Date.now() - t0 };
  return res.status(200).json(spec);
}
