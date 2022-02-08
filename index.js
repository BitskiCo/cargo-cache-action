const core = require("@actions/core");
const { createHook } = require("async_hooks");
const { hashFiles } = require("@actions/glob");

class AsyncListener {
  promises = {};

  hook = createHook({
    init: (asyncId, type, triggerAsyncId, resource) => {
      this.promises[asyncId] = resource;
    },
    after: (asyncId) => {
      delete this.promises[asyncId];
    },
  });

  constructor() {
    this.hook.enable();
  }

  async join() {
    if (this.hook == null) {
      return false;
    }

    this.hook.disable();
    this.hook = null;

    let joined = false;
    for (const promise of Object.values(this.promises)) {
      await promise;
      joined = true;
    }

    this.promises = {};

    return joined;
  }
}

async function init() {
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
}

module.exports.restore = async function restore() {
  await init();

  const listener = new AsyncListener();
  const restore = require("cache/dist/restore/index.js");
  if (!(await listener.join())) {
    await restore();
  }
};

module.exports.save = async function save() {
  await init();

  const listener = new AsyncListener();
  const save = require("cache/dist/save/index.js");
  if (!(await listener.join())) {
    await save();
  }
};
