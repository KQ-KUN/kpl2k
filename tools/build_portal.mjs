import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist");
const sources = {
  portal: path.join(root, "portal"),
  kpl2k: path.join(root, "app"),
  guessing: path.join(root, "guessing", "dist"),
};

async function assertDirectory(directory) {
  const info = await stat(directory).catch(() => null);
  if (!info?.isDirectory()) {
    throw new Error(`缺少构建目录：${path.relative(root, directory)}`);
  }
}

async function copyContents(source, destination) {
  await mkdir(destination, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  await Promise.all(
    entries.map((entry) =>
      cp(path.join(source, entry.name), path.join(destination, entry.name), {
        recursive: entry.isDirectory(),
      }),
    ),
  );
}

await Promise.all(Object.values(sources).map(assertDirectory));
await rm(output, { recursive: true, force: true });
await copyContents(sources.portal, output);
await copyContents(sources.kpl2k, path.join(output, "kpl2k"));
await copyContents(sources.guessing, path.join(output, "guessing"));

console.log("统一站点已生成：dist/、dist/kpl2k/、dist/guessing/");
