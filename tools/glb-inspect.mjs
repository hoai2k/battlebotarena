// Quick GLB structure dump: nodes, meshes, primitives, vertex counts, bounds.
// Usage: node tools/glb-inspect.mjs <file.glb>
import fs from "node:fs";

function align4(value) {
  return (value + 3) & ~3;
}

const path = process.argv[2];
if (!path) {
  console.error("Usage: node tools/glb-inspect.mjs <file.glb>");
  process.exit(1);
}
const buffer = fs.readFileSync(path);
if (buffer.toString("utf8", 0, 4) !== "glTF") throw new Error("not a GLB");
const jsonLength = buffer.readUInt32LE(12);
const json = JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength).trim());

const summary = {
  generator: json.asset?.generator,
  sceneNodes: (json.scenes?.[0]?.nodes || []).length,
  nodes: (json.nodes || []).map((node, i) => ({
    i,
    name: node.name || null,
    mesh: node.mesh ?? null,
    children: node.children?.length || 0,
    translation: node.translation || null,
  })),
  meshes: (json.meshes || []).map((mesh, i) => ({
    i,
    name: mesh.name || null,
    primitives: mesh.primitives.map((p) => ({
      verts: json.accessors[p.attributes.POSITION]?.count,
      indexed: p.indices !== undefined,
      material: p.material ?? null,
      min: json.accessors[p.attributes.POSITION]?.min?.map((v) => Number(v.toFixed(3))),
      max: json.accessors[p.attributes.POSITION]?.max?.map((v) => Number(v.toFixed(3))),
    })),
  })),
  materials: (json.materials || []).map((m) => m.name || "(unnamed)"),
  images: (json.images || []).length,
  fileMB: Number((buffer.length / 1048576).toFixed(1)),
};
console.log(JSON.stringify(summary, null, 2));
