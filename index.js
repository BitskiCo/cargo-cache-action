const core = require("@actions/core");
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

async function withCacheArgs(fn) {
  const env = process.env;
  process.env = Object.create(env);

  const TAG = core.getInput("tag");

  const CARGO_HOME = process.env.CARGO_HOME ?? "~/.cargo";
  const CARGO_TARGET_DIR = process.env.CARGO_TARGET_DIR ?? "target";
  const RUNNER_OS = process.env.RUNNER_OS;
  const RUNNER_ARCH = process.env.RUNNER_ARCH;

  const PREFIX = `${RUNNER_OS}-${RUNNER_ARCH}`;
  const SUFFIX = await hashFiles(
    ["rust-toolchain.toml", "**/Cargo.lock"].join("\n")
  );

  process.env.INPUT_PATH = [
    `${CARGO_HOME}/bin`,
    `${CARGO_HOME}/registry/cache`,
    `${CARGO_HOME}/registry/index`,
    `${CARGO_HOME}/git/db`,
    `${CARGO_TARGET_DIR}`,
  ].join("\n");

  process.env.INPUT_KEY = `${PREFIX}-cargo-${TAG}-${SUFFIX}`;

  process.env["INPUT_RESTORE-KEYS"] = [
    `${PREFIX}-cargo-${TAG}-`,
    `${PREFIX}-cargo-`,
  ].join("\n");

  const result = await Promise.resolve(fn());

  process.env = env;

  return result;
}

module.exports.restore = async function restore() {
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
};

module.exports.save = async function save() {
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
};
