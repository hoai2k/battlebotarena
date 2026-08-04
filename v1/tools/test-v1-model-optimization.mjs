import { spawnSync } from "node:child_process";

const models = [
  {
    id: "bronco",
    backup: "model_backups/bronco_3d.before-lossless-reindex-20260802.glb.gz",
    optimized: "public/models/bronco_3d.glb",
  },
  {
    id: "hypershock",
    backup: "model_backups/hypershock_3d.before-lossless-reindex-20260802.glb.gz",
    optimized: "public/models/hypershock_3d.glb",
  },
  {
    id: "tombstone",
    backup: "model_backups/tombstone_3d.before-lossless-reindex-20260802.glb.gz",
    optimized: "public/models/tombstone_3d.glb",
  },
];

function run(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

models.forEach((model) => {
  run("tools/verify-reindexed-glb.mjs", [model.backup, model.optimized]);
});

run("tools/v1-model-runtime-test.mjs", models.flatMap((model) => [model.id, model.backup, model.optimized]));
console.log(JSON.stringify({ ok: true, verifiedModels: models.map((model) => model.id) }, null, 2));
