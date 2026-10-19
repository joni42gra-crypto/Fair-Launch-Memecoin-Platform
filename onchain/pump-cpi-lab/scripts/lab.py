#!/usr/bin/env python3
"""Prepare pinned public artifacts; never execute programs or contact Solana RPC."""

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import tomllib
import urllib.request

LAB = Path(__file__).resolve().parents[1]
ROOT = LAB.parents[1]
RPC_VARIABLES = (
    "RPC_URL",
    "SOLANA_RPC_URL",
    "ANCHOR_PROVIDER_URL",
    "PUMP_LOCAL_RPC",
    "PUMP_RPC_URL",
)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def manifest():
    return json.loads((LAB / "fixtures/manifest.json").read_text())


def cache_dir():
    path = Path(
        os.environ.get(
            "PUMP_LAB_CACHE_DIR",
            str(Path(tempfile.gettempdir()) / "launchpad-pump-lab-0.4.1"),
        )
    ).resolve()
    require(not path.is_relative_to(ROOT), "Artifact cache must be outside the repository")
    return path


def verify_config():
    config = manifest()
    require(config["schema_version"] == 1, "Unknown manifest schema")
    require(
        config["package"]["url"]
        == "https://static.crates.io/crates/pump-rust-client/pump-rust-client-0.4.1.crate",
        "Unexpected artifact download URL",
    )
    require(len(config["programs"]) == 1, "Stage 4A.2 loads only Pump")
    require(config["programs"][0]["name"] == "pump", "Unexpected program")
    require(config["smoke"]["discriminator_hex"] == "ffffffffffffffff", "Unexpected smoke input")
    require(config["smoke"]["expected_custom_error"] == 101, "Unexpected expected error")
    require(config["smoke"]["account_count"] == 0, "Smoke must not pass business accounts")
    require(not config["smoke"]["cpi_implemented"], "CPI is out of scope")
    require(
        config["runtime"]["feature_policy"] == "all_features_known_to_agave_3.1.10"
        and config["runtime"]["deactivated_features"] == []
        and not config["runtime"]["custom_compute_budget"],
        "Unexpected runtime policy",
    )
    for name in RPC_VARIABLES:
        require(not os.environ.get(name), f"Unset {name}; this lab must not use external RPC")
    cargo = tomllib.loads((LAB / "Cargo.toml").read_text())
    require(cargo["workspace"]["resolver"] == "2", "Lab must be an independent workspace")
    for name in ("solana-program-test", "agave-feature-set"):
        require(
            cargo["dev-dependencies"][name]["version"] == "=3.1.10",
            f"Unpinned {name}",
        )
    lock = tomllib.loads((LAB / "Cargo.lock").read_text())
    for name in ("solana-program-test", "agave-feature-set"):
        versions = [p["version"] for p in lock["package"] if p["name"] == name]
        require(versions == ["3.1.10"], f"Unexpected locked versions for {name}: {versions}")
    for tool in ("rustc", "cargo"):
        version = subprocess.check_output([tool, "--version"], text=True).strip()
        require(version.startswith(f"{tool} 1.89.0 "), f"Wrong host compiler: {version}")
        print(version)
    print("Verified independent workspace, locked Agave 3.1.10, runtime policy and RPC guard")


def prepare():
    verify_config()
    config = manifest()
    package = config["package"]
    request = urllib.request.Request(package["url"], headers={"User-Agent": "launchpad-pump-lab/0.1"})
    with urllib.request.urlopen(request, timeout=60) as response:
        require(response.url == package["url"], "Unexpected artifact redirect")
        data = response.read(package["size_bytes"] + 1)
    require(len(data) == package["size_bytes"], "Archive size mismatch")
    require(digest(data) == package["sha256"], "Archive SHA-256 mismatch; refusing extraction")
    output = cache_dir()
    output.mkdir(parents=True, exist_ok=True)
    # Never extract the archive wholesale: it also contains unrelated artifacts and keys.
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for program in config["programs"]:
            for archive_key, hash_key, filename in (
                ("archive_path", "sha256", "pump.so"),
                ("idl_archive_path", "idl_sha256", "pump.json"),
            ):
                member = archive.getmember(program[archive_key])
                require(member.isfile(), f"Not a regular file: {member.name}")
                expected_size = program["size_bytes"] if filename.endswith(".so") else 2_000_000
                require(member.size <= expected_size, f"Unexpected member size: {member.name}")
                stream = archive.extractfile(member)
                require(stream is not None, f"Missing member data: {member.name}")
                payload = stream.read(expected_size + 1)
                require(digest(payload) == program[hash_key], f"SHA-256 mismatch: {filename}")
                if filename.endswith(".so"):
                    require(len(payload) == expected_size, "SBF size mismatch")
                    require(payload[:4] == b"\x7fELF", "Not an ELF artifact")
                else:
                    idl = json.loads(payload)
                    require(idl["address"] == program["program_id"], "IDL Program ID mismatch")
                    unknown = bytes.fromhex(config["smoke"]["discriminator_hex"])
                    require(
                        all(bytes(ix["discriminator"]) != unknown for ix in idl["instructions"]),
                        "Smoke discriminator unexpectedly matches a real instruction",
                    )
                destination = output / filename
                require(not destination.is_symlink(), f"Refusing symlink: {destination}")
                destination.write_bytes(payload)
                print(f"{filename}: {len(payload)} bytes, SHA-256 {digest(payload)}")
    print(f"Verified archive SHA-256 {digest(data)}; artifacts prepared at {output}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("verify-config", "prepare"))
    args = parser.parse_args()
    if args.command == "verify-config":
        verify_config()
    else:
        prepare()


if __name__ == "__main__":
    main()
