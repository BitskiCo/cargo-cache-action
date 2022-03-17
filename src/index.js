const fs = require("fs");
const os = require("os");
const path = require("path");

const core = require("@actions/core");
const exec = require("@actions/exec");
const io = require("@actions/io");

const { hashFiles } = require("@actions/glob");

const restore = require("cache/dist/restore/index.js").default;
const save = require("cache/dist/save/index.js").default;

async function withEnv(fn) {
  const env = process.env;
  process.env = Object.create(env);
  const result = await Promise.resolve(fn());
  process.env = env;
  return result;
}

async function withCacheArgs(fn) {
  return await withEnv(async () => {
    const PATH = core.getMultilineInput("path");
    const TAG = core.getInput("tag");

    const CARGO_HOME = process.env.CARGO_HOME ?? "~/.cargo";
    const CARGO_TARGET_DIR =
      process.env.CARGO_TARGET_DIR ??
      path.join(process.env.GITHUB_WORKSPACE, "target");

    const RUNNER_OS = process.env.RUNNER_OS;
    const RUNNER_ARCH = process.env.RUNNER_ARCH;

    const PREFIX = `${RUNNER_OS}-${RUNNER_ARCH}-cargo`;
    const HASH = await hashFiles(
      ["rust-toolchain.toml", "**/Cargo.lock"].join("\n")
    );

    const inputs = [
      `${CARGO_HOME}/bin`,
      `${CARGO_HOME}/registry/cache`,
      `${CARGO_HOME}/registry/index`,
      `${CARGO_HOME}/git/db`,
      CARGO_TARGET_DIR,
    ];

    process.env.INPUT_PATH = PATH.concat(
      inputs.filter((path) => PATH.indexOf(path) < 0)
    ).join("\n");
    core.info(`path=${process.env.INPUT_PATH}`);

    process.env.INPUT_KEY = `${PREFIX}-${HASH}-${TAG}`;
    core.info(`key=${process.env.INPUT_KEY}`);

    process.env["INPUT_RESTORE-KEYS"] = [
      `${PREFIX}-${HASH}-`,
      `${PREFIX}-`,
    ].join("\n");
    core.info(`restore-keys=${process.env["INPUT_RESTORE-KEYS"]}`);

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

function isCargoCacheConfigured() {
  return core.getInput("cargo-cache") === "true";
}
async function isSccacheConfigured() {
  return (
    core.getInput("sccache") === "true" &&
    process.env.RUSTC_WRAPPER?.indexOf("sccache") >= 0 &&
    (await io.which("sccache"))
  );
}

module.exports.run = async function run() {
  await core.group("sccache", async () => {
    if (await isSccacheConfigured()) {
      core.info("Starting sccache server");
      await exec.exec("sccache", ["--show-stats"]);
    } else {
      core.info("sccache is not configured");
    }
  });

  await core.group("actions/cache@v2", async () => {
    await withCacheArgs(async () => {
      await restore();
    });
  });
};

module.exports.runPost = async function runPost() {
  await core.group("cargo-cache", async () => {
    if (!isCargoCacheConfigured()) {
      core.info("cargo-cache not enabled");
      return;
    }
    if (isCacheHit()) {
      core.info("Cache hit, not cleaning cache");
      return;
    }

    if (!(await io.which("cargo-cache"))) {
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

  await core.group("sccache", async () => {
    if (await isSccacheConfigured()) {
      core.info("Stopping sccache server");
      await exec.exec("sccache", ["--stop-server"]);
    } else {
      core.info("sccache is not configured");
    }
  });

  await core.group("actions/cache@v2", async () => {
    await withCacheArgs(async () => {
      await save();
    });
  });
};
