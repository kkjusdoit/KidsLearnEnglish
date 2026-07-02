#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";

const distArg = process.argv[2] ?? "apps/web/dist";
const distDir = path.resolve(distArg);
const accountId = process.env.CF_ACCOUNT_ID ?? "eb2b60a17c13e545fc5e2bd6e15a0efd";
const projectName = process.env.CF_PAGES_PROJECT ?? "kindergarten-english-mvp";
const apiOrigin = process.env.API_ORIGIN;
const branch = process.env.CF_PAGES_BRANCH;

if (!apiOrigin) {
  throw new Error("Missing API_ORIGIN");
}

const oauthToken = process.env.CF_OAUTH_TOKEN ?? await readWranglerToken();
if (!oauthToken) {
  throw new Error("Missing Cloudflare OAuth token");
}

const files = await collectFiles(distDir);
const manifest = {};
for (const file of files) {
  manifest[`/${file.relativePath}`] = file.hash;
}

const uploadJwt = await cfJson(
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/upload-token`,
  {
    headers: {
      Authorization: `Bearer ${oauthToken}`
    }
  }
).then((body) => body.result.jwt);

const missingHashes = await cfJson(
  "https://api.cloudflare.com/client/v4/pages/assets/check-missing",
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${uploadJwt}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ hashes: files.map((file) => file.hash) })
  }
);

const missingSet = new Set(missingHashes.result ?? missingHashes);
const uploadPayload = [];
for (const file of files) {
  if (!missingSet.has(file.hash)) continue;
  uploadPayload.push({
    key: file.hash,
    value: file.contents.toString("base64"),
    metadata: {
      contentType: file.contentType
    },
    base64: true
  });
}

if (uploadPayload.length > 0) {
  await cfJson("https://api.cloudflare.com/client/v4/pages/assets/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${uploadJwt}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(uploadPayload)
  });
}

await cfJson("https://api.cloudflare.com/client/v4/pages/assets/upsert-hashes", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${uploadJwt}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ hashes: files.map((file) => file.hash) })
});

const deploymentForm = new FormData();
deploymentForm.set("manifest", JSON.stringify(manifest));
if (branch) {
  deploymentForm.set("branch", branch);
}

const headersPath = path.join(distDir, "_headers");
if (await exists(headersPath)) {
  deploymentForm.set(
    "_headers",
    new File([await fs.readFile(headersPath)], "_headers", {
      type: "text/plain"
    })
  );
}

deploymentForm.set(
  "_worker.bundle",
  new File([await buildWorkerBundle(apiOrigin)], "_worker.bundle", {
    type: "application/octet-stream"
  })
);

const deployment = await cfJson(
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/deployments`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${oauthToken}`
    },
    body: deploymentForm
  }
);

const deploymentId = deployment.result.id;
let latest = deployment.result;

for (let attempt = 0; attempt < 60; attempt += 1) {
  await sleep(2000);
  latest = await cfJson(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/deployments/${deploymentId}`,
    {
      headers: {
        Authorization: `Bearer ${oauthToken}`
      }
    }
  ).then((body) => body.result);

  const stageName = latest.latest_stage?.name ?? latest.deployment_stage?.name ?? "";
  const status = latest.latest_stage?.status ?? latest.deployment_stage?.status ?? latest.latest_stage?.completed_on ?? "";
  if (String(status).toLowerCase() === "failure") {
    throw new Error(`Pages deployment failed at stage: ${stageName}`);
  }
  if (latest.latest_stage?.ended_on || latest.deployment_stage?.ended_on) {
    break;
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      deploymentId,
      url: `https://${projectName}.pages.dev`,
      uploadedFiles: uploadPayload.length,
      totalFiles: files.length
    },
    null,
    2
  )
);

async function buildWorkerBundle(origin) {
  const workerSource = `
const API_ORIGIN = ${JSON.stringify(origin)};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/media/")) {
      const target = new URL(url.pathname + url.search, API_ORIGIN);
      return fetch(new Request(target.toString(), request));
    }
    return env.ASSETS.fetch(request);
  }
};
`.trim();

  const workerForm = new FormData();
  workerForm.set(
    "metadata",
    JSON.stringify({
      main_module: "worker.mjs",
      bindings: []
    })
  );
  workerForm.set(
    "worker.mjs",
    new File([workerSource], "worker.mjs", {
      type: "application/javascript+module"
    })
  );
  return await new Response(workerForm).blob();
}

async function collectFiles(rootDir) {
  const result = [];
  await walk(rootDir, rootDir, result);
  return result;
}

async function walk(rootDir, currentDir, result) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "_worker.js" || entry.name === "_redirects") continue;
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await walk(rootDir, fullPath, result);
      continue;
    }
    const relativePath = path.relative(rootDir, fullPath).split(path.sep).join("/");
    const contents = await fs.readFile(fullPath);
    result.push({
      relativePath,
      contents,
      contentType: contentTypeFor(relativePath),
      hash: hashFor(contents)
    });
  }
}

function hashFor(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 32);
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".map": "application/json; charset=utf-8",
      ".txt": "text/plain; charset=utf-8"
    }[ext] ?? "application/octet-stream"
  );
}

async function readWranglerToken() {
  const configPath = path.join(os.homedir(), ".wrangler", "config", "default.toml");
  const contents = await fs.readFile(configPath, "utf8");
  const match = contents.match(/^oauth_token = "(.*)"$/m);
  return match?.[1];
}

async function cfJson(url, init) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    throw new Error(body?.errors?.[0]?.message ?? body?.message ?? `Request failed: ${url}`);
  }
  return body;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
