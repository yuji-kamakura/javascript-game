import { cp, mkdir, rm, writeFile } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/static/icons", { recursive: true });
await mkdir("dist/server", { recursive: true });
for (const file of ["index.html", "style.css", "game.js", "pwa.js", "sw.js", "manifest.webmanifest", "og.png"]) {
  await cp(file, `dist/static/${file}`);
}
await cp("icons", "dist/static/icons", { recursive: true });
await writeFile("dist/server/index.js", "export default { fetch(request, env) { return env.ASSETS.fetch(request); } };\n");
