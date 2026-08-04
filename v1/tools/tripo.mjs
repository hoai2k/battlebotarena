// Tripo API client for regenerating / segmenting bot models.
//
// The API key is read from the TRIPO_API_KEY environment variable, falling
// back to a gitignored .env.local at the repo root. The key is never printed,
// logged, or written to any output file.
//
// Usage:
//   node tools/tripo.mjs balance
//   node tools/tripo.mjs generate <bot> [--model-version v3.1] [--face-limit 80000]
//   node tools/tripo.mjs status <task_id>
//   node tools/tripo.mjs segment <task_id>
//   node tools/tripo.mjs download <task_id> [outfile.glb]
//
// `generate` uploads public/reference/<bot>.png and starts an image_to_model
// task. Nothing is uploaded by any other subcommand.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const BASE = "https://api.tripo3d.ai/v2/openapi";
const OUT_DIR = join(ROOT, "tripo_out");

async function loadApiKey() {
  if (process.env.TRIPO_API_KEY) return process.env.TRIPO_API_KEY.trim();
  const envPath = join(ROOT, ".env.local");
  if (existsSync(envPath)) {
    const text = await readFile(envPath, "utf8");
    const match = text.match(/^\s*(?:export\s+)?TRIPO_API_KEY\s*=\s*["']?([^"'\n#]+)/m);
    if (match) return match[1].trim();
  }
  throw new Error(
    "No Tripo API key found. Set TRIPO_API_KEY in your environment, or put\n" +
    "TRIPO_API_KEY=... in .env.local at the repo root (already gitignored).",
  );
}

async function api(path, { method = "GET", body, headers = {} } = {}) {
  const key = await loadApiKey();
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...headers },
    body,
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from ${path} (HTTP ${response.status}): ${text.slice(0, 300)}`);
  }
  if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
    // Surface the API's own message; it never contains the key.
    throw new Error(`Tripo ${path} failed (HTTP ${response.status}, code ${payload.code}): ${payload.message || text.slice(0, 300)}`);
  }
  return payload.data ?? payload;
}

async function uploadImage(imagePath) {
  const key = await loadApiKey();
  const bytes = await readFile(imagePath);
  const name = basename(imagePath);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "image/png" }), name);
  // The upload route has moved between API revisions; try the documented
  // STS route first and fall back to the legacy direct route.
  let lastError = null;
  for (const route of ["/upload/sts", "/upload"]) {
    const response = await fetch(`${BASE}${route}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    const text = await response.text();
    if (response.status === 404) {
      lastError = `404 at ${route}`;
      continue;
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`Non-JSON upload response (HTTP ${response.status}): ${text.slice(0, 300)}`);
    }
    if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
      throw new Error(`Upload failed (HTTP ${response.status}, code ${payload.code}): ${payload.message || text.slice(0, 300)}`);
    }
    const data = payload.data ?? payload;
    const token = data.image_token || data.file_token || data.token;
    if (!token) throw new Error(`Upload succeeded but no token in response: ${JSON.stringify(data).slice(0, 300)}`);
    return token;
  }
  throw new Error(`No usable upload endpoint (${lastError}).`);
}

