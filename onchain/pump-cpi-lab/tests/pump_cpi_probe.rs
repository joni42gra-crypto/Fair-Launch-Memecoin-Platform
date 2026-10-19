use {
    serde_json::{json, Value},
    sha2::{Digest, Sha256},
    solana_account::Account,
    solana_instruction::{AccountMeta, Instruction},
    solana_program::{
        account_info::{next_account_info, AccountInfo},
        entrypoint::ProgramResult,
        program::invoke_signed,
        program_error::ProgramError,
        pubkey::Pubkey,
        rent::Rent,
    },
    solana_program_test::{processor, ProgramTest},
    solana_signer::Signer,
    solana_transaction::Transaction,
    std::{env, fs, path::Path, path::PathBuf, process::Command, str::FromStr},
};

const PUMP_PROGRAM_ID: &str = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PROBE_PROGRAM_BYTES: [u8; 32] = [0x42; 32];
const PAYER_SEED: &[u8] = b"pump-cpi-probe-payer-v1";
const USER_SEED: &[u8] = b"pump-cpi-probe-user-v1";
const USER_VOLUME_ACCUMULATOR_SEED: &[u8] = b"user_volume_accumulator";
const EVENT_AUTHORITY_SEED: &[u8] = b"__event_authority";
const INIT_USER_VOLUME_ACCUMULATOR_DISCRIMINATOR: [u8; 8] = [94, 6, 202, 115, 255, 96, 232, 183];
const USER_VOLUME_ACCUMULATOR_DISCRIMINATOR: [u8; 8] = [86, 255, 112, 14, 102, 53, 154, 250];
const USER_VOLUME_ACCUMULATOR_SIZE: usize = 137;
const INIT_ACCOUNT_LAYOUT: [(&str, bool, bool); 6] = [
    ("payer", true, true),
    ("user", false, false),
    ("user_volume_accumulator", true, false),
    ("system_program", false, false),
    ("event_authority", false, false),
    ("program", false, false),
];

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn probe_program_id() -> Pubkey {
    Pubkey::new_from_array(PROBE_PROGRAM_BYTES)
}

fn assert_is_isolated_ci_runtime(lab: &Path) {
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

    let preflight = lab.join("../test-client/check-io-uring.py");
    assert!(
        Command::new("python3")
            .arg(preflight)
            .status()
            .expect("execute the unchanged io_uring preflight")
            .success(),
        "io_uring preflight failed; do not start ProgramTest"
    );
}

