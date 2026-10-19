use {
    serde_json::{json, Value},
    sha2::{Digest, Sha256},
    solana_account::Account,
    solana_compute_budget_interface::ComputeBudgetInstruction,
    solana_instruction::{AccountMeta, Instruction},
    solana_program::{
        account_info::AccountInfo, entrypoint::ProgramResult, msg, program::invoke_signed,
        program_error::ProgramError, program_option::COption, pubkey::Pubkey,
    },
    solana_program_test::{processor, ProgramTest},
    solana_signer::Signer,
    solana_transaction::Transaction,
    spl_token_2022::{
        extension::{BaseStateWithExtensions, StateWithExtensions},
        state::{Account as TokenAccount, Mint},
    },
    spl_token_metadata_interface::state::TokenMetadata,
    std::{env, fs, path::Path, path::PathBuf, process::Command, str::FromStr},
};

const PUMP_PROGRAM_ID: &str = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const MAYHEM_PROGRAM_ID: &str = "MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e";
const PROBE_PROGRAM_BYTES: [u8; 32] = [0x43; 32];
const CREATOR_SEED: &[u8] = b"pump-create-v2-creator-v1";
const MINT_SEED: &[u8] = b"pump-create-v2-mint-v1";
const MINT_AUTHORITY_SEED: &[u8] = b"mint-authority";
const BONDING_CURVE_SEED: &[u8] = b"bonding-curve";
const EVENT_AUTHORITY_SEED: &[u8] = b"__event_authority";
const MAYHEM_GLOBAL_PARAMS_SEED: &[u8] = b"global-params";
const MAYHEM_SOL_VAULT_SEED: &[u8] = b"sol-vault";
const MAYHEM_STATE_SEED: &[u8] = b"mayhem-state";
const CREATE_V2_DISCRIMINATOR: [u8; 8] = [214, 144, 76, 236, 95, 139, 49, 180];
const INITIALIZE_DISCRIMINATOR: [u8; 8] = [175, 175, 109, 31, 13, 152, 155, 237];
const SET_PARAMS_DISCRIMINATOR: [u8; 8] = [27, 234, 178, 52, 147, 2, 187, 141];
const TOGGLE_CREATE_V2_DISCRIMINATOR: [u8; 8] = [28, 255, 230, 240, 172, 107, 203, 171];
const GLOBAL_DISCRIMINATOR: [u8; 8] = [167, 232, 232, 177, 200, 108, 114, 127];
const BONDING_CURVE_DISCRIMINATOR: [u8; 8] = [23, 183, 248, 55, 96, 216, 172, 96];
const CREATE_EVENT_DISCRIMINATOR: [u8; 8] = [27, 114, 169, 77, 222, 235, 99, 118];
const EVENT_CPI_TAG: [u8; 8] = [228, 69, 165, 46, 81, 203, 154, 29];
// pump-rust-client 0.4.1 uses this configured supply in its Global fixtures.
const PUMP_TOKEN_TOTAL_SUPPLY: u64 = 1_000_000_000_000_000;
const NAME: &str = "Launchpad Lab Token";
const SYMBOL: &str = "LLAB";
const URI: &str = "https://example.invalid/launchpad-lab.json";
const TOKEN_DECIMALS: u8 = 6;
const INITIALIZE_ACCOUNT_LAYOUT: [(&str, bool, bool); 3] = [
    ("global", true, false),
    ("user", true, true),
    ("system_program", false, false),
];
const TOGGLE_CREATE_V2_ACCOUNT_LAYOUT: [(&str, bool, bool); 4] = [
    ("global", true, false),
    ("authority", true, true),
    ("event_authority", false, false),
    ("program", false, false),
];
const TOKEN_2022_ACCOUNT_LAYOUT: [(&str, bool, bool); 16] = [
    ("mint", true, true),
    ("mint_authority", false, false),
    ("bonding_curve", true, false),
    ("associated_bonding_curve", true, false),
    ("global", false, false),
    ("user", true, true),
    ("system_program", false, false),
    ("token_program", false, false),
    ("associated_token_program", false, false),
    ("mayhem_program_id", true, false),
    ("global_params", false, false),
    ("sol_vault", true, false),
    ("mayhem_state", true, false),
    ("mayhem_token_vault", true, false),
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

fn idl_discriminator(idl: &Value, section: &str, name: &str) -> Vec<u8> {
    idl[section]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["name"] == name)
        .unwrap_or_else(|| panic!("pinned IDL has no {section}.{name}"))["discriminator"]
        .as_array()
        .unwrap()
        .iter()
        .map(|byte| byte.as_u64().unwrap() as u8)
        .collect()
}