async function createTask(body) {
  const data = await api("/task", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return data.task_id;
}

async function getTask(taskId) {
  return api(`/task/${taskId}`);
}

function flag(args, name, fallback = null) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

async function cmdBalance() {
  const data = await api("/user/balance");
  console.log(`Tripo balance: ${JSON.stringify(data)}`);
}

async function cmdGenerate(args) {
  const bot = args[0];
  if (!bot) throw new Error("Usage: node tools/tripo.mjs generate <bot>");
  const imagePath = join(ROOT, "public/reference", `${bot}.png`);
  if (!existsSync(imagePath)) throw new Error(`No reference image at public/reference/${bot}.png`);
  console.log(`Uploading public/reference/${bot}.png ...`);
  const token = await uploadImage(imagePath);
  console.log("Upload complete. Creating image_to_model task ...");
  const body = {
    type: "image_to_model",
    file: { type: "png", file_token: token },
    texture: true,
    pbr: true,
    auto_size: true,
  };
  const modelVersion = flag(args, "model-version");
  if (modelVersion) body.model_version = modelVersion;
  const faceLimit = flag(args, "face-limit");
  if (faceLimit) body.face_limit = Number(faceLimit);
  const taskId = await createTask(body);
  console.log(`task_id: ${taskId}`);
  console.log(`Poll with: node tools/tripo.mjs status ${taskId}`);
}

async function cmdSegment(args) {
  const taskId = args[0];
  if (!taskId) throw new Error("Usage: node tools/tripo.mjs segment <source_task_id>");
  const newTask = await createTask({ type: "mesh_segmentation", original_model_task_id: taskId });
  console.log(`segmentation task_id: ${newTask}`);
}

async function cmdStatus(args) {
  const taskId = args[0];
  if (!taskId) throw new Error("Usage: node tools/tripo.mjs status <task_id>");
  const data = await getTask(taskId);
  console.log(JSON.stringify({ status: data.status, progress: data.progress, output: data.output }, null, 2));
}

async function cmdDownload(args) {
  const taskId = args[0];
  if (!taskId) throw new Error("Usage: node tools/tripo.mjs download <task_id> [outfile]");
  const data = await getTask(taskId);
  const url = data.output?.pbr_model || data.output?.model;
  if (!url) throw new Error(`Task ${taskId} has no downloadable model yet (status: ${data.status}).`);
  await mkdir(OUT_DIR, { recursive: true });
  const outPath = args[1] ? join(ROOT, args[1]) : join(OUT_DIR, `${taskId}.glb`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  await writeFile(outPath, Buffer.from(await response.arrayBuffer()));
  console.log(`Saved ${outPath}`);
}

async function waitForTask(taskId, label, timeoutSeconds = 900) {
  const start = Date.now();
  for (;;) {
    const data = await getTask(taskId);
    if (data.status === "success") return data;
    if (["failed", "banned", "cancelled", "expired"].includes(data.status)) {
      throw new Error(`${label} task ${taskId} ended: ${data.status}`);
    }
    if ((Date.now() - start) / 1000 > timeoutSeconds) {
      throw new Error(`${label} task ${taskId} timed out after ${timeoutSeconds}s (last status ${data.status} ${data.progress ?? "?"}%)`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
}

async function downloadTaskModel(taskId, outPath) {
  const data = await getTask(taskId);
  const url = data.output?.pbr_model || data.output?.model;
  if (!url) throw new Error(`Task ${taskId} has no model output`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(outPath, Buffer.from(await response.arrayBuffer()));
}

// Full pipeline for one bot: generate → wait → segment → wait → download both.
async function cmdPipeline(args) {
  const bot = args[0];
  if (!bot) throw new Error("Usage: node tools/tripo.mjs pipeline <bot>");
  const imagePath = join(ROOT, "public/reference", `${bot}.png`);
  if (!existsSync(imagePath)) throw new Error(`No reference image for ${bot}`);
  console.log(`[${bot}] uploading reference ...`);
  const token = await uploadImage(imagePath);
  const genBody = { type: "image_to_model", file: { type: "png", file_token: token }, texture: true, pbr: true, auto_size: true };
  const modelVersion = flag(args, "model-version");
  if (modelVersion) genBody.model_version = modelVersion;
  const genId = await createTask(genBody);
  console.log(`[${bot}] generation task ${genId}`);
  await waitForTask(genId, `${bot} generation`);
  await downloadTaskModel(genId, join(OUT_DIR, `${bot}_gen.glb`));
  console.log(`[${bot}] generation done → tripo_out/${bot}_gen.glb`);
  const segId = await createTask({ type: "mesh_segmentation", original_model_task_id: genId });
  console.log(`[${bot}] segmentation task ${segId}`);
  await waitForTask(segId, `${bot} segmentation`);
  await downloadTaskModel(segId, join(OUT_DIR, `${bot}_seg.glb`));
  console.log(`[${bot}] segmentation done → tripo_out/${bot}_seg.glb`);
}

// Sequential batch over several bots (sequential keeps credit spend observable).
async function cmdBatch(args) {
  const bots = args.filter((a) => !a.startsWith("--") && a !== flag(args, "model-version"));
  if (!bots.length) throw new Error("Usage: node tools/tripo.mjs batch <bot> <bot> ... [--model-version vX]");
  const modelVersion = flag(args, "model-version");
  const extra = modelVersion ? ["--model-version", modelVersion] : [];
  for (const bot of bots) {
    const before = (await api("/user/balance")).balance;
    await cmdPipeline([bot, ...extra]);
    const after = (await api("/user/balance")).balance;
    console.log(`[${bot}] spent ${before - after} credits (${after} remaining)`);
  }
}

const [command, ...args] = process.argv.slice(2);
const commands = {
  balance: cmdBalance,
  generate: () => cmdGenerate(args),
  segment: () => cmdSegment(args),
  status: () => cmdStatus(args),
  download: () => cmdDownload(args),
  pipeline: () => cmdPipeline(args),
  batch: () => cmdBatch(args),
};
if (!commands[command]) {
  console.error("Commands: balance | generate <bot> | segment <task_id> | status <task_id> | download <task_id>");
  process.exit(1);
}
try {
  await commands[command]();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
