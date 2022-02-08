const fs = require("fs");
const os = require("os");
const path = require("path");

const core = require("@actions/core");
const exec = require("@actions/exec");
const io = require("@actions/io");

const { createHook } = require("async_hooks");
const { hashFiles } = require("@actions/glob");

async function withAwait(init, run) {
  const promises = {};
  const hook = createHook({
    init: (asyncId, type, triggerAsyncId, resource) => {
      promises[asyncId] = resource;
    },
    after: (asyncId) => {
      delete promises[asyncId];
    },
  });

  hook.enable();
  let context = await Promise.resolve(init());
  hook.disable();

  const results = await Promise.all(Object.values(promises));
  return await Promise.resolve(run(results.length, context));
}

async function withEnv(fn) {
  const env = process.env;
  process.env = Object.create(env);
  const result = await Promise.resolve(fn());
  process.env = env;
  return result;
}

async function withCacheArgs(fn) {
  return await withEnv(async () => {
    const TAG = core.getInput("tag");

    const CARGO_HOME = process.env.CARGO_HOME ?? "~/.cargo";
    const CARGO_TARGET_DIR = process.env.CARGO_TARGET_DIR ?? "target";
    const RUNNER_OS = process.env.RUNNER_OS;
    const RUNNER_ARCH = process.env.RUNNER_ARCH;

    const PREFIX = `${RUNNER_OS}-${RUNNER_ARCH}-cargo`;
    const HASH = await hashFiles(
      ["rust-toolchain.toml", "**/Cargo.lock"].join("\n")
    );

    process.env.INPUT_PATH = [
      `${CARGO_HOME}/bin`,
      `${CARGO_HOME}/registry/cache`,
      `${CARGO_HOME}/registry/index`,
      `${CARGO_HOME}/git/db`,
      `${CARGO_TARGET_DIR}`,
    ].join("\n");

    process.env.INPUT_KEY = `${PREFIX}-${HASH}-${TAG}`;

    process.env["INPUT_RESTORE-KEYS"] = [
      `${PREFIX}-${HASH}-`,
      `${PREFIX}-`,
    ].join("\n");

    return await Promise.resolve(fn());
  });
}

function isCacheHit() {
  const key = core.getState("CACHE_KEY");
  const cacheKey = core.getState("CACHE_RESULT");
  return (
    cacheKey?.localeCompare(key, undefined, {
      sensitivity: "accent",
    }) === 0
  );
}

module.exports.run = async function run() {
  await core.group("Run actions/cache@v2", async () => {
    await withCacheArgs(async () => {
      await withAwait(
        () => require("cache/dist/restore/index.js"),
        async (n, restore) => {
          if (n === 0) {
            await restore();
          }
        }
      );
    });
  });
};

module.exports.runPost = async function runPost() {
  await core.group("cargo-cache", async () => {
    if (isCacheHit()) {
      core.info("Cache hit, not cleaning cache.");
      return;
    }

    if (!(await io.which("cargo-cache", false))) {
      await exec.exec("cargo", [
        "install",
        "--no-default-features",
        "--features",
        "ci-autoclean",
        "cargo-cache",
      ]);
    }

    await exec.exec("cargo-cache", ["--autoclean"]);
  });

  await core.group("actions/cache@v2", async () => {
    await withCacheArgs(async () => {
      await withAwait(
        () => require("cache/dist/save/index.js"),
        async (n, save) => {
          if (n === 0) {
            await save();
          }
        }
      );
    });
  });
};
