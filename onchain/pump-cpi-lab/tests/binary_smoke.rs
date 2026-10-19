use {
    agave_feature_set::FEATURE_NAMES,
    serde_json::{json, Value},
    sha2::{Digest, Sha256},
    solana_instruction::{error::InstructionError, Instruction},
    solana_program_test::ProgramTest,
    solana_pubkey::Pubkey,
    solana_signer::Signer,
    solana_transaction::Transaction,
    solana_transaction_error::TransactionError,
    std::{env, fs, path::PathBuf, process::Command, str::FromStr},
};

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[tokio::test]
async fn real_pump_sbf_reaches_anchor_dispatcher_and_rejects_unknown_instruction() {
    // Compile-only is permitted locally. Actual runtime execution belongs to the dedicated CI job.
    assert_eq!(env::var("GITHUB_ACTIONS").as_deref(), Ok("true"));
    assert_eq!(env::var("RUNNER_OS").as_deref(), Ok("Linux"));
    assert_eq!(env::var("RUNNER_ARCH").as_deref(), Ok("X64"));
    assert_eq!(
        env::var("GITHUB_WORKFLOW").as_deref(),
        Ok("Pump SBF binary smoke test")
    );
    for name in [
        "RPC_URL",
        "SOLANA_RPC_URL",
        "ANCHOR_PROVIDER_URL",
        "PUMP_LOCAL_RPC",
        "PUMP_RPC_URL",
    ] {
        assert!(
            env::var(name).unwrap_or_default().is_empty(),
            "Unset {name}; no external cluster is permitted"
        );
    }
    let lab = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let preflight = lab.join("../test-client/check-io-uring.py");
    assert!(
        Command::new("python3")
            .arg(preflight)
            .status()
            .expect("execute the unchanged io_uring preflight")
            .success(),
        "io_uring preflight failed; do not start ProgramTest"
    );
    let config: Value =
        serde_json::from_slice(&fs::read(lab.join("fixtures/manifest.json")).unwrap()).unwrap();
    let program = &config["programs"][0];
    let expected_id = Pubkey::from_str(program["program_id"].as_str().unwrap()).unwrap();
    let artifact_dir =
        PathBuf::from(env::var("PUMP_LAB_CACHE_DIR").expect("prepared external cache"));
    let artifact_dir = fs::canonicalize(artifact_dir).expect("artifact directory exists");
    let root = fs::canonicalize(lab.join("../..")).unwrap();
    assert!(!artifact_dir.starts_with(root), "No .so files in the repo");
    let bytes = fs::read(artifact_dir.join("pump.so")).expect("verified real pump.so is mandatory");
    assert_eq!(sha256(&bytes), program["sha256"].as_str().unwrap());
    assert_eq!(bytes.len() as u64, program["size_bytes"].as_u64().unwrap());
    assert_eq!(&bytes[..4], b"\x7fELF");
    let evidence_dir =
        PathBuf::from(env::var("PUMP_LAB_EVIDENCE_DIR").expect("external evidence directory"));
    fs::create_dir_all(&evidence_dir).unwrap();
    let mut features: Vec<_> = FEATURE_NAMES
        .iter()
        .map(|(id, name)| json!({"id": id.to_string(), "name": name, "active": true}))
        .collect();
    features.sort_by_key(|feature| feature["id"].as_str().unwrap().to_owned());
    let feature_bytes = serde_json::to_vec(&features).unwrap();
    let mut evidence = json!({
        "program_id": expected_id.to_string(),
        "artifact_sha256": sha256(&bytes),
        "runtime": config["runtime"],
        "active_features": features,
        "active_features_sha256": sha256(&feature_bytes),
        "stage": "before_bank_start",
        "cpi_tested": false,
        "token_creation_tested": false,
        "creator_fees_tested": false
    });
    let evidence_file = evidence_dir.join("pump-smoke.json");
    fs::write(
        &evidence_file,
        serde_json::to_vec_pretty(&evidence).unwrap(),
    )
    .unwrap();
    // No native processor is supplied. Missing or incompatible SBF must fail.
    env::set_var("BPF_OUT_DIR", &artifact_dir);
    env::set_var("SBF_OUT_DIR", &artifact_dir);
    let mut test = ProgramTest::default();
    test.prefer_bpf(true);
    // Explicit policy: all features in the pinned Agave 3.1.10, none deactivated.
    // No custom CU, stack, account-lock, or loaded-data limits.
    test.add_program("pump", expected_id, None);
    let context = test.start_with_context().await;
    let loaded = context
        .banks_client
        .get_account(expected_id)
        .await
        .unwrap()
        .expect("Pump account must be loaded");
    assert!(loaded.executable);
    assert_eq!(loaded.owner, solana_sdk_ids::bpf_loader::id());
    assert_eq!(sha256(&loaded.data), program["sha256"].as_str().unwrap());
    evidence["stage"] = json!("bank_loaded");
    fs::write(
        &evidence_file,
        serde_json::to_vec_pretty(&evidence).unwrap(),
    )
    .unwrap();
    let instruction = Instruction {
        program_id: expected_id,
        accounts: vec![],
        data: vec![0xff; 8],
    };
    let transaction = Transaction::new_signed_with_payer(
        &[instruction],
        Some(&context.payer.pubkey()),
        &[&context.payer],
        context.last_blockhash,
    );
    // BanksClient is in-process. No RPC client, network cluster, or wallet is used.
    let outcome = context
        .banks_client
        .process_transaction_with_metadata(transaction)
        .await
        .expect("BanksClient must return the actual transaction result");
    evidence["transaction_result"] = json!(format!("{:?}", outcome.result));
    if let Some(metadata) = &outcome.metadata {
        evidence["log_messages"] = json!(metadata.log_messages);
        evidence["compute_units_consumed"] = json!(metadata.compute_units_consumed);
    }
    evidence["stage"] = json!("transaction_observed");
    fs::write(
        &evidence_file,
        serde_json::to_vec_pretty(&evidence).unwrap(),
    )
    .unwrap();
    println!("{}", serde_json::to_string_pretty(&evidence).unwrap());
    assert_eq!(
        outcome.result,
        Err(TransactionError::InstructionError(
            0,
            InstructionError::Custom(101)
        )),
        "Require the exact Anchor rejection, not an arbitrary runtime failure"
    );
    let metadata = outcome
        .metadata
        .expect("SBF execution metadata is mandatory");
    assert!(metadata.compute_units_consumed > 0);
    assert!(metadata
        .log_messages
        .iter()
        .any(|line| line == &format!("Program {expected_id} invoke [1]")));
    assert!(
        metadata
            .log_messages
            .iter()
            .any(|line| line.contains("InstructionFallbackNotFound") && line.contains("101")),
        "Must reach Anchor's real dispatcher; loader errors are not success"
    );
    assert_eq!(
        context
            .banks_client
            .get_account(expected_id)
            .await
            .unwrap()
            .unwrap(),
        loaded,
        "Rejected smoke instruction must not alter the executable account"
    );
    evidence["stage"] = json!("dispatcher_rejection_verified");
    fs::write(
        &evidence_file,
        serde_json::to_vec_pretty(&evidence).unwrap(),
    )
    .unwrap();
}