fn verify_pinned_idl(artifact_dir: &Path) {
    let idl: Value =
        serde_json::from_slice(&fs::read(artifact_dir.join("pump.json")).unwrap()).unwrap();
    let instruction = idl["instructions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|instruction| instruction["name"] == "init_user_volume_accumulator")
        .expect("pinned Pump IDL contains init_user_volume_accumulator");
    let discriminator: Vec<u8> = instruction["discriminator"]
        .as_array()
        .unwrap()
        .iter()
        .map(|byte| byte.as_u64().unwrap() as u8)
        .collect();
    assert_eq!(discriminator, INIT_USER_VOLUME_ACCUMULATOR_DISCRIMINATOR);

    let accounts = instruction["accounts"].as_array().unwrap();
    assert_eq!(accounts.len(), INIT_ACCOUNT_LAYOUT.len());
    for (account, (expected_name, writable, signer)) in accounts.iter().zip(INIT_ACCOUNT_LAYOUT) {
        assert_eq!(account["name"].as_str(), Some(expected_name));
        assert_eq!(account["writable"].as_bool().unwrap_or(false), writable);
        assert_eq!(account["signer"].as_bool().unwrap_or(false), signer);
    }
    assert_eq!(
        accounts[3]["address"].as_str(),
        Some("11111111111111111111111111111111")
    );

    let user_accumulator = idl["accounts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|account| account["name"] == "UserVolumeAccumulator")
        .expect("pinned Pump IDL contains UserVolumeAccumulator");
    let account_discriminator: Vec<u8> = user_accumulator["discriminator"]
        .as_array()
        .unwrap()
        .iter()
        .map(|byte| byte.as_u64().unwrap() as u8)
        .collect();
    assert_eq!(account_discriminator, USER_VOLUME_ACCUMULATOR_DISCRIMINATOR);
}

/// Disposable native ProgramTest processor with one fixed Pump CPI and no
/// caller-controlled instruction data, target program, PDA, or recipient.
fn process_probe<'a>(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'a>],
    data: &[u8],
) -> ProgramResult {
    if *program_id != probe_program_id() {
        return Err(ProgramError::IncorrectProgramId);
    }
    if !data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }
    if accounts.len() != INIT_ACCOUNT_LAYOUT.len() {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let mut account_iter = accounts.iter();
    let payer = next_account_info(&mut account_iter)?;
    let user = next_account_info(&mut account_iter)?;
    let user_volume_accumulator = next_account_info(&mut account_iter)?;
    let system_program = next_account_info(&mut account_iter)?;
    let event_authority = next_account_info(&mut account_iter)?;
    let pump_program = next_account_info(&mut account_iter)?;

    let pump_id = Pubkey::from_str(PUMP_PROGRAM_ID).expect("fixed Pump program ID");
    let system_program_id = solana_sdk_ids::system_program::id();
    let expected_payer = Pubkey::find_program_address(&[PAYER_SEED], program_id).0;
    let expected_user = Pubkey::find_program_address(&[USER_SEED], program_id).0;
    let expected_accumulator = Pubkey::find_program_address(
        &[USER_VOLUME_ACCUMULATOR_SEED, expected_user.as_ref()],
        &pump_id,
    )
    .0;
    let expected_event_authority =
        Pubkey::find_program_address(&[EVENT_AUTHORITY_SEED], &pump_id).0;

    if payer.key != &expected_payer
        || user.key != &expected_user
        || user_volume_accumulator.key != &expected_accumulator
        || system_program.key != &system_program_id
        || event_authority.key != &expected_event_authority
        || pump_program.key != &pump_id
        || !payer.is_writable
        || payer.is_signer
        || !payer.data_is_empty()
        || payer.owner != &system_program_id
        || user.is_writable
        || user.is_signer
        || user.owner != &system_program_id
        || !user.data_is_empty()
        || !user_volume_accumulator.is_writable
        || user_volume_accumulator.owner != &system_program_id
        || !user_volume_accumulator.data_is_empty()
        || user_volume_accumulator.lamports() != 0
        || system_program.is_writable
        || event_authority.is_writable
        || pump_program.is_writable
        || !pump_program.executable
        || pump_program.owner != &solana_sdk_ids::bpf_loader::id()
    {
        return Err(ProgramError::InvalidAccountData);
    }

    let (_, bump) = Pubkey::find_program_address(&[PAYER_SEED], program_id);
    let bump_seed = [bump];
    let signer_seeds: &[&[u8]] = &[PAYER_SEED, &bump_seed];
    let signer_seeds: &[&[&[u8]]] = &[signer_seeds];
    let instruction = Instruction {
        program_id: pump_id,
        accounts: vec![
            AccountMeta::new(expected_payer, true),
            AccountMeta::new_readonly(expected_user, false),
            AccountMeta::new(expected_accumulator, false),
            AccountMeta::new_readonly(system_program_id, false),
            AccountMeta::new_readonly(expected_event_authority, false),
            AccountMeta::new_readonly(pump_id, false),
        ],
        data: INIT_USER_VOLUME_ACCUMULATOR_DISCRIMINATOR.to_vec(),
    };
    let cpi_accounts = [
        payer.clone(),
        user.clone(),
        user_volume_accumulator.clone(),
        system_program.clone(),
        event_authority.clone(),
        pump_program.clone(),
    ];

    invoke_signed(&instruction, &cpi_accounts, signer_seeds)
}

