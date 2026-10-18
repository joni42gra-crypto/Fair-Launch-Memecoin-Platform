import { spawn, spawnSync } from "node:child_process";
import { access, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Connection, PublicKey } from "@solana/web3.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const onchainDir = path.resolve(here, "..");
const workspaceRoot = path.resolve(onchainDir, "..");
const programSource = path.join(
  onchainDir,
  "programs/launchpad-escrow/src/lib.rs",
);
const anchorConfig = path.join(onchainDir, "Anchor.toml");
const programSo = path.join(onchainDir, "target/deploy/launchpad_escrow.so");
const fixturesDir = path.join(here, "fixtures");
const ledgerDir = path.join(os.tmpdir(), `launchpad-escrow-validator-${process.pid}`);
const localToolsDir = path.join(workspaceRoot, ".local/share");
const solanaBin =
  process.env.ESCROW_SOLANA_BIN ??
  path.join(localToolsDir, "solana/install/active_release/bin");
const cargoHome =
  process.env.ESCROW_CARGO_HOME ??
  path.join(localToolsDir, "launchpad-tools/rustup-cargo");
const rustupHome =
  process.env.ESCROW_RUSTUP_HOME ??
  path.join(localToolsDir, "launchpad-tools/rustup");
const rpcPort = Number(process.env.ESCROW_RPC_PORT ?? "18999");
const rpcUrl = `http://127.0.0.1:${rpcPort}`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? onchainDir,
    env: options.env ?? process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

async function programArtifactIsStale() {
  const inputs = [
    programSource,
    path.join(onchainDir, "programs/launchpad-escrow/Cargo.toml"),
    path.join(onchainDir, "Cargo.lock"),
  ];
  let artifact;
  try {
    artifact = await stat(programSo);
  } catch {
    return true;
  }
  const latestInput = Math.max(
    ...(await Promise.all(inputs.map(async (file) => (await stat(file)).mtimeMs))),
  );
  return artifact.mtimeMs < latestInput;
}

async function waitForValidator(child, connection) {
  let childError;
  child.once("error", (error) => {
    childError = error;
  });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (childError) throw childError;
    if (child.exitCode !== null) {
      throw new Error(`solana-test-validator exited with code ${child.exitCode}`);
    }
    try {
      await connection.getVersion();
      return;
    } catch {
      await delay(250);
    }
  }
  throw new Error("Timed out waiting for the local solana-test-validator.");
}

async function stopValidator(child, exitPromise) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    exitPromise.then(() => true),
    delay(5_000).then(() => false),
  ]);
  if (!exited && child.exitCode === null) {
    child.kill("SIGKILL");
    await exitPromise;
  }
}

let validator;
let exitPromise;
let testPassed = false;

try {
  const source = await readFile(programSource, "utf8");
  const sourceId = source.match(/declare_id!\("([^"]+)"\)/)?.[1];
  const config = await readFile(anchorConfig, "utf8");
  const configId = config.match(/launchpad_escrow\s*=\s*"([^"]+)"/)?.[1];
  if (!sourceId || sourceId !== configId) {
    throw new Error("Program ID differs between lib.rs and Anchor.toml; refusing to test.");
  }
  const programId = new PublicKey(sourceId);
  console.log("Checking Linux io_uring support required by Agave 3.1.10...");
  run("python3", [path.join(here, "check-io-uring.py")], {
    cwd: here,
  });

  const validatorBinary = path.join(solanaBin, "solana-test-validator");
  await access(validatorBinary);

  const rustupEnv = {
    ...process.env,
    CARGO_HOME: cargoHome,
    RUSTUP_HOME: rustupHome,
    PATH: [
      path.join(cargoHome, "bin"),
      solanaBin,
      process.env.PATH ?? "",
    ].join(path.delimiter),
  };

  if (process.env.ESCROW_ALWAYS_BUILD === "1" || (await programArtifactIsStale())) {
    console.log("Building the on-chain program with Agave's pinned SBF toolchain...");
    run(
      path.join(solanaBin, "cargo-build-sbf"),
      [
        "--manifest-path",
        path.join(onchainDir, "programs/launchpad-escrow/Cargo.toml"),
        "--sbf-out-dir",
        path.join(onchainDir, "target/deploy"),
      ],
      { cwd: onchainDir, env: rustupEnv },
    );
  } else {
    console.log("Using the up-to-date local SBF artifact.");
  }
  await access(programSo);

  run(process.execPath, ["./generate-fixtures.mjs"], {
    cwd: here,
    env: process.env,
  });
  await rm(ledgerDir, { recursive: true, force: true });

  const validatorArgs = [
    "--ledger",
    ledgerDir,
    "--reset",
    "--bind-address",
    "127.0.0.1",
    "--rpc-port",
    String(rpcPort),
    "--bpf-program",
    programId.toBase58(),
    programSo,
    "--account-dir",
    path.join(fixturesDir, "accounts"),
  ];
  validator = spawn(validatorBinary, validatorArgs, {
    cwd: workspaceRoot,
    env: process.env,
    stdio: "inherit",
  });
  exitPromise = new Promise((resolve) => validator.once("exit", resolve));
  await waitForValidator(validator, new Connection(rpcUrl, "confirmed"));
  console.log(`Local validator ready at ${rpcUrl}; no external cluster is used.`);

  run(process.execPath, ["./integration.mjs"], {
    cwd: here,
    env: { ...process.env, ESCROW_RPC_URL: rpcUrl },
  });
  testPassed = true;
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
} finally {
  await stopValidator(validator, exitPromise ?? Promise.resolve());
  if (!testPassed) {
    try {
      const validatorLog = await readFile(
        path.join(ledgerDir, "validator.log"),
        "utf8",
      );
      console.error(
        `\nRecent solana-test-validator log:\n${validatorLog.slice(-12_000)}`,
      );
    } catch {
      // The validator may have failed before it created its ledger log.
    }
  }
  await rm(ledgerDir, { recursive: true, force: true });
  await rm(fixturesDir, { recursive: true, force: true });
}
