const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const COMPONENTS = {
  TitleCard: { kind: "scene", description: "Full-screen title + subtitle.", defaultDuration: 75 },
  StatCard: { kind: "scene", description: "One huge number with a label.", defaultDuration: 60 },
  QuoteCard: { kind: "scene", description: "Pull quote with attribution.", defaultDuration: 75 },
  SplitScreen: { kind: "scene", description: "Two-column comparison.", defaultDuration: 90 },
  TypingText: { kind: "scene", description: "Terminal-style typing.", defaultDuration: 90 },
  FeatureGrid: { kind: "scene", description: "Three short feature tiles.", defaultDuration: 90 },
  TimelineBeat: { kind: "scene", description: "A numbered how-it-works step.", defaultDuration: 60 },
  EndCard: { kind: "scene", description: "Closing CTA.", defaultDuration: 60 },
};
const PALETTES = {
  midnight: { bg: "#0B1020", ink: "#F4F1EA", accent: "#7C9CFF", muted: "#8B93A7" },
  solar: { bg: "#1A1208", ink: "#FFF6E8", accent: "#FFB020", muted: "#C4A574" },
  mint: { bg: "#071410", ink: "#E8FFF6", accent: "#3DDC97", muted: "#7AA89A" },
  rose: { bg: "#16080E", ink: "#FFF0F4", accent: "#FF6B9A", muted: "#C4899A" },
};
const TRANSITIONS = { fade: "Crossfade.", slideLeft: "Forward.", slideUp: "Reveal.", zoom: "Punch.", wipe: "Cut." };
function questions() {
  const sceneCriteria = Object.fromEntries(Object.entries(COMPONENTS).map(([k, v]) => [k, v.description]));
  return {
    palette: { type: "choice", instructions: "Color world?", criteria: { midnight: "cool tech", solar: "warm launch", mint: "growth", rose: "lifestyle" } },
    length: { type: "score", instructions: "How many scenes?", criteria: ["3", "4", "5", "6"] },
    scene_0: { type: "choice", instructions: "Opening.", criteria: sceneCriteria },
    scene_1: { type: "choice", instructions: "Second.", criteria: sceneCriteria },
    scene_2: { type: "choice", instructions: "Third.", criteria: sceneCriteria },
    scene_3: { type: "choice", instructions: "Fourth.", criteria: sceneCriteria },
    scene_4: { type: "choice", instructions: "Close.", criteria: sceneCriteria },
    transition: { type: "choice", instructions: "Transition.", criteria: TRANSITIONS },
    use_lower_third: { type: "noul", instructions: "LowerThird?" },
  };
}
async function askJev(state, qs, apiKey) {
  if (!apiKey) return heuristic(state, qs);
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "jev-latest", state, questions: qs }),
  });
  if (!res.ok) return heuristic(state, qs);
  return res.json();
}
function heuristic(state, qs) {
  const prompt = JSON.stringify(state).toLowerCase();
  const answers = {};
  for (const [id, q] of Object.entries(qs)) {
    if (q.type === "choice") {
      const keys = Object.keys(q.criteria);
      let choice = keys[0];
      if (id === "palette") choice = /warm|solar/.test(prompt) ? "solar" : "midnight";
      if (id === "scene_0") choice = /tech|jev|cli/.test(prompt) ? "TypingText" : "TitleCard";
      if (id.startsWith("scene_") && id !== "scene_0") choice = /step|loop/.test(prompt) ? "TimelineBeat" : "FeatureGrid";
      if (id === "scene_4") choice = "EndCard";
      if (id === "transition") choice = /punch/.test(prompt) ? "zoom" : "fade";
      const probabilities = Object.fromEntries(keys.map((k) => [k, k === choice ? 0.7 : 0.3 / Math.max(1, keys.length - 1)]));
      answers[id] = { type: "choice", choice, probabilities, confidence: 0.6 };
    } else if (q.type === "score") answers[id] = { type: "score", score: 1, confidence: 0.5 };
    else answers[id] = { type: "noul", noul: 0.2 };
  }
  return { model: "heuristic-jev-standin", answers, usage: { input_tokens: 0, output_tokens: 0 } };
}
function guessTitle(p) {
  const q = p.match(/"([^"]+)"/);
  if (q) return q[1];
  const f = p.match(/for ([A-Z][^,:]{2,40})/);
  if (f) return f[1].trim();
  return p.split(/[:.]/)[0].slice(0, 42);
}
function assemble(prompt, jev) {
  const paletteName = jev.answers.palette?.choice || "midnight";
  const palette = PALETTES[paletteName] || PALETTES.midnight;
  const sceneCount = Math.min(5, Math.max(3, 3 + Math.round(jev.answers.length?.score || 1)));
  const slots = ["scene_0", "scene_1", "scene_2", "scene_3", "scene_4"].slice(0, sceneCount);
  const used = new Set();
  const clips = [];
  let from = 0;
  const fallback = ["TitleCard", "FeatureGrid", "StatCard", "SplitScreen", "EndCard"];
  for (let i = 0; i < slots.length; i++) {
    let type = jev.answers[slots[i]]?.choice || fallback[i];
    if (i === slots.length - 1) type = "EndCard";
    if (used.has(type) && type !== "TimelineBeat") type = fallback.find((k) => !used.has(k)) || type;
    used.add(type);
    const duration = COMPONENTS[type].defaultDuration;
    const title = guessTitle(prompt);
    let props = { text: title };
    if (type === "TitleCard") props = { title, subtitle: "Jev to Remotion", backgroundColor: palette.bg, textColor: palette.ink };
    if (type === "StatCard") props = { value: "ms", label: "decision time", backgroundColor: palette.bg };
    if (type === "QuoteCard") props = { quote: "Decision in, frames out.", author: "Jev Cut" };
    if (type === "SplitScreen") props = { leftTitle: "Prompt", leftContent: "Natural language", rightTitle: "Cut", rightContent: title };
    if (type === "TypingText") props = { text: "$ launch --product \"" + title + "\"" };
    if (type === "FeatureGrid") props = { heading: "Loop", items: ["Prompt", "Jev chooses", "Remotion"] };
    if (type === "TimelineBeat") props = { step: String(i + 1).padStart(2, "0"), heading: ["Prompt in", "Jev chooses", "Code renders"][i % 3], body: "Typed decisions." };
    if (type === "EndCard") props = { line: title, cta: /template/i.test(prompt) ? "Get the template" : "Get started" };
    clips.push({ id: "clip_" + i, type, from, durationInFrames: duration, props, jev: { choice: jev.answers[slots[i]]?.choice, confidence: jev.answers[slots[i]]?.confidence } });
    from += duration - 8;
  }
  return { meta: { prompt, model: jev.model, palette: paletteName, fps: 30, width: 1920, height: 1080, durationInFrames: from + 8, usage: jev.usage }, clips, palette, jevQuestions: jev.answers };
}
function previewHtml(spec) {
  const { palette, clips } = spec;
  const scenes = clips.filter((c) => !c.overlay);
  const esc = (s) => String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const body = (clip) => {
    const p = clip.props || {};
    if (clip.type === "TitleCard") return `<div class="kicker">Jev</div><h1>${esc(p.title)}</h1><p>${esc(p.subtitle)}</p>`;
    if (clip.type === "StatCard") return `<div class="num">${esc(p.value)}</div><div class="label">${esc(p.label)}</div>`;
    if (clip.type === "QuoteCard") return `<blockquote>${esc(p.quote)}</blockquote>`;
    if (clip.type === "SplitScreen") return `<div class="split"><div class="col"><h3>${esc(p.leftTitle)}</h3><p>${esc(p.leftContent)}</p></div><div class="col"><h3>${esc(p.rightTitle)}</h3><p>${esc(p.rightContent)}</p></div></div>`;
    if (clip.type === "TypingText") return `<pre>${esc(p.text)}</pre>`;
    if (clip.type === "FeatureGrid") return `<h2>${esc(p.heading)}</h2><div class="tiles">${(p.items || []).map((i) => `<div class="tile">${esc(i)}</div>`).join("")}</div>`;
    if (clip.type === "TimelineBeat") return `<div class="step">${esc(p.step)}</div><h2>${esc(p.heading)}</h2><p>${esc(p.body)}</p>`;
    if (clip.type === "EndCard") return `<h2>${esc(p.line)}</h2><div class="cta">${esc(p.cta)}</div>`;
    return esc(clip.type);
  };
  return `<!doctype html><html><meta charset="utf-8"/><style>:root{--bg:${palette.bg};--ink:${palette.ink};--accent:${palette.accent};--muted:${palette.muted}}body{margin:0;font-family:system-ui;background:var(--bg);color:var(--ink)}.stage{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden}.scene{position:absolute;inset:0;padding:48px;display:flex;flex-direction:column;justify-content:center;opacity:0;animation:hold 2.4s ease both}${scenes.map((_, i) => `#s${i}{animation-delay:${i * 2.4}s}`).join("")}@keyframes hold{0%{opacity:0}12%{opacity:1}88%{opacity:1}100%{opacity:0}}h1{font-size:48px;margin:0}.num{font-size:72px;color:var(--accent)}.cta{margin-top:12px;background:var(--accent);color:#111;padding:8px 14px;border-radius:999px;width:max-content}pre{font:22px monospace;color:#9dffb0}.tiles{display:flex;gap:10px}.tile{flex:1;background:#fff1;padding:12px}.split{display:flex}.col{flex:1;padding:24px}.step{color:var(--accent)}</style><body><div class="stage">${scenes.map((c, i) => `<div class="scene" id="s${i}">${body(c)}</div>`).join("")}</div></body></html>`;
}
export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.setHeader("Access-Control-Allow-Origin", "*"); return res.status(204).end(); }
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const prompt = String(req.body?.prompt || "").trim();
  if (!prompt) return res.status(400).json({ error: "prompt required" });
  const t0 = Date.now();
  const jev = await askJev({ user_prompt: prompt }, questions(), process.env.TYPESAFE_API_KEY || "");
  const tJev = Date.now();
  const spec = assemble(prompt, jev);
  spec.previewHtml = previewHtml(spec);
  spec.timing = { jevMs: tJev - t0, assembleMs: Date.now() - tJev, totalMs: Date.now() - t0 };
  res.setHeader("Access-Control-Allow-Origin", "*");
  return res.status(200).json(spec);
}