#[tokio::test]
async fn real_pump_sbf_accepts_fixed_probe_pda_signer_for_user_accumulator_init() {
    let lab = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    assert_is_isolated_ci_runtime(&lab);

    let config: Value =
        serde_json::from_slice(&fs::read(lab.join("fixtures/manifest.json")).unwrap()).unwrap();
    let program = &config["programs"][0];
    let pump_id = Pubkey::from_str(program["program_id"].as_str().unwrap()).unwrap();
    assert_eq!(pump_id, Pubkey::from_str(PUMP_PROGRAM_ID).unwrap());

    let artifact_dir =
        PathBuf::from(env::var("PUMP_LAB_CACHE_DIR").expect("prepared external cache"));
    let artifact_dir = fs::canonicalize(artifact_dir).expect("artifact directory exists");
    let root = fs::canonicalize(lab.join("../..")).unwrap();
    assert!(!artifact_dir.starts_with(&root), "No .so files in the repo");
    let pump_bytes = fs::read(artifact_dir.join("pump.so")).expect("verified real pump.so");
    let expected_sha256 = program["sha256"].as_str().unwrap();
    assert_eq!(sha256(&pump_bytes), expected_sha256);
    assert_eq!(
        pump_bytes.len() as u64,
        program["size_bytes"].as_u64().unwrap()
    );
    assert_eq!(&pump_bytes[..4], b"\x7fELF");
    verify_pinned_idl(&artifact_dir);

    let evidence_dir =
        PathBuf::from(env::var("PUMP_LAB_EVIDENCE_DIR").expect("external evidence directory"));
    fs::create_dir_all(&evidence_dir).unwrap();
    let evidence_dir = fs::canonicalize(evidence_dir).unwrap();
    assert!(
        !evidence_dir.starts_with(&root),
        "Evidence stays outside the repo"
    );
    let evidence_file = evidence_dir.join("pump-cpi.json");
    let probe_id = probe_program_id();
    let (payer_pda, _) = Pubkey::find_program_address(&[PAYER_SEED], &probe_id);
    let (user_pda, _) = Pubkey::find_program_address(&[USER_SEED], &probe_id);
    let accumulator_pda =
        Pubkey::find_program_address(&[USER_VOLUME_ACCUMULATOR_SEED, user_pda.as_ref()], &pump_id)
            .0;
    let event_authority = Pubkey::find_program_address(&[EVENT_AUTHORITY_SEED], &pump_id).0;
    let payer_rent_budget = Rent::default().minimum_balance(USER_VOLUME_ACCUMULATOR_SIZE);
    let mut evidence = json!({
        "stage": "before_bank_start",
        "pump_program_id": pump_id.to_string(),
        "pump_artifact_sha256": sha256(&pump_bytes),
        "probe_program_id": probe_id.to_string(),
        "probe_kind": "test-only native ProgramTest processor",
        "instruction": "init_user_volume_accumulator",
        "payer_pda": payer_pda.to_string(),
        "user_pda": user_pda.to_string(),
        "pump_user_volume_accumulator_pda": accumulator_pda.to_string(),
        "event_authority": event_authority.to_string(),
        "payer_funds": "synthetic ProgramTest genesis balance; rent only",
        "cpi_tested": false,
        "token_creation_tested": false,
        "external_rpc_used": false
    });
    fs::write(
        &evidence_file,
        serde_json::to_vec_pretty(&evidence).unwrap(),
    )
    .unwrap();

    env::set_var("BPF_OUT_DIR", &artifact_dir);
    env::set_var("SBF_OUT_DIR", &artifact_dir);
    let mut test = ProgramTest::default();
    // ProgramTest::default() prefers BPF whenever BPF_OUT_DIR/SBF_OUT_DIR is
    // set. Override that default for the native probe, then require BPF for
    // Pump. add_program selects its implementation at registration time.
    test.prefer_bpf(false);
    test.add_program("pump-cpi-probe", probe_id, processor!(process_probe));
    test.prefer_bpf(true);
    test.add_program("pump", pump_id, None);

    let system_program_id = solana_sdk_ids::system_program::id();
    let payer_initial_lamports = payer_rent_budget
        .checked_add(1)
        .expect("test payer balance does not overflow");
    test.add_account(
        payer_pda,
        Account {
            lamports: payer_initial_lamports,
            data: vec![],
            owner: system_program_id,
            executable: false,
            rent_epoch: 0,
        },
    );
    test.add_account(
        user_pda,
        Account {
            lamports: 1,
            data: vec![],
            owner: system_program_id,
            executable: false,
            rent_epoch: 0,
        },
    );

    let context = test.start_with_context().await;
    let rent_lamports = context
        .banks_client
        .get_rent()
        .await
        .expect("ProgramTest runtime Rent sysvar must be available")
        .minimum_balance(USER_VOLUME_ACCUMULATOR_SIZE);
    assert_eq!(
        payer_initial_lamports,
        rent_lamports
            .checked_add(1)
            .expect("runtime payer balance does not overflow"),
        "payer must be funded for the actual ProgramTest runtime rent"
    );
    let loaded_pump = context
        .banks_client
        .get_account(pump_id)
        .await
        .unwrap()
        .expect("the pinned Pump SBF program must be loaded");
    assert!(loaded_pump.executable);
    assert_eq!(loaded_pump.owner, solana_sdk_ids::bpf_loader::id());
    assert_eq!(sha256(&loaded_pump.data), expected_sha256);
    evidence["stage"] = json!("real_pump_sbf_loaded");
    fs::write(
        &evidence_file,
        serde_json::to_vec_pretty(&evidence).unwrap(),
    )
    .unwrap();

    let instruction = Instruction {
        program_id: probe_id,
        accounts: vec![
            AccountMeta::new(payer_pda, false),
            AccountMeta::new_readonly(user_pda, false),
            AccountMeta::new(accumulator_pda, false),
            AccountMeta::new_readonly(system_program_id, false),
            AccountMeta::new_readonly(event_authority, false),
            AccountMeta::new_readonly(pump_id, false),
        ],
        data: vec![],
    };
    let transaction = Transaction::new_signed_with_payer(
        &[instruction],
        Some(&context.payer.pubkey()),
        &[&context.payer],
        context.last_blockhash,
    );
    let outcome = context
        .banks_client
        .process_transaction_with_metadata(transaction)
        .await
        .expect("BanksClient must return the actual transaction result");
    let metadata = outcome
        .metadata
        .as_ref()
        .expect("ProgramTest execution metadata is mandatory");
    evidence["transaction_result"] = json!(format!("{:?}", outcome.result));
    evidence["log_messages"] = json!(metadata.log_messages);
    evidence["compute_units_consumed"] = json!(metadata.compute_units_consumed);
    evidence["stage"] = json!("transaction_observed");
    fs::write(
        &evidence_file,
        serde_json::to_vec_pretty(&evidence).unwrap(),
    )
    .unwrap();

    assert!(
        outcome.result.is_ok(),
        "The real Pump CPI must succeed; not a dispatcher rejection or arbitrary error: {:?}",
        outcome.result
    );
    assert!(metadata.compute_units_consumed > 0);
    assert!(
        metadata
            .log_messages
            .iter()
            .any(|line| line == &format!("Program {pump_id} invoke [2]")),
        "The actual Pump SBF program must be invoked through CPI"
    );
    assert!(
        metadata
            .log_messages
            .iter()
            .any(|line| line == &format!("Program {pump_id} success")),
        "The Pump instruction must return success"
    );

    let accumulator = context
        .banks_client
        .get_account(accumulator_pda)
        .await
        .unwrap()
        .expect("Pump must create the requested UserVolumeAccumulator PDA");
    assert_eq!(accumulator.owner, pump_id);
    assert!(!accumulator.executable);
    assert_eq!(accumulator.data.len(), USER_VOLUME_ACCUMULATOR_SIZE);
    assert_eq!(
        &accumulator.data[..8],
        USER_VOLUME_ACCUMULATOR_DISCRIMINATOR.as_slice()
    );
    assert_eq!(&accumulator.data[8..40], user_pda.as_ref());
    assert_eq!(accumulator.lamports, rent_lamports);

    let payer_after = context
        .banks_client
        .get_account(payer_pda)
        .await
        .unwrap()
        .expect("the one-lamport system PDA remains after paying rent");
    assert_eq!(
        payer_after.lamports,
        payer_initial_lamports - rent_lamports,
        "Only the fixed account's exact rent was spent"
    );

    evidence["stage"] = json!("successful_pump_cpi_verified");
    evidence["cpi_tested"] = json!(true);
    evidence["payer_lamports_before"] = json!(payer_initial_lamports);
    evidence["payer_lamports_after"] = json!(payer_after.lamports);
    evidence["accumulator_owner"] = json!(accumulator.owner.to_string());
    evidence["accumulator_data_len"] = json!(accumulator.data.len());
    evidence["accumulator_lamports"] = json!(accumulator.lamports);
    fs::write(
        &evidence_file,
        serde_json::to_vec_pretty(&evidence).unwrap(),
    )
    .unwrap();
    println!("{}", serde_json::to_string_pretty(&evidence).unwrap());
}
