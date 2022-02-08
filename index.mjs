import * as core from "@actions/core";
import { createHook } from "async_hooks";
import { hashFiles } from "@actions/glob";

class AsyncListener {
  promises = {};

  constructor() {
    this.hook = createHook({
      init: (asyncId, type, triggerAsyncId, resource) => {
        this.promises[asyncId] = resource;
      },
      after: (asyncId) => {
        delete this.promises[asyncId];
      },
    });
    this.hook.enable();
  }

  async join() {
    if (this.hook == null) {
      return false;
    }

    this.hook.disable();
    delete this.hook;

    let joined = false;
    for (const promise of this.promise) {
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

  process.env.KEY = `${PREFIX}-cargo-${TAG}-${SUFFIX}`;

  process.env.RESTORE_KEYS = [
    `${PREFIX}-cargo-${TAG}-`,
    `${PREFIX}-cargo-`,
  ].join("\n");
}

export async function restore() {
  await init();

  const listener = new AsyncListener();
  import * as restore from "cache/dist/restore.js";
  if (!(await listener.join())) {
    restore().await;
  }
}

export async function save() {
  await init();

  const listener = new AsyncListener();
  import * as save from "cache/dist/save.js";
  if (!(await listener.join())) {
    save().await;
  }
}
