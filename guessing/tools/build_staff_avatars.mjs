import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const readJson = async (relativePath) => JSON.parse(
  (await readFile(path.join(root, relativePath), "utf8")).replace(/^\uFEFF/, ""),
);
const selection = await readJson("config/staff_avatar_selection.json");
const candidates = await readJson("tmp/staff-avatar-candidates/metadata.json");
const outputDirectory = path.join(root, "public/assets/staff-icons");
await mkdir(outputDirectory, { recursive: true });

const sources = [];
for (const selected of selection) {
  const candidate = selected.rank
    ? candidates.find((item) => item.slug === selected.slug && item.rank === selected.rank)
    : selected;
  if (!candidate) throw new Error(`找不到 ${selected.name} 的头像候选`);
  const inputPath = path.join(root, selected.localFile ?? "tmp/staff-avatar-candidates", selected.localFile ? "" : candidate.localFile);
  const outputPath = path.join(outputDirectory, `${selected.slug}.webp`);
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-i", inputPath,
    "-vf", "scale='min(480,iw)':-2", "-c:v", "libwebp", "-quality", "82", "-compression_level", "6", outputPath,
  ], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${selected.name} 头像转换失败：${result.stderr}`);
  sources.push({
    name: selected.name,
    asset: `/assets/staff-icons/${selected.slug}.webp`,
    focus: selected.focus,
    title: candidate.title,
    sourcePage: candidate.sourcePage,
    originalImage: candidate.originalImage,
    searchThumbnail: candidate.thumbnail ?? null,
  });
}

await writeFile(
  path.join(root, "public/data/staff_avatar_sources.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), count: sources.length, sources }, null, 2)}\n`,
  "utf8",
);
console.log(`已生成 ${sources.length} 张教练/解说头像。`);
