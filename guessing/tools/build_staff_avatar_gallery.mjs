import { readFile, writeFile } from "node:fs/promises";

const metadataPath = new URL("../tmp/staff-avatar-candidates/metadata.json", import.meta.url);
const outputPath = new URL("../tmp/staff-avatar-review.html", import.meta.url);
const metadata = JSON.parse((await readFile(metadataPath, "utf8")).replace(/^\uFEFF/, ""));
const grouped = Map.groupBy(metadata, (item) => item.name);

const escape = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll('"', "&quot;");

const sections = [...grouped.entries()].map(([name, candidates]) => `
  <section>
    <h2>${escape(name)}</h2>
    <div class="candidates">
      ${candidates.map((candidate) => `
        <article>
          <img src="staff-avatar-candidates/${escape(candidate.localFile)}" alt="${escape(name)} 候选 ${candidate.rank}">
          <strong>#${candidate.rank}</strong>
          <p>${escape(candidate.title)}</p>
        </article>`).join("")}
    </div>
  </section>`).join("");

const html = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>KPL 教练与解说头像候选</title>
<style>
  *{box-sizing:border-box} body{margin:0;padding:28px;background:#0b1220;color:#eef3ff;font:15px/1.5 system-ui,sans-serif}
  header{position:sticky;top:0;z-index:2;margin:-28px -28px 24px;padding:18px 28px;background:#0b1220e8;backdrop-filter:blur(12px);border-bottom:1px solid #26334c}
  h1,h2,p{margin:0} h1{font-size:24px} header p{color:#9baac3;margin-top:4px}
  section{margin:0 0 30px;padding:18px;border:1px solid #28364f;border-radius:18px;background:#111b2d}
  h2{margin-bottom:14px;font-size:21px}.candidates{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}
  article{overflow:hidden;border:1px solid #30415e;border-radius:13px;background:#0c1525}img{display:block;width:100%;aspect-ratio:1;object-fit:cover;object-position:center 18%;background:#fff}
  strong{display:block;padding:9px 10px 0;color:#ffcc61}article p{display:-webkit-box;overflow:hidden;padding:4px 10px 11px;color:#aab8cc;font-size:12px;-webkit-box-orient:vertical;-webkit-line-clamp:2}
  @media(max-width:780px){body{padding:14px}.candidates{grid-template-columns:repeat(2,minmax(0,1fr))}header{margin:-14px -14px 18px;padding:14px}section{padding:12px}.candidates article:last-child{grid-column:1/-1}}
</style>
<header><h1>KPL 教练与解说头像候选</h1><p>每人 5 张，优先选本人单人正脸、清楚、无严重裁切的图片。</p></header>
${sections}
</html>`;

await writeFile(outputPath, html, "utf8");
console.log(outputPath.pathname);