fn verify_pinned_create_v2_idl(artifact_dir: &Path, expected_idl_sha256: &str) -> (Value, Vec<u8>) {
    let idl_bytes = fs::read(artifact_dir.join("pump.json")).unwrap();
    assert_eq!(sha256(&idl_bytes), expected_idl_sha256);
    let idl: Value = serde_json::from_slice(&idl_bytes).unwrap();
    assert_eq!(idl["address"].as_str(), Some(PUMP_PROGRAM_ID));
    assert_eq!(
        idl_discriminator(&idl, "instructions", "create_v2"),
        CREATE_V2_DISCRIMINATOR
    );
    assert_eq!(
        idl_discriminator(&idl, "accounts", "Global"),
        GLOBAL_DISCRIMINATOR
    );
    assert_eq!(
        idl_discriminator(&idl, "accounts", "BondingCurve"),
        BONDING_CURVE_DISCRIMINATOR
    );
    assert_eq!(
        idl_discriminator(&idl, "instructions", "initialize"),
        INITIALIZE_DISCRIMINATOR
    );
    assert_eq!(
        idl_discriminator(&idl, "instructions", "toggle_create_v2"),
        TOGGLE_CREATE_V2_DISCRIMINATOR
    );

    for (instruction_name, expected_layout) in [
        ("initialize", INITIALIZE_ACCOUNT_LAYOUT.as_slice()),
        (
            "toggle_create_v2",
            TOGGLE_CREATE_V2_ACCOUNT_LAYOUT.as_slice(),
        ),
        ("set_params", TOGGLE_CREATE_V2_ACCOUNT_LAYOUT.as_slice()),
    ] {
        let instruction = idl["instructions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|instruction| instruction["name"] == instruction_name)
            .unwrap();
        let accounts = instruction["accounts"].as_array().unwrap();
        assert_eq!(accounts.len(), expected_layout.len());
        for (account, (expected_name, writable, signer)) in
            accounts.iter().zip(expected_layout.iter().copied())
        {
            assert_eq!(account["name"].as_str(), Some(expected_name));
            assert_eq!(account["writable"].as_bool().unwrap_or(false), writable);
            assert_eq!(account["signer"].as_bool().unwrap_or(false), signer);
        }
    }
    let initialize_accounts = &idl["instructions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|instruction| instruction["name"] == "initialize")
        .unwrap()["accounts"];
    assert_eq!(
        initialize_accounts[2]["address"].as_str(),
        Some("11111111111111111111111111111111")
    );
    let toggle_accounts = &idl["instructions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|instruction| instruction["name"] == "toggle_create_v2")
        .unwrap()["accounts"];
    assert_eq!(toggle_accounts[3]["address"], Value::Null);
    let set_params = idl["instructions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|instruction| instruction["name"] == "set_params")
        .unwrap();
    assert_eq!(
        idl_discriminator(&idl, "instructions", "set_params"),
        SET_PARAMS_DISCRIMINATOR
    );
    let set_params_args = [
        ("initial_virtual_token_reserves", "u64"),
        ("initial_virtual_sol_reserves", "u64"),
        ("initial_real_token_reserves", "u64"),
        ("token_total_supply", "u64"),
        ("fee_basis_points", "u64"),
        ("withdraw_authority", "pubkey"),
        ("enable_migrate", "bool"),
        ("pool_migration_fee", "u64"),
        ("creator_fee_basis_points", "u64"),
        ("set_creator_authority", "pubkey"),
        ("admin_set_creator_authority", "pubkey"),
    ];
    let actual_set_params_args = set_params["args"].as_array().unwrap();
    assert_eq!(actual_set_params_args.len(), set_params_args.len());
    for (actual, (expected_name, expected_type)) in
        actual_set_params_args.iter().zip(set_params_args)
    {
        assert_eq!(actual["name"].as_str(), Some(expected_name));
        assert_eq!(actual["type"].as_str(), Some(expected_type));
    }
    assert_eq!(set_params["accounts"][3]["address"], Value::Null);
    let initialize = idl["instructions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|instruction| instruction["name"] == "initialize")
        .unwrap();
    assert!(initialize["args"].as_array().unwrap().is_empty());
    let toggle = idl["instructions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|instruction| instruction["name"] == "toggle_create_v2")
        .unwrap();
    assert_eq!(toggle["args"].as_array().unwrap().len(), 1);
    assert_eq!(toggle["args"][0]["name"].as_str(), Some("enabled"));
    assert_eq!(toggle["args"][0]["type"].as_str(), Some("bool"));

    let create_v2 = idl["instructions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|instruction| instruction["name"] == "create_v2")
        .unwrap();
    let accounts = create_v2["accounts"].as_array().unwrap();
    assert_eq!(accounts.len(), TOKEN_2022_ACCOUNT_LAYOUT.len());
    for (account, (expected_name, writable, signer)) in
        accounts.iter().zip(TOKEN_2022_ACCOUNT_LAYOUT)
    {
        assert_eq!(account["name"].as_str(), Some(expected_name));
        assert_eq!(account["writable"].as_bool().unwrap_or(false), writable);
        assert_eq!(account["signer"].as_bool().unwrap_or(false), signer);
    }
    let args = create_v2["args"].as_array().unwrap();
    let expected_args = [
        ("name", "string"),
        ("symbol", "string"),
        ("uri", "string"),
        ("creator", "pubkey"),
        ("is_mayhem_mode", "bool"),
    ];
    assert_eq!(args.len(), 8);
    for (index, (name, ty)) in expected_args.iter().enumerate() {
        assert_eq!(args[index]["name"].as_str(), Some(*name));
        assert_eq!(args[index]["type"].as_str(), Some(*ty));
    }
    for (index, name) in [(5, "is_cashback_enabled"), (7, "is_holder_reward")] {
        assert_eq!(args[index]["name"].as_str(), Some(name));
        assert_eq!(
            args[index]["type"]["defined"]["name"].as_str(),
            Some("OptionBool")
        );
    }
    assert_eq!(args[6]["name"].as_str(), Some("creator_fee_bps"));
    assert_eq!(
        args[6]["type"]["defined"]["name"].as_str(),
        Some("OptionU64")
    );
    let option_bool = idl["types"]
        .as_array()
        .unwrap()
        .iter()
        .find(|ty| ty["name"] == "OptionBool")
        .unwrap();
    assert_eq!(option_bool["type"]["fields"][0], "bool");
    let option_u64 = idl["types"]
        .as_array()
        .unwrap()
        .iter()
        .find(|ty| ty["name"] == "OptionU64")
        .unwrap();
    assert_eq!(option_u64["type"]["fields"][0], "u64");

    let expected_addresses = [
        (6, "11111111111111111111111111111111"),
        (7, "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
        (8, "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
        (9, MAYHEM_PROGRAM_ID),
    ];
    for (index, address) in expected_addresses {
        assert_eq!(accounts[index]["address"].as_str(), Some(address));
    }
    let event_discriminator = idl_discriminator(&idl, "events", "CreateEvent");
    assert_eq!(event_discriminator, CREATE_EVENT_DISCRIMINATOR);
    (idl, event_discriminator)
}

fn write_borsh_string(output: &mut Vec<u8>, value: &str) {
    let bytes = value.as_bytes();
    output.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    output.extend_from_slice(bytes);
}

fn create_v2_instruction_data(creator: &Pubkey) -> Vec<u8> {
    let mut data = CREATE_V2_DISCRIMINATOR.to_vec();
    write_borsh_string(&mut data, NAME);
    write_borsh_string(&mut data, SYMBOL);
    write_borsh_string(&mut data, URI);
    data.extend_from_slice(creator.as_ref());
    data.push(0); // is_mayhem_mode
    data.push(0); // OptionBool(is_cashback_enabled)
    data.extend_from_slice(&0u64.to_le_bytes()); // OptionU64(creator_fee_bps)
    data.push(0); // OptionBool(is_holder_reward)
    data
}

fn pump_initialize_instruction(pump_id: Pubkey, global: Pubkey, payer: Pubkey) -> Instruction {
    Instruction {
        program_id: pump_id,
        accounts: vec![
            AccountMeta::new(global, false),
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(solana_sdk_ids::system_program::id(), false),
        ],
        data: INITIALIZE_DISCRIMINATOR.to_vec(),
    }
}

fn pump_toggle_create_v2_instruction(
    pump_id: Pubkey,
    global: Pubkey,
    authority: Pubkey,
) -> Instruction {
    let event_authority = Pubkey::find_program_address(&[EVENT_AUTHORITY_SEED], &pump_id).0;
    let mut data = TOGGLE_CREATE_V2_DISCRIMINATOR.to_vec();
    data.push(1); // enabled
    Instruction {
        program_id: pump_id,
        accounts: vec![
            AccountMeta::new(global, false),
            AccountMeta::new(authority, true),
            AccountMeta::new_readonly(event_authority, false),
            AccountMeta::new_readonly(pump_id, false),
        ],
        data,
    }
}

fn pump_set_params_instruction(
    pump_id: Pubkey,
    global: Pubkey,
    authority: Pubkey,
    current: &PumpGlobalSnapshot,
) -> Instruction {
    let event_authority = Pubkey::find_program_address(&[EVENT_AUTHORITY_SEED], &pump_id).0;
    let mut data = SET_PARAMS_DISCRIMINATOR.to_vec();
    data.extend_from_slice(&current.initial_virtual_token_reserves.to_le_bytes());
    data.extend_from_slice(&current.initial_virtual_sol_reserves.to_le_bytes());
    data.extend_from_slice(&current.initial_real_token_reserves.to_le_bytes());
    data.extend_from_slice(&PUMP_TOKEN_TOTAL_SUPPLY.to_le_bytes());
    data.extend_from_slice(&current.fee_basis_points.to_le_bytes());
    data.extend_from_slice(current.withdraw_authority.as_ref());
    data.push(u8::from(current.enable_migrate));
    data.extend_from_slice(&current.pool_migration_fee.to_le_bytes());
    data.extend_from_slice(&current.creator_fee_basis_points.to_le_bytes());
    data.extend_from_slice(current.set_creator_authority.as_ref());
    data.extend_from_slice(current.admin_set_creator_authority.as_ref());

    Instruction {
        program_id: pump_id,
        accounts: vec![
            AccountMeta::new(global, false),
            AccountMeta::new(authority, true),
            AccountMeta::new_readonly(event_authority, false),
            AccountMeta::new_readonly(pump_id, false),
        ],
        data,
    }
}

/// Fixed test-only CPI adapter. It accepts no caller-provided data and signs
/// only for the deterministic creator/payer and mint PDAs below.
fn process_create_v2_probe<'a>(
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
    if accounts.len() != TOKEN_2022_ACCOUNT_LAYOUT.len() {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let mint = &accounts[0];
    let mint_authority = &accounts[1];
    let bonding_curve = &accounts[2];
    let associated_bonding_curve = &accounts[3];
    let global = &accounts[4];
    let user = &accounts[5];
    let system_program = &accounts[6];
    let token_program = &accounts[7];
    let associated_token_program = &accounts[8];
    let mayhem_program = &accounts[9];
    let global_params = &accounts[10];
    let sol_vault = &accounts[11];
    let mayhem_state = &accounts[12];
    let mayhem_token_vault = &accounts[13];
    let event_authority = &accounts[14];
    let pump_program = &accounts[15];

    let pump_id = Pubkey::from_str(PUMP_PROGRAM_ID).expect("fixed Pump ID");
    let mayhem_id = Pubkey::from_str(MAYHEM_PROGRAM_ID).expect("fixed Mayhem ID");
    let system_id = solana_sdk_ids::system_program::id();
    let token_2022_id = spl_token_2022::id();
    let associated_token_id = spl_associated_token_account::id();
    let creator = Pubkey::find_program_address(&[CREATOR_SEED], program_id).0;
    let (mint_pda, _) = Pubkey::find_program_address(&[MINT_SEED], program_id);
    let expected_mint_authority = Pubkey::find_program_address(&[MINT_AUTHORITY_SEED], &pump_id).0;
    let expected_curve =
        Pubkey::find_program_address(&[BONDING_CURVE_SEED, mint_pda.as_ref()], &pump_id).0;
    let expected_curve_ata = Pubkey::find_program_address(
        &[
            expected_curve.as_ref(),
            token_2022_id.as_ref(),
            mint_pda.as_ref(),
        ],
        &associated_token_id,
    )
    .0;
    let expected_global = Pubkey::find_program_address(&[b"global"], &pump_id).0;
    let expected_global_params =
        Pubkey::find_program_address(&[MAYHEM_GLOBAL_PARAMS_SEED], &mayhem_id).0;
    let expected_sol_vault = Pubkey::find_program_address(&[MAYHEM_SOL_VAULT_SEED], &mayhem_id).0;
    let expected_mayhem_state =
        Pubkey::find_program_address(&[MAYHEM_STATE_SEED, mint_pda.as_ref()], &mayhem_id).0;
    let expected_mayhem_token_vault = Pubkey::find_program_address(
        &[
            expected_sol_vault.as_ref(),
            token_2022_id.as_ref(),
            mint_pda.as_ref(),
        ],
        &associated_token_id,
    )
    .0;
    let expected_event_authority =
        Pubkey::find_program_address(&[EVENT_AUTHORITY_SEED], &pump_id).0;
    let bpf_loader_id = solana_sdk_ids::bpf_loader::id();

    if mint.key != &mint_pda
        || mint.is_signer
        || !mint.is_writable
        || mint.owner != &system_id
        || !mint.data_is_empty()
        || mint.lamports() != 0
        || mint_authority.key != &expected_mint_authority
        || mint_authority.is_writable
        || bonding_curve.key != &expected_curve
        || !bonding_curve.is_writable
        || associated_bonding_curve.key != &expected_curve_ata
        || !associated_bonding_curve.is_writable
        || global.key != &expected_global
        || global.is_writable
        || global.owner != &pump_id
        || global.data_is_empty()
        || user.key != &creator
        || user.is_signer
        || !user.is_writable
        || user.owner != &system_id
        || !user.data_is_empty()
        || user.lamports() == 0
        || system_program.key != &system_id
        || system_program.is_writable
        || !token_program.executable
        || token_program.key != &token_2022_id
        || token_program.is_writable
        || !associated_token_program.executable
        || associated_token_program.key != &associated_token_id
        || associated_token_program.is_writable
        || mayhem_program.key != &mayhem_id
        || !mayhem_program.is_writable
        || !mayhem_program.executable
        || mayhem_program.owner != &bpf_loader_id
        || global_params.key != &expected_global_params
        || global_params.is_writable
        || sol_vault.key != &expected_sol_vault
        || !sol_vault.is_writable
        || mayhem_state.key != &expected_mayhem_state
        || !mayhem_state.is_writable
        || mayhem_token_vault.key != &expected_mayhem_token_vault
        || !mayhem_token_vault.is_writable
        || event_authority.key != &expected_event_authority
        || event_authority.is_writable
        || pump_program.key != &pump_id
        || pump_program.is_writable
        || !pump_program.executable
        || pump_program.owner != &bpf_loader_id
    {
        return Err(ProgramError::InvalidAccountData);
    }

    let instruction = Instruction {
        program_id: pump_id,
        accounts: vec![
            AccountMeta::new(mint_pda, true),
            AccountMeta::new_readonly(expected_mint_authority, false),
            AccountMeta::new(expected_curve, false),
            AccountMeta::new(expected_curve_ata, false),
            AccountMeta::new_readonly(expected_global, false),
            AccountMeta::new(creator, true),
            AccountMeta::new_readonly(system_id, false),
            AccountMeta::new_readonly(token_2022_id, false),
            AccountMeta::new_readonly(associated_token_id, false),
            AccountMeta::new(mayhem_id, false),
            AccountMeta::new_readonly(expected_global_params, false),
            AccountMeta::new(expected_sol_vault, false),
            AccountMeta::new(expected_mayhem_state, false),
            AccountMeta::new(expected_mayhem_token_vault, false),
            AccountMeta::new_readonly(expected_event_authority, false),
            AccountMeta::new_readonly(pump_id, false),
        ],
        data: create_v2_instruction_data(&creator),
    };
    let cpi_accounts = [
        mint.clone(),
        mint_authority.clone(),
        bonding_curve.clone(),
        associated_bonding_curve.clone(),
        global.clone(),
        user.clone(),
        system_program.clone(),
        token_program.clone(),
        associated_token_program.clone(),
        mayhem_program.clone(),
        global_params.clone(),
        sol_vault.clone(),
        mayhem_state.clone(),
        mayhem_token_vault.clone(),
        event_authority.clone(),
        pump_program.clone(),
    ];

    let (_, creator_bump) = Pubkey::find_program_address(&[CREATOR_SEED], program_id);
    let (_, mint_bump) = Pubkey::find_program_address(&[MINT_SEED], program_id);
    let creator_bump_seed = [creator_bump];
    let mint_bump_seed = [mint_bump];
    let creator_signer_seeds: &[&[u8]] = &[CREATOR_SEED, &creator_bump_seed];
    let mint_signer_seeds: &[&[u8]] = &[MINT_SEED, &mint_bump_seed];
    let signer_seeds: &[&[&[u8]]] = &[creator_signer_seeds, mint_signer_seeds];

    msg!(
        "PUMP_CREATE_V2_DIAG pump={} mint_pda={} creator_pda={} global={} token_program={} mayhem_mode=false",
        pump_id,
        mint_pda,
        creator,
        expected_global,
        token_2022_id
    );
    invoke_signed(&instruction, &cpi_accounts, signer_seeds)
}

fn read_slice<'a>(data: &'a [u8], offset: &mut usize, len: usize) -> Option<&'a [u8]> {
    let end = offset.checked_add(len)?;
    let result = data.get(*offset..end)?;
    *offset = end;
    Some(result)
}

fn read_u32(data: &[u8], offset: &mut usize) -> Option<u32> {
    Some(u32::from_le_bytes(
        read_slice(data, offset, 4)?.try_into().ok()?,
    ))
}

fn read_u64(data: &[u8], offset: &mut usize) -> Option<u64> {
    Some(u64::from_le_bytes(
        read_slice(data, offset, 8)?.try_into().ok()?,
    ))
}

fn read_bool(data: &[u8], offset: &mut usize) -> Option<bool> {
    match *read_slice(data, offset, 1)?.first()? {
        0 => Some(false),
        1 => Some(true),
        _ => None,
    }
}

fn read_pubkey(data: &[u8], offset: &mut usize) -> Option<Pubkey> {
    Some(Pubkey::new_from_array(
        read_slice(data, offset, 32)?.try_into().ok()?,
    ))
}

fn idl_type_size(type_definition: &Value) -> usize {
    if let Some(primitive) = type_definition.as_str() {
        return match primitive {
            "bool" | "u8" => 1,
            "u64" => 8,
            "pubkey" => 32,
            other => panic!("unsupported Global field type in pinned IDL: {other}"),
        };
    }

    let array = type_definition["array"]
        .as_array()
        .expect("supported fixed-size Global IDL field type");
    assert_eq!(array.len(), 2);
    idl_type_size(&array[0])
        .checked_mul(array[1].as_u64().expect("IDL array length") as usize)
        .expect("IDL field size does not overflow")
}

fn idl_field_offset(idl: &Value, type_name: &str, field_name: &str) -> usize {
    let structure = idl["types"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["name"] == type_name)
        .unwrap_or_else(|| panic!("pinned IDL has no type {type_name}"));
    let mut offset = 8; // Anchor account discriminator
    for field in structure["type"]["fields"].as_array().unwrap() {
        if field["name"] == field_name {
            return offset;
        }
        offset = offset
            .checked_add(idl_type_size(&field["type"]))
            .expect("IDL account offset does not overflow");
    }
    panic!("pinned IDL has no {type_name}.{field_name}");
}

fn read_global_bool(idl: &Value, data: &[u8], field_name: &str) -> bool {
    let mut offset = idl_field_offset(idl, "Global", field_name);
    read_bool(data, &mut offset).unwrap_or_else(|| panic!("cannot decode Pump Global.{field_name}"))
}

fn read_global_u64(idl: &Value, data: &[u8], field_name: &str) -> u64 {
    let mut offset = idl_field_offset(idl, "Global", field_name);
    read_u64(data, &mut offset).unwrap_or_else(|| panic!("cannot decode Pump Global.{field_name}"))
}

fn read_global_pubkey(idl: &Value, data: &[u8], field_name: &str) -> Pubkey {
    let mut offset = idl_field_offset(idl, "Global", field_name);
    read_pubkey(data, &mut offset)
        .unwrap_or_else(|| panic!("cannot decode Pump Global.{field_name}"))
}

#[derive(Debug)]
struct PumpGlobalSnapshot {
    initialized: bool,
    authority: Pubkey,
    initial_virtual_token_reserves: u64,
    initial_virtual_sol_reserves: u64,
    initial_real_token_reserves: u64,
    token_total_supply: u64,
    fee_basis_points: u64,
    withdraw_authority: Pubkey,
    enable_migrate: bool,
    pool_migration_fee: u64,
    creator_fee_basis_points: u64,
    set_creator_authority: Pubkey,
    admin_set_creator_authority: Pubkey,
    mayhem_mode_enabled: bool,
    create_v2_enabled: bool,
}

fn read_pump_global(idl: &Value, data: &[u8]) -> PumpGlobalSnapshot {
    assert_eq!(data.get(..8), Some(GLOBAL_DISCRIMINATOR.as_slice()));
    let fields = idl["types"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["name"] == "Global")
        .unwrap()["type"]["fields"]
        .as_array()
        .unwrap();
    let expected_len = fields.iter().fold(8usize, |len, field| {
        len.checked_add(idl_type_size(&field["type"]))
            .expect("Pump Global IDL size does not overflow")
    });
    assert_eq!(
        data.len(),
        expected_len,
        "Pump Global must match pinned IDL size"
    );
    PumpGlobalSnapshot {
        initialized: read_global_bool(idl, data, "initialized"),
        authority: read_global_pubkey(idl, data, "authority"),
        initial_virtual_token_reserves: read_global_u64(
            idl,
            data,
            "initial_virtual_token_reserves",
        ),
        initial_virtual_sol_reserves: read_global_u64(idl, data, "initial_virtual_sol_reserves"),
        initial_real_token_reserves: read_global_u64(idl, data, "initial_real_token_reserves"),
        token_total_supply: read_global_u64(idl, data, "token_total_supply"),
        fee_basis_points: read_global_u64(idl, data, "fee_basis_points"),
        withdraw_authority: read_global_pubkey(idl, data, "withdraw_authority"),
        enable_migrate: read_global_bool(idl, data, "enable_migrate"),
        pool_migration_fee: read_global_u64(idl, data, "pool_migration_fee"),
        creator_fee_basis_points: read_global_u64(idl, data, "creator_fee_basis_points"),
        set_creator_authority: read_global_pubkey(idl, data, "set_creator_authority"),
        admin_set_creator_authority: read_global_pubkey(idl, data, "admin_set_creator_authority"),
        mayhem_mode_enabled: read_global_bool(idl, data, "mayhem_mode_enabled"),
        create_v2_enabled: read_global_bool(idl, data, "create_v2_enabled"),
    }
}

fn read_borsh_string(data: &[u8], offset: &mut usize) -> Option<String> {
    let len = read_u32(data, offset)? as usize;
    Some(String::from_utf8(read_slice(data, offset, len)?.to_vec()).ok()?)
}

#[derive(Debug)]
struct CreateEventSummary {
    name: String,
    symbol: String,
    uri: String,
    mint: Pubkey,
    bonding_curve: Pubkey,
    user: Pubkey,
    creator: Pubkey,
}

fn parse_create_event(data: &[u8], discriminator: &[u8]) -> Option<CreateEventSummary> {
    let event_data = data.strip_prefix(&EVENT_CPI_TAG)?;
    if event_data.get(..8)? != discriminator {
        return None;
    }
    let mut offset = 8;
    let event = CreateEventSummary {
        name: read_borsh_string(event_data, &mut offset)?,
        symbol: read_borsh_string(event_data, &mut offset)?,
        uri: read_borsh_string(event_data, &mut offset)?,
        mint: read_pubkey(event_data, &mut offset)?,
        bonding_curve: read_pubkey(event_data, &mut offset)?,
        user: read_pubkey(event_data, &mut offset)?,
        creator: read_pubkey(event_data, &mut offset)?,
    };

    // Validate the remaining CreateEvent fields in the pinned IDL order.
    let _timestamp = read_slice(event_data, &mut offset, 8)?;
    let _virtual_token_reserves = read_u64(event_data, &mut offset)?;
    let _virtual_sol_reserves = read_u64(event_data, &mut offset)?;
    let _real_token_reserves = read_u64(event_data, &mut offset)?;
    let _token_total_supply = read_u64(event_data, &mut offset)?;
    let _token_program = read_pubkey(event_data, &mut offset)?;
    let _is_mayhem_mode = read_bool(event_data, &mut offset)?;
    let _is_cashback_enabled = read_bool(event_data, &mut offset)?;
    let _quote_mint = read_pubkey(event_data, &mut offset)?;
    let _virtual_quote_reserves = read_u64(event_data, &mut offset)?;
    let _creator_fee_bps = read_u64(event_data, &mut offset)?;
    let _is_holder_reward = read_bool(event_data, &mut offset)?;
    let _depth = read_slice(event_data, &mut offset, 1)?;
    if offset != event_data.len() {
        return None;
    }

    Some(event)
}

#[tokio::test]
async fn real_pump_sbf_create_v2_records_the_probe_creator_pda() {
    let lab = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    assert_is_isolated_ci_runtime(&lab);

    let config: Value =
        serde_json::from_slice(&fs::read(lab.join("fixtures/manifest.json")).unwrap()).unwrap();
    let pump_program = &config["programs"][0];
    let mayhem_program = &config["support_programs"][0];
    let pump_id = Pubkey::from_str(pump_program["program_id"].as_str().unwrap()).unwrap();
    let mayhem_id = Pubkey::from_str(mayhem_program["program_id"].as_str().unwrap()).unwrap();
    assert_eq!(pump_id, Pubkey::from_str(PUMP_PROGRAM_ID).unwrap());
    assert_eq!(mayhem_id, Pubkey::from_str(MAYHEM_PROGRAM_ID).unwrap());

    let artifact_dir =
        PathBuf::from(env::var("PUMP_LAB_CACHE_DIR").expect("prepared external cache"));
    let artifact_dir = fs::canonicalize(artifact_dir).expect("artifact directory exists");
    let root = fs::canonicalize(lab.join("../..")).unwrap();
    assert!(!artifact_dir.starts_with(&root), "No .so files in the repo");
    let pump_bytes = fs::read(artifact_dir.join("pump.so")).expect("verified real pump.so");
    assert_eq!(
        sha256(&pump_bytes),
        pump_program["sha256"].as_str().unwrap()
    );
    assert_eq!(
        pump_bytes.len() as u64,
        pump_program["size_bytes"].as_u64().unwrap()
    );
    assert_eq!(&pump_bytes[..4], b"\x7fELF");
    let mayhem_bytes =
        fs::read(artifact_dir.join("mayhem_program.so")).expect("verified Mayhem support SBF");
    assert_eq!(
        sha256(&mayhem_bytes),
        mayhem_program["sha256"].as_str().unwrap()
    );
    assert_eq!(
        mayhem_bytes.len() as u64,
        mayhem_program["size_bytes"].as_u64().unwrap()
    );
    assert_eq!(&mayhem_bytes[..4], b"\x7fELF");
    let (idl, create_event_discriminator) =
        verify_pinned_create_v2_idl(&artifact_dir, pump_program["idl_sha256"].as_str().unwrap());

    let evidence_dir =
        PathBuf::from(env::var("PUMP_LAB_EVIDENCE_DIR").expect("external evidence directory"));
    fs::create_dir_all(&evidence_dir).unwrap();
    let evidence_dir = fs::canonicalize(evidence_dir).unwrap();
    assert!(
        !evidence_dir.starts_with(&root),
        "Evidence stays outside the repo"
    );
    let evidence_file = evidence_dir.join("pump-create-v2.json");
    let probe_id = probe_program_id();
    let (creator_pda, _) = Pubkey::find_program_address(&[CREATOR_SEED], &probe_id);
    let (mint_pda, _) = Pubkey::find_program_address(&[MINT_SEED], &probe_id);
    let mint_authority = Pubkey::find_program_address(&[MINT_AUTHORITY_SEED], &pump_id).0;
    let bonding_curve =
        Pubkey::find_program_address(&[BONDING_CURVE_SEED, mint_pda.as_ref()], &pump_id).0;
    let token_program_id = spl_token_2022::id();
    let associated_token_program_id = spl_associated_token_account::id();
    let associated_bonding_curve = Pubkey::find_program_address(
        &[
            bonding_curve.as_ref(),
            token_program_id.as_ref(),
            mint_pda.as_ref(),
        ],
        &associated_token_program_id,
    )
    .0;
    let global = Pubkey::find_program_address(&[b"global"], &pump_id).0;
    let global_params = Pubkey::find_program_address(&[MAYHEM_GLOBAL_PARAMS_SEED], &mayhem_id).0;
    let sol_vault = Pubkey::find_program_address(&[MAYHEM_SOL_VAULT_SEED], &mayhem_id).0;
    let mayhem_state =
        Pubkey::find_program_address(&[MAYHEM_STATE_SEED, mint_pda.as_ref()], &mayhem_id).0;
    let mayhem_token_vault = Pubkey::find_program_address(
        &[
            sol_vault.as_ref(),
            token_program_id.as_ref(),
            mint_pda.as_ref(),
        ],
        &associated_token_program_id,
    )
    .0;
    let event_authority = Pubkey::find_program_address(&[EVENT_AUTHORITY_SEED], &pump_id).0;
    let mut evidence = json!({
        "stage": "before_bank_start",
        "instruction": "create_v2",
        "pump_program_id": pump_id.to_string(),
        "pump_artifact_sha256": sha256(&pump_bytes),
        "mayhem_program_id": mayhem_id.to_string(),
        "mayhem_artifact_sha256": sha256(&mayhem_bytes),
        "probe_program_id": probe_id.to_string(),
        "probe_kind": "fixed test-only native CPI processor",
        "creator_pda": creator_pda.to_string(),
        "mint_pda": mint_pda.to_string(),
        "mint_authority_pda": mint_authority.to_string(),
        "bonding_curve_pda": bonding_curve.to_string(),
        "associated_bonding_curve": associated_bonding_curve.to_string(),
        "global_pda": global.to_string(),
        "mayhem_mode": false,
        "global_config": "created by the pinned Pump SBF initialize instruction; supply configured by set_params; create_v2 enabled by toggle_create_v2",
        "token_program": token_program_id.to_string(),
        "associated_token_program": associated_token_program_id.to_string(),
        "synthetic_payer_lamports": 20_000_000_000u64,
        "name": NAME,
        "symbol": SYMBOL,
        "uri": URI,
        "expected_decimals": TOKEN_DECIMALS,
        "transaction_compute_unit_limit": 400_000,
        "pump_initialize_tested": false,
        "pump_set_params_tested": false,
        "toggle_create_v2_tested": false,
        "cpi_tested": false,
        "token_creation_tested": false,
        "buy_tested": false,
        "creator_fees_tested": false,
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
    test.prefer_bpf(false);
    test.add_program(
        "pump-create-v2-probe",
        probe_id,
        processor!(process_create_v2_probe),
    );
    test.add_program(
        "spl_token_2022",
        token_program_id,
        processor!(spl_token_2022::processor::Processor::process),
    );
    test.add_program(
        "spl_associated_token_account",
        associated_token_program_id,
        processor!(spl_associated_token_account::processor::process_instruction),
    );
    test.prefer_bpf(true);
    test.add_program("pump", pump_id, None);
    test.add_program("mayhem_program", mayhem_id, None);

    test.add_account(
        creator_pda,
        Account {
            lamports: 20_000_000_000,
            data: vec![],
            owner: solana_sdk_ids::system_program::id(),
            executable: false,
            rent_epoch: 0,
        },
    );

    let context = test.start_with_context().await;
    let runtime_rent = context
        .banks_client
        .get_rent()
        .await
        .expect("ProgramTest runtime Rent sysvar must be available");
    let loaded_pump = context
        .banks_client
        .get_account(pump_id)
        .await
        .unwrap()
        .expect("the pinned Pump SBF program must be loaded");
    assert!(loaded_pump.executable);
    assert_eq!(loaded_pump.owner, solana_sdk_ids::bpf_loader::id());
    assert_eq!(
        sha256(&loaded_pump.data),
        pump_program["sha256"].as_str().unwrap()
    );
    let loaded_mayhem = context
        .banks_client
        .get_account(mayhem_id)
        .await
        .unwrap()
        .expect("the pinned Mayhem support SBF program must be loaded");
    assert!(loaded_mayhem.executable);
    assert_eq!(loaded_mayhem.owner, solana_sdk_ids::bpf_loader::id());
    assert_eq!(
        sha256(&loaded_mayhem.data),
        mayhem_program["sha256"].as_str().unwrap()
    );

    evidence["stage"] = json!("real_pump_sbf_loaded");
    evidence["runtime_rent"] = json!(format!("{runtime_rent:?}"));
    fs::write(
        &evidence_file,
        serde_json::to_vec_pretty(&evidence).unwrap(),
    )
    .unwrap();

    let initialize_transaction = Transaction::new_signed_with_payer(
        &[pump_initialize_instruction(
            pump_id,
            global,
            context.payer.pubkey(),
        )],
        Some(&context.payer.pubkey()),
        &[&context.payer],
        context.last_blockhash,
    );
    let initialize_outcome = context
        .banks_client
        .process_transaction_with_metadata(initialize_transaction)
        .await
        .expect("BanksClient must return the actual Pump initialize result");
    evidence["pump_initialize_result"] = json!(format!("{:?}", initialize_outcome.result));
    if let Some(metadata) = &initialize_outcome.metadata {
        evidence["pump_initialize_logs"] = json!(metadata.log_messages);
    }
    evidence["stage"] = json!("pump_initialize_observed");
    fs::write(
        &evidence_file,
        serde_json::to_vec_pretty(&evidence).unwrap(),
    )
    .unwrap();
    assert!(
        initialize_outcome.result.is_ok(),
        "The actual Pump initialize instruction must create Global: {:?}",
        initialize_outcome.result
    );
    evidence["pump_initialize_tested"] = json!(true);

    let initialized_global = context
        .banks_client
        .get_account(global)
        .await
        .unwrap()
        .expect("the real Pump initialize instruction must create Global");
    assert_eq!(initialized_global.owner, pump_id);
    assert!(!initialized_global.executable);
    assert!(runtime_rent.is_exempt(initialized_global.lamports, initialized_global.data.len()));
    let initial_global_state = read_pump_global(&idl, &initialized_global.data);
    assert!(initial_global_state.initialized);
    assert_eq!(initial_global_state.authority, context.payer.pubkey());
    assert_eq!(
        initial_global_state.token_total_supply, 0,
        "the pinned Pump initialize instruction leaves token_total_supply unset; configure it with set_params"
    );
    assert!(initial_global_state.initial_virtual_token_reserves > 0);
    assert!(initial_global_state.initial_virtual_sol_reserves > 0);
    assert!(initial_global_state.initial_real_token_reserves > 0);
    evidence["global_initialized_by_pump_sbf"] = json!({
        "authority": initial_global_state.authority.to_string(),
        "initial_virtual_token_reserves": initial_global_state.initial_virtual_token_reserves,
        "initial_virtual_sol_reserves": initial_global_state.initial_virtual_sol_reserves,
        "initial_real_token_reserves": initial_global_state.initial_real_token_reserves,
        "token_total_supply": initial_global_state.token_total_supply,
        "creator_fee_basis_points": initial_global_state.creator_fee_basis_points,
        "create_v2_enabled_before_toggle": initial_global_state.create_v2_enabled
    });
    fs::write(
        &evidence_file,
        serde_json::to_vec_pretty(&evidence).unwrap(),
    )
    .unwrap();

    let set_params_transaction = Transaction::new_signed_with_payer(
        &[pump_set_params_instruction(
            pump_id,
            global,
            context.payer.pubkey(),
            &initial_global_state,
        )],
        Some(&context.payer.pubkey()),
        &[&context.payer],
        context.last_blockhash,
    );
    let set_params_outcome = context
        .banks_client
        .process_transaction_with_metadata(set_params_transaction)
        .await
        .expect("BanksClient must return the actual Pump set_params result");
    evidence["pump_set_params_result"] = json!(format!("{:?}", set_params_outcome.result));
    if let Some(metadata) = &set_params_outcome.metadata {
        evidence["pump_set_params_logs"] = json!(metadata.log_messages);
    }
    evidence["stage"] = json!("pump_set_params_observed");
    fs::write(
        &evidence_file,
        serde_json::to_vec_pretty(&evidence).unwrap(),
    )
    .unwrap();
    assert!(
        set_params_outcome.result.is_ok(),
        "The actual Pump set_params instruction must configure Global: {:?}",
        set_params_outcome.result
    );
    evidence["pump_set_params_tested"] = json!(true);

    let configured_global = context
        .banks_client
        .get_account(global)
        .await
        .unwrap()
        .expect("the Pump set_params instruction must preserve Global");
    assert_eq!(configured_global.owner, pump_id);
    assert!(runtime_rent.is_exempt(configured_global.lamports, configured_global.data.len()));
    let configured_global_state = read_pump_global(&idl, &configured_global.data);
    assert!(configured_global_state.initialized);
    assert_eq!(configured_global_state.authority, context.payer.pubkey());
    assert_eq!(
        configured_global_state.token_total_supply,
        PUMP_TOKEN_TOTAL_SUPPLY
    );
    assert_eq!(
        configured_global_state.initial_virtual_token_reserves,
        initial_global_state.initial_virtual_token_reserves
    );
    assert_eq!(
        configured_global_state.initial_virtual_sol_reserves,
        initial_global_state.initial_virtual_sol_reserves
    );
    assert_eq!(
        configured_global_state.initial_real_token_reserves,
        initial_global_state.initial_real_token_reserves
    );
    assert_eq!(
        configured_global_state.fee_basis_points,
        initial_global_state.fee_basis_points
    );
    assert_eq!(
        configured_global_state.withdraw_authority,
        initial_global_state.withdraw_authority
    );
    assert_eq!(
        configured_global_state.enable_migrate,
        initial_global_state.enable_migrate
    );
    assert_eq!(
        configured_global_state.pool_migration_fee,
        initial_global_state.pool_migration_fee
    );
    assert_eq!(
        configured_global_state.creator_fee_basis_points,
        initial_global_state.creator_fee_basis_points
    );
    assert_eq!(
        configured_global_state.set_creator_authority,
        initial_global_state.set_creator_authority
    );
    assert_eq!(
        configured_global_state.admin_set_creator_authority,
        initial_global_state.admin_set_creator_authority
    );
    evidence["global_params_set_by_pump_sbf"] = json!({
        "source": "actual pinned Pump SBF set_params instruction",
        "token_total_supply_before": initial_global_state.token_total_supply,
        "token_total_supply_after": configured_global_state.token_total_supply,
        "initial_virtual_token_reserves": configured_global_state.initial_virtual_token_reserves,
        "initial_virtual_sol_reserves": configured_global_state.initial_virtual_sol_reserves,
        "initial_real_token_reserves": configured_global_state.initial_real_token_reserves,
        "creator_fee_basis_points": configured_global_state.creator_fee_basis_points
    });
    fs::write(
        &evidence_file,
        serde_json::to_vec_pretty(&evidence).unwrap(),
    )
    .unwrap();

    let toggle_transaction = Transaction::new_signed_with_payer(
        &[pump_toggle_create_v2_instruction(
            pump_id,
            global,
            context.payer.pubkey(),
        )],
        Some(&context.payer.pubkey()),
        &[&context.payer],
        context.last_blockhash,
    );
    let toggle_outcome = context
        .banks_client
        .process_transaction_with_metadata(toggle_transaction)
        .await
        .expect("BanksClient must return the actual Pump toggle result");
    evidence["toggle_create_v2_result"] = json!(format!("{:?}", toggle_outcome.result));
    if let Some(metadata) = &toggle_outcome.metadata {
        evidence["toggle_create_v2_logs"] = json!(metadata.log_messages);
    }
    evidence["stage"] = json!("toggle_create_v2_observed");
    fs::write(
        &evidence_file,
        serde_json::to_vec_pretty(&evidence).unwrap(),
    )
    .unwrap();
    assert!(
        toggle_outcome.result.is_ok(),
        "The actual Pump toggle_create_v2 instruction must enable create_v2: {:?}",
        toggle_outcome.result
    );
    evidence["toggle_create_v2_tested"] = json!(true);
    let runtime_global = context
        .banks_client
        .get_account(global)
        .await
        .unwrap()
        .expect("the initialized Pump Global account must remain present");
    assert_eq!(runtime_global.owner, pump_id);
    assert!(runtime_rent.is_exempt(runtime_global.lamports, runtime_global.data.len()));
    let global_state = read_pump_global(&idl, &runtime_global.data);
    assert!(global_state.initialized);
    assert_eq!(global_state.authority, context.payer.pubkey());
    assert!(!global_state.mayhem_mode_enabled);
    assert!(global_state.create_v2_enabled);
    assert!(global_state.token_total_supply > 0);
    assert!(global_state.initial_virtual_token_reserves > 0);
    assert!(global_state.initial_virtual_sol_reserves > 0);
    assert!(global_state.initial_real_token_reserves > 0);
    evidence["global_config"] = json!({
        "source": "actual pinned Pump SBF initialize + set_params + toggle_create_v2 instructions",
        "account_owner": runtime_global.owner.to_string(),
        "data_len": runtime_global.data.len(),
        "create_v2_enabled": global_state.create_v2_enabled,
        "initial_virtual_token_reserves": global_state.initial_virtual_token_reserves,
        "initial_virtual_sol_reserves": global_state.initial_virtual_sol_reserves,
        "initial_real_token_reserves": global_state.initial_real_token_reserves,
        "token_total_supply": global_state.token_total_supply,
        "creator_fee_basis_points": global_state.creator_fee_basis_points,
        "mayhem_mode_enabled": global_state.mayhem_mode_enabled
    });
    evidence["expected_supply"] = json!(global_state.token_total_supply);
    evidence["stage"] = json!("pump_initialized_and_create_v2_enabled");
    fs::write(
        &evidence_file,
        serde_json::to_vec_pretty(&evidence).unwrap(),
    )
    .unwrap();

    let system_program_id = solana_sdk_ids::system_program::id();
    let probe_instruction = Instruction {
        program_id: probe_id,
        accounts: vec![
            AccountMeta::new(mint_pda, false),
            AccountMeta::new_readonly(mint_authority, false),
            AccountMeta::new(bonding_curve, false),
            AccountMeta::new(associated_bonding_curve, false),
            AccountMeta::new_readonly(global, false),
            AccountMeta::new(creator_pda, false),
            AccountMeta::new_readonly(system_program_id, false),
            AccountMeta::new_readonly(token_program_id, false),
            AccountMeta::new_readonly(associated_token_program_id, false),
            AccountMeta::new(mayhem_id, false),
            AccountMeta::new_readonly(global_params, false),
            AccountMeta::new(sol_vault, false),
            AccountMeta::new(mayhem_state, false),
            AccountMeta::new(mayhem_token_vault, false),
            AccountMeta::new_readonly(event_authority, false),
            AccountMeta::new_readonly(pump_id, false),
        ],
        data: vec![],
    };
    let transaction = Transaction::new_signed_with_payer(
        &[
            ComputeBudgetInstruction::set_compute_unit_limit(400_000),
            probe_instruction,
        ],
        Some(&context.payer.pubkey()),
        &[&context.payer],
        context.last_blockhash,
    );
    let simulation = context
        .banks_client
        .simulate_transaction(transaction.clone())
        .await
        .expect("BanksClient must return the Pump event-CPI simulation");
    let simulation_result = simulation
        .result
        .expect("ProgramTest simulation must return a transaction result");
    assert!(
        simulation_result.is_ok(),
        "The actual Pump create_v2 simulation must succeed: {:?}",
        simulation_result
    );
    let simulation_details = simulation
        .simulation_details
        .expect("ProgramTest simulation details are mandatory");
    let inner_instructions = simulation_details
        .inner_instructions
        .as_ref()
        .expect("Agave ProgramTest simulation must record CPI inner instructions");
    let event = inner_instructions
        .iter()
        .flatten()
        .filter_map(|inner| {
            let instruction = &inner.instruction;
            let invoked_program = transaction
                .message
                .account_keys
                .get(instruction.program_id_index as usize)?;
            if invoked_program != &pump_id {
                return None;
            }
            parse_create_event(&instruction.data, &create_event_discriminator)
        })
        .next()
        .expect("the actual Pump SBF create_v2 CPI must emit a CreateEvent event-CPI");

    let outcome = context
        .banks_client
        .process_transaction_with_metadata(transaction)
        .await
        .expect("BanksClient must return the actual transaction result");
    evidence["transaction_result"] = json!(format!("{:?}", outcome.result));
    if let Some(metadata) = &outcome.metadata {
        evidence["compute_units_consumed"] = json!(metadata.compute_units_consumed);
        evidence["log_messages"] = json!(metadata.log_messages);
    }
    evidence["stage"] = json!("transaction_observed");
    fs::write(
        &evidence_file,
        serde_json::to_vec_pretty(&evidence).unwrap(),
    )
    .unwrap();

    assert!(
        outcome.result.is_ok(),
        "The actual Pump create_v2 CPI must succeed: {:?}",
        outcome.result
    );
    let metadata = outcome
        .metadata
        .as_ref()
        .expect("ProgramTest execution metadata is mandatory");
    assert!(metadata.compute_units_consumed > 0);
    assert!(metadata
        .log_messages
        .iter()
        .any(|line| line == &format!("Program {pump_id} invoke [2]")));
    assert!(metadata
        .log_messages
        .iter()
        .any(|line| line == &format!("Program {pump_id} success")));

    let mint_account = context
        .banks_client
        .get_account(mint_pda)
        .await
        .unwrap()
        .expect("Pump must create the mint PDA");
    assert_eq!(mint_account.owner, token_program_id);
    assert!(!mint_account.executable);
    assert!(
        runtime_rent.is_exempt(mint_account.lamports, mint_account.data.len()),
        "Pump-created Token-2022 mint must be rent-exempt for its actual data length"
    );
    let mint_state = StateWithExtensions::<Mint>::unpack(&mint_account.data)
        .expect("Pump-created Token-2022 mint must deserialize");
    assert_eq!(mint_state.base.decimals, TOKEN_DECIMALS);
    assert_eq!(mint_state.base.supply, global_state.token_total_supply);
    assert_eq!(
        mint_state.base.mint_authority,
        COption::None,
        "Pump must revoke mint authority after minting the fixed supply"
    );
    let token_metadata = mint_state
        .get_variable_len_extension::<TokenMetadata>()
        .expect("create_v2 mint must contain Token-2022 metadata");
    assert_eq!(token_metadata.mint, mint_pda);
    assert_eq!(token_metadata.name, NAME);
    assert_eq!(token_metadata.symbol, SYMBOL);
    assert_eq!(token_metadata.uri, URI);

    let curve_account = context
        .banks_client
        .get_account(bonding_curve)
        .await
        .unwrap()
        .expect("Pump must create the bonding curve PDA");
    assert_eq!(curve_account.owner, pump_id);
    assert!(!curve_account.executable);
    assert!(
        runtime_rent.is_exempt(curve_account.lamports, curve_account.data.len()),
        "Pump-created bonding curve must be rent-exempt for its actual data length"
    );
    assert!(curve_account.data.len() >= 8);
    assert_eq!(
        &curve_account.data[..8],
        BONDING_CURVE_DISCRIMINATOR.as_slice()
    );
    let mut offset = 8;
    let virtual_token_reserves = read_u64(&curve_account.data, &mut offset).unwrap();
    let virtual_quote_reserves = read_u64(&curve_account.data, &mut offset).unwrap();
    let real_token_reserves = read_u64(&curve_account.data, &mut offset).unwrap();
    let real_quote_reserves = read_u64(&curve_account.data, &mut offset).unwrap();
    let curve_supply = read_u64(&curve_account.data, &mut offset).unwrap();
    let complete = read_bool(&curve_account.data, &mut offset).unwrap();
    let curve_creator = read_pubkey(&curve_account.data, &mut offset).unwrap();
    let mayhem_mode = read_bool(&curve_account.data, &mut offset).unwrap();
    let cashback = read_bool(&curve_account.data, &mut offset).unwrap();
    let quote_mint = read_pubkey(&curve_account.data, &mut offset).unwrap();
    let creator_fee_bps = read_u64(&curve_account.data, &mut offset).unwrap();
    let can_edit_creator_fee = read_bool(&curve_account.data, &mut offset).unwrap();
    let holder_reward = read_bool(&curve_account.data, &mut offset).unwrap();
    assert_eq!(
        virtual_token_reserves,
        global_state.initial_virtual_token_reserves
    );
    assert_eq!(
        virtual_quote_reserves,
        global_state.initial_virtual_sol_reserves
    );
    assert_eq!(
        real_token_reserves,
        global_state.initial_real_token_reserves
    );
    assert_eq!(real_quote_reserves, 0);
    assert_eq!(curve_supply, global_state.token_total_supply);
    assert!(!complete);
    assert_eq!(curve_creator, creator_pda);
    assert!(!mayhem_mode);
    assert!(!cashback);
    assert_eq!(
        quote_mint,
        Pubkey::from_str("So11111111111111111111111111111111111111112").unwrap()
    );
    assert_eq!(creator_fee_bps, 0);
    assert!(!can_edit_creator_fee);
    assert!(!holder_reward);

    let curve_token_account = context
        .banks_client
        .get_account(associated_bonding_curve)
        .await
        .unwrap()
        .expect("Pump must create the bonding curve's associated Token-2022 account");
    assert_eq!(curve_token_account.owner, token_program_id);
    assert!(
        runtime_rent.is_exempt(curve_token_account.lamports, curve_token_account.data.len()),
        "Pump-created associated Token-2022 account must be rent-exempt for its actual data length"
    );
    let curve_token_state = StateWithExtensions::<TokenAccount>::unpack(&curve_token_account.data)
        .expect("bonding curve token account must deserialize");
    assert_eq!(curve_token_state.base.mint, mint_pda);
    assert_eq!(curve_token_state.base.owner, bonding_curve);
    assert_eq!(
        curve_token_state.base.amount,
        global_state.token_total_supply
    );

    assert_eq!(event.name, NAME);
    assert_eq!(event.symbol, SYMBOL);
    assert_eq!(event.uri, URI);
    assert_eq!(event.mint, mint_pda);
    assert_eq!(event.bonding_curve, bonding_curve);
    assert_eq!(event.user, creator_pda);
    assert_eq!(event.creator, creator_pda);
    evidence["create_event_source"] =
        json!("Pump event-CPI inner instruction captured by ProgramTest simulation");
    evidence["create_event"] = json!({
        "name": event.name,
        "symbol": event.symbol,
        "uri": event.uri,
        "mint": event.mint.to_string(),
        "bonding_curve": event.bonding_curve.to_string(),
        "user": event.user.to_string(),
        "creator": event.creator.to_string()
    });

    evidence["stage"] = json!("create_v2_success_verified");
    evidence["cpi_tested"] = json!(true);
    evidence["token_creation_tested"] = json!(true);
    evidence["mint_owner"] = json!(mint_account.owner.to_string());
    evidence["mint_data_len"] = json!(mint_account.data.len());
    evidence["mint_decimals"] = json!(mint_state.base.decimals);
    evidence["mint_supply"] = json!(mint_state.base.supply);
    let mint_authority = match mint_state.base.mint_authority {
        COption::None => None,
        COption::Some(authority) => Some(authority.to_string()),
    };
    evidence["mint_authority"] = json!(mint_authority);
    evidence["bonding_curve_owner"] = json!(curve_account.owner.to_string());
    evidence["bonding_curve_data_len"] = json!(curve_account.data.len());
    evidence["bonding_curve_creator"] = json!(curve_creator.to_string());
    evidence["associated_bonding_curve_owner"] = json!(curve_token_account.owner.to_string());
    evidence["associated_bonding_curve_amount"] = json!(curve_token_state.base.amount);
    evidence["creator_fee_tested"] = json!(false);
    fs::write(
        &evidence_file,
        serde_json::to_vec_pretty(&evidence).unwrap(),
    )
    .unwrap();
    println!("{}", serde_json::to_string_pretty(&evidence).unwrap());
}
