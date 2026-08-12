import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
};

createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = normalize(join(root, relative));
  if (!candidate.startsWith(root) || !existsSync(candidate) || statSync(candidate).isDirectory()) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": types[extname(candidate)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(candidate).pipe(response);
}).listen(8765, "127.0.0.1", () => {
  console.log("http://127.0.0.1:8765");
});
