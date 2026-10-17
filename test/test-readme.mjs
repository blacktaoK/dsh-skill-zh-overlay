import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const map = JSON.parse(readFileSync("data/skill-zh-map.json", "utf8"));
const readme = readFileSync("README.md", "utf8");

const keys = Object.keys(map).filter((k) => !k.startsWith("_"));
console.log("package version      :", pkg.version);
console.log("map 条目（手写）      :", keys.length, keys.join(", "));

// README 里「现在手写了哪些」表格的技能名应当与映射表一致
const tableRows = [...readme.matchAll(/^\| `([a-z0-9-]+)` \| /gm)].map((m) => m[1]);
console.log("README 表格条目      :", tableRows.length, tableRows.join(", "));
const missingInReadme = keys.filter((k) => !tableRows.includes(k));
const extraInReadme = tableRows.filter((k) => !keys.includes(k));
console.log("表里有 README 没有   :", missingInReadme.length ? missingInReadme.join(", ") : "无");
console.log("README 有表里没有   :", extraInReadme.length ? extraInReadme.join(", ") : "无");

// README 里不该再出现旧的「16 个」「9 个」口径
for (const bad of ["16 个", "9 个英文", "暂无中文说明", "映射表要**手工维护**"]) {
  const n = readme.split(bad).length - 1;
  console.log(`README 含「${bad}」 : ${n}`);
}

// 每条的字段完整性
for (const k of keys) {
  const e = map[k];
  const bad = [];
  if (typeof e.zh !== "string" || e.zh.length < 10) bad.push("zh");
  if (typeof e.tag !== "string") bad.push("tag");
  if (!Array.isArray(e.bullets) || e.bullets.length === 0) bad.push("bullets");
  if (bad.length) console.log(`  字段缺失 ${k}: ${bad.join(",")}`);
}
console.log("映射表字段校验完成");
console.log("package.json sha1    :", createHash("sha1").update(JSON.stringify(pkg)).digest("hex").slice(0, 12));
