// Bundles src/extension.ts -> out/extension.js and copies the webview media files.
// vscode is marked external because the extension host provides it at runtime.
const esbuild = require("esbuild");
const { copyFile, mkdir, readdir } = require("node:fs/promises");
const path = require("node:path");

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

async function copyMedia() {
  const src = path.join(__dirname, "src/ui/media");
  const dst = path.join(__dirname, "out/media");
  await mkdir(dst, { recursive: true });
  const files = await readdir(src);
  await Promise.all(
    files.map((f) => copyFile(path.join(src, f), path.join(dst, f)))
  );
}

const buildOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node18",
  outfile: "out/extension.js",
  external: ["vscode"],
  sourcemap: !production,
  minify: production,
  logLevel: "info",
};

async function main() {
  await copyMedia();
  if (watch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log("esbuild: watching...");
  } else {
    await esbuild.build(buildOptions);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
