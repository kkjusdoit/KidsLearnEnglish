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
const requestTimeoutMs = Number(process.env.CF_REQUEST_TIMEOUT_MS ?? 45000);
const wranglerClientId =
  process.env.WRANGLER_CLIENT_ID ?? "54d11594-84e4-41aa-b438-e81b8fa78ee7";
const oauthTokenUrl =
  process.env.WRANGLER_TOKEN_URL ??
  `https://${process.env.WRANGLER_AUTH_DOMAIN ?? "dash.cloudflare.com"}/oauth2/token`;
const tokenRefreshSkewMs = 5 * 60 * 1000;

try {
  await main();
} catch (error) {
  console.error(`[pages-direct] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

async function main() {
  if (!apiOrigin) {
    throw new Error("Missing API_ORIGIN");
  }

  const auth = await resolveCloudflareAuth();
  log(`Cloudflare auth: ${auth.source}`);

  log(`Collecting files from ${distDir}`);
  const files = await collectFiles(distDir);
  const manifest = {};
  for (const file of files) {
    manifest[`/${file.relativePath}`] = file.hash;
  }
  log(`Collected ${files.length} file(s)`);

  log("Requesting Pages upload token");
  const uploadJwt = await cfJson(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/upload-token`,
    {
      headers: {
        Authorization: `Bearer ${auth.token}`
      }
    }
  ).then((body) => body.result.jwt);

  log("Checking changed assets");
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
    log(`Uploading ${uploadPayload.length} changed asset(s)`);
    await cfJson("https://api.cloudflare.com/client/v4/pages/assets/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${uploadJwt}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(uploadPayload)
    });
  } else {
    log("No asset upload needed");
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

  log("Creating Pages deployment");
  const deployment = await cfJson(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/deployments`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.token}`
      },
      body: deploymentForm
    }
  );

  const deploymentId = deployment.result.id;
  let latest = deployment.result;
  let lastStatus = "";
  log(`Deployment ${deploymentId} created; polling status`);

  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(2000);
    latest = await cfJson(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/deployments/${deploymentId}`,
      {
        headers: {
          Authorization: `Bearer ${auth.token}`
        }
      }
    ).then((body) => body.result);

    const stageName = latest.latest_stage?.name ?? latest.deployment_stage?.name ?? "";
    const status =
      latest.latest_stage?.status ??
      latest.deployment_stage?.status ??
      latest.latest_stage?.completed_on ??
      "";
    const statusText = `${stageName}:${status}`;
    if (statusText !== lastStatus) {
      log(`Deployment status: ${statusText || "pending"}`);
      lastStatus = statusText;
    }
    if (String(status).toLowerCase() === "failure") {
      throw new Error(`Pages deployment failed at stage: ${stageName}`);
    }
    if (latest.latest_stage?.ended_on || latest.deployment_stage?.ended_on) {
      break;
    }
  }

  if (!latest.latest_stage?.ended_on && !latest.deployment_stage?.ended_on) {
    throw new Error(`Timed out waiting for Pages deployment ${deploymentId}`);
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
}

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

async function resolveCloudflareAuth() {
  const apiToken = process.env.CF_API_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN;
  if (apiToken) {
    return { token: apiToken, source: "env API token" };
  }

  const oauthToken = process.env.CF_OAUTH_TOKEN ?? process.env.CLOUDFLARE_OAUTH_TOKEN;
  if (oauthToken) {
    return { token: oauthToken, source: "env OAuth token" };
  }

  const auth = await readWranglerAuth();
  if (!auth.oauthToken && !auth.refreshToken) {
    throw new Error(
      `Missing Cloudflare credentials. Run "npx wrangler login" once, or set CF_API_TOKEN.`
    );
  }

  if (auth.oauthToken && !shouldRefresh(auth.expirationTime)) {
    return { token: auth.oauthToken, source: "wrangler OAuth token" };
  }

  if (!auth.refreshToken) {
    throw new Error(
      `Wrangler OAuth token is expired and no refresh_token exists. Run "npx wrangler login" once.`
    );
  }

  const refreshed = await refreshWranglerAuth(auth);
  return { token: refreshed.oauthToken, source: "refreshed wrangler OAuth token" };
}

async function readWranglerAuth() {
  const configPath = wranglerConfigPath();
  const contents = await fs.readFile(configPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return "";
    throw error;
  });

  return {
    configPath,
    contents,
    oauthToken: readTomlString(contents, "oauth_token"),
    expirationTime: readTomlString(contents, "expiration_time"),
    refreshToken: readTomlString(contents, "refresh_token"),
    scopes: readTomlArray(contents, "scopes")
  };
}

async function refreshWranglerAuth(auth) {
  log("Wrangler OAuth token expired or near expiry; refreshing");
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: auth.refreshToken,
    client_id: wranglerClientId
  });

  const response = await fetchWithTimeout(oauthTokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });
  const text = await response.text();
  const body = text ? safeJsonParse(text) : {};
  if (!response.ok || body.error) {
    const message =
      typeof body.error === "string"
        ? body.error
        : body.error_description ?? body.message ?? response.statusText;
    throw new Error(
      `Cloudflare OAuth refresh failed: ${message}. Run "npx wrangler login" once, then retry.`
    );
  }

  if (!body.access_token || !body.expires_in) {
    throw new Error("Cloudflare OAuth refresh response did not include access_token/expires_in");
  }

  const nextAuth = {
    ...auth,
    oauthToken: body.access_token,
    expirationTime: new Date(Date.now() + Number(body.expires_in) * 1000).toISOString(),
    refreshToken: body.refresh_token ?? auth.refreshToken,
    scopes: body.scope ? String(body.scope).split(" ") : auth.scopes
  };
  await writeWranglerAuth(nextAuth);
  log(`Wrangler OAuth token refreshed until ${nextAuth.expirationTime}`);
  return nextAuth;
}

async function writeWranglerAuth(auth) {
  let contents = auth.contents ?? "";
  contents = setTomlString(contents, "oauth_token", auth.oauthToken);
  contents = setTomlString(contents, "expiration_time", auth.expirationTime);
  contents = setTomlString(contents, "refresh_token", auth.refreshToken);
  if (auth.scopes?.length) {
    contents = setTomlArray(contents, "scopes", auth.scopes);
  }

  await fs.mkdir(path.dirname(auth.configPath), { recursive: true });
  const tempPath = `${auth.configPath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, contents, { mode: 0o600 });
  await fs.rename(tempPath, auth.configPath);
}

