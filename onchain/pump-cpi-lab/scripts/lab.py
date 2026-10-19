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
    require(config["schema_version"] == 2, "Unknown manifest schema")
    require(
        config["package"]["url"]
        == "https://static.crates.io/crates/pump-rust-client/pump-rust-client-0.4.1.crate",
        "Unexpected artifact download URL",
    )
    require(len(config["programs"]) == 1, "The lab must pin exactly one Pump program")
    pump = config["programs"][0]
    require(
        pump["name"] == "pump"
        and pump["program_id"] == "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
        and pump["archive_path"] == "pump-rust-client-0.4.1/artifacts/pump.so"
        and pump["sha256"]
        == "692b19d0242b906d73764c41d30f7b61816c1c6f30a0164e09a20adf9578c092"
        and pump["size_bytes"] == 1_899_448
        and pump["idl_archive_path"] == "pump-rust-client-0.4.1/idls/pump.json"
        and pump["idl_sha256"]
        == "7616681ea557975f9f623ac211080f22a93060781eaf4765b0a488d980997207",
        "Unexpected Pump SBF/IDL artifact pin",
    )
    support = config.get("support_programs", [])
    require(
        len(support) == 1
        and support[0]["name"] == "mayhem_program"
        and support[0]["program_id"] == "MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e",
        "Unexpected create_v2 support program",
    )
    require(
        support[0]["archive_path"]
        == "pump-rust-client-0.4.1/artifacts/mayhem_program.so"
        and support[0]["sha256"]
        == "cc8a5a79f3e38a5014960ae9ba06d70ee1fe3966b8e804b43671c146fc3e014b"
        and support[0]["size_bytes"] == 676_720,
        "Unexpected Mayhem SBF artifact pin",
    )
    require(config["smoke"]["discriminator_hex"] == "ffffffffffffffff", "Unexpected smoke input")
    require(config["smoke"]["expected_custom_error"] == 101, "Unexpected expected error")
    require(config["smoke"]["account_count"] == 0, "Smoke must not pass business accounts")
    require(not config["smoke"]["cpi_implemented"], "Smoke input must remain a dispatcher-only test")
    create_v2 = config["create_v2"]
    require(
        create_v2["instruction"] == "create_v2"
        and create_v2["discriminator_hex"] == "d6904cec5f8b31b4"
        and create_v2["creator_is_probe_program_pda"]
        and create_v2["mayhem_mode"] is False
        and create_v2["transaction_compute_unit_limit"] == 400_000
        and create_v2["global_state_source"]
        == "actual pinned Pump SBF initialize and set_params instructions executed in ProgramTest"
        and create_v2["create_v2_enablement"]
        == "actual pinned Pump SBF toggle_create_v2 instruction executed in ProgramTest"
        and create_v2["setup_instructions"]
        == [
            {
                "instruction": "initialize",
                "discriminator_hex": "afaf6d1f0d989bed",
            },
            {
                "instruction": "set_params",
                "discriminator_hex": "1beab2349302bb8d",
            },
            {
                "instruction": "toggle_create_v2",
                "discriminator_hex": "1cffe6f0ac6bcbab",
            },
        ]
        and not create_v2["buy_tested"]
        and not create_v2["migration_tested"]
        and not create_v2["creator_fees_tested"],
        "Unexpected create_v2 test scope",
    )
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
    expected_dev_dependencies = {
        "base64": "0.22.1",
        "solana-compute-budget-interface": "3.0.0",
        "spl-associated-token-account": "8.0.0",
        "spl-token-2022": "10.0.0",
    }
    for name, version in expected_dev_dependencies.items():
        dependency = cargo["dev-dependencies"][name]
        declared_version = dependency if isinstance(dependency, str) else dependency["version"]
        require(declared_version == f"={version}", f"Unpinned {name}")
    lock = tomllib.loads((LAB / "Cargo.lock").read_text())
    for name in ("solana-program-test", "agave-feature-set"):
        versions = [p["version"] for p in lock["package"] if p["name"] == name]
        require(versions == ["3.1.10"], f"Unexpected locked versions for {name}: {versions}")
    for name, version in expected_dev_dependencies.items():
        versions = [p["version"] for p in lock["package"] if p["name"] == name]
        require(version in versions, f"Missing locked {name} {version}: {versions}")
    for tool in ("rustc", "cargo"):
        version = subprocess.check_output([tool, "--version"], text=True).strip()
        require(version.startswith(f"{tool} 1.89.0 "), f"Wrong host compiler: {version}")
        print(version)
    print(
        "Verified pinned Pump/Mayhem artifacts, isolated workspace, locked test dependencies, runtime policy and RPC guard"
    )


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
        artifacts = []
        for program in config["programs"]:
            artifacts.append(
                (program, "archive_path", "sha256", "size_bytes", "program")
            )
            artifacts.append(
                (program, "idl_archive_path", "idl_sha256", None, "idl")
            )
        for program in config.get("support_programs", []):
            artifacts.append(
                (program, "archive_path", "sha256", "size_bytes", "program")
            )
        for program, archive_key, hash_key, size_key, artifact_kind in artifacts:
            filename = Path(program[archive_key]).name
            member = archive.getmember(program[archive_key])
            require(member.isfile(), f"Not a regular file: {member.name}")
            expected_size = program[size_key] if size_key else 2_000_000
            require(member.size <= expected_size, f"Unexpected member size: {member.name}")
            stream = archive.extractfile(member)
            require(stream is not None, f"Missing member data: {member.name}")
            payload = stream.read(expected_size + 1)
            require(digest(payload) == program[hash_key], f"SHA-256 mismatch: {filename}")
            if artifact_kind == "program":
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
