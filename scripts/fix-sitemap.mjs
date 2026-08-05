// Post-build fixup for myst-theme's book-theme template hardcoding
// localhost as the sitemap.xml/robots.txt origin (see README "Known issue"
// for the traced root cause: the Jse()/L9l/D9l loaders read request.url
// during myst build's internal static-export crawl, not config).
//
// Also stitches in every project registered in this file's own
// netlify.toml [[redirects]] entries:
//  - fetches each project's own (equally localhost-broken) sitemap.xml and
//    rewrites its page paths onto this project's public "from" path.
//  - fetches each project's own robots.txt and merges any real Disallow/
//    Allow rules (prefixed onto that project's "from" path) into this
//    project's robots.txt. This matters even though every project
//    currently only emits the default "Allow: /" boilerplate: crawlers
//    only ever check robots.txt at the origin root, so if a project ever
//    adds its own Disallow rule expecting it to protect its own paths,
//    that rule would be silently ignored forever unless it's merged in
//    here.

import { readFileSync, writeFileSync } from "node:fs";

const SITE_URL = "https://docs.earthscope.org";
const BUILD_DIR = "_build/html";

function stripLocalhostOrigin(loc) {
  return loc.replace(/^https?:\/\/localhost(:\d+)?/, "");
}

for (const file of ["sitemap.xml", "robots.txt"]) {
  const path = `${BUILD_DIR}/${file}`;
  const content = readFileSync(path, "utf8");
  writeFileSync(path, content.replaceAll(/http:\/\/localhost:\d+/g, SITE_URL));
}

const toml = readFileSync("netlify.toml", "utf8");
const blocks = toml.split(/\[\[redirects\]\]/).slice(1);
const projects = [];
for (const block of blocks) {
  const from = block.match(/from\s*=\s*"([^"]+)"/)?.[1];
  const to = block.match(/to\s*=\s*"([^"]+)"/)?.[1];
  const status = block.match(/status\s*=\s*(\d+)/)?.[1];
  if (from && to && status === "200" && !from.includes("*")) {
    projects.push({ from, to });
  }
}

const extraUrls = [];
const extraRobotsRules = [];

for (const { from, to } of projects) {
  try {
    const res = await fetch(`${to}/sitemap.xml`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    for (const loc of locs) {
      const path = stripLocalhostOrigin(loc);
      extraUrls.push(`${SITE_URL}${from}${path}`);
    }
    console.log(`fix-sitemap: merged ${locs.length} pages from ${from}`);
  } catch (err) {
    console.warn(`fix-sitemap: skipping ${from} sitemap (${to}/sitemap.xml) - ${err.message}`);
  }

  try {
    const res = await fetch(`${to}/robots.txt`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*(Disallow|Allow)\s*:\s*(\S+)\s*$/i);
      if (!m) continue;
      const [, directive, rulePath] = m;
      // Skip the default "Allow: /" boilerplate every project currently
      // emits - merging it verbatim would be redundant (root already
      // defaults to allow) and would clutter the file with noise.
      if (directive.toLowerCase() === "allow" && rulePath === "/") continue;
      const mergedPath = `${from}${rulePath === "/" ? "/" : rulePath}`;
      extraRobotsRules.push(`${directive}: ${mergedPath}`);
    }
  } catch (err) {
    console.warn(`fix-sitemap: skipping ${from} robots.txt (${to}/robots.txt) - ${err.message}`);
  }
}

const sitemapPath = `${BUILD_DIR}/sitemap.xml`;
const sitemap = readFileSync(sitemapPath, "utf8");
const extraXml = extraUrls.map((u) => `  <url>\n    <loc>${u}</loc>\n  </url>`).join("\n");
writeFileSync(sitemapPath, sitemap.replace("</urlset>", `${extraXml}\n</urlset>`));

const robotsPath = `${BUILD_DIR}/robots.txt`;
if (extraRobotsRules.length > 0) {
  const robots = readFileSync(robotsPath, "utf8");
  writeFileSync(robotsPath, `${robots.trimEnd()}\n${extraRobotsRules.join("\n")}\n`);
}

console.log(
  `fix-sitemap: done, ${extraUrls.length} project pages added, ${extraRobotsRules.length} robots rules merged`,
);