function shouldRefresh(expirationTime) {
  if (!expirationTime) return false;
  const expiresAt = Date.parse(expirationTime);
  if (!Number.isFinite(expiresAt)) return true;
  return Date.now() + tokenRefreshSkewMs >= expiresAt;
}

function wranglerConfigPath() {
  return path.join(os.homedir(), ".wrangler", "config", "default.toml");
}

function readTomlString(contents, key) {
  const match = contents.match(new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*"((?:\\\\.|[^"\\\\])*)"\\s*$`, "m"));
  if (!match) return undefined;
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return match[1];
  }
}

function readTomlArray(contents, key) {
  const match = contents.match(new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*\\[(.*)\\]\\s*$`, "m"));
  if (!match) return [];
  return [...match[1].matchAll(/"((?:\\.|[^"\\])*)"/g)].map((item) => {
    try {
      return JSON.parse(`"${item[1]}"`);
    } catch {
      return item[1];
    }
  });
}

function setTomlString(contents, key, value) {
  const line = `${key} = ${JSON.stringify(value ?? "")}`;
  const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=.*$`, "m");
  if (pattern.test(contents)) {
    return contents.replace(pattern, line);
  }
  return `${contents.trimEnd()}\n${line}\n`;
}

function setTomlArray(contents, key, values) {
  const line = `${key} = [ ${values.map((value) => JSON.stringify(value)).join(", ")} ]`;
  const pattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=.*$`, "m");
  if (pattern.test(contents)) {
    return contents.replace(pattern, line);
  }
  return `${contents.trimEnd()}\n${line}\n`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function cfJson(url, init) {
  const response = await fetchWithTimeout(url, init);
  const text = await response.text();
  const body = text ? safeJsonParse(text) : {};
  if (!response.ok || body.success === false) {
    const details = formatCloudflareError(body) ?? response.statusText ?? text;
    const authHint =
      response.status === 401 || response.status === 403
        ? "Cloudflare authentication failed. If this repeats, run \"npx wrangler login\" once or set CF_API_TOKEN"
        : "Cloudflare request failed";
    throw new Error(`${authHint}: ${details} (${init?.method ?? "GET"} ${url})`);
  }
  return body;
}

async function fetchWithTimeout(url, init = {}) {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(requestTimeoutMs)
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error(`Request timed out after ${requestTimeoutMs}ms: ${url}`);
    }
    throw error;
  }
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function formatCloudflareError(body) {
  if (Array.isArray(body?.errors) && body.errors.length > 0) {
    return body.errors
      .map((error) => [error.code, error.message].filter(Boolean).join(" "))
      .join("; ");
  }
  return body?.error_description ?? body?.error ?? body?.message;
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

function log(message) {
  console.error(`[pages-direct] ${message}`);
}
