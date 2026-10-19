use {
    anchor_lang::AccountDeserialize,
    launchpad_escrow::{Campaign, CampaignStatus, Participant},
    sha2::{Digest, Sha256},
    solana_account::Account,
    solana_clock::Clock,
    solana_instruction::{AccountMeta, Instruction},
    solana_keypair::Keypair,
    solana_program_test::{BanksClientError, ProgramTest, ProgramTestContext},
    solana_pubkey::Pubkey,
    solana_signer::Signer,
    solana_transaction::Transaction,
    std::{fs, path::Path, str::FromStr},
};

const CAMPAIGN_ID: u64 = 71;
const DEPOSIT_LAMPORTS: u64 = 100_000_000;
const TEST_WALLET_LAMPORTS: u64 = 5_000_000_000;
const SYSTEM_PROGRAM_ID: &str = "11111111111111111111111111111111";

fn system_account(lamports: u64) -> Account {
    Account {
        lamports,
        data: Vec::new(),
        owner: Pubkey::from_str(SYSTEM_PROGRAM_ID).unwrap(),
        executable: false,
        rent_epoch: 0,
    }
}

fn anchor_instruction(
    program_id: Pubkey,
    name: &str,
    accounts: Vec<AccountMeta>,
    args: &[u8],
) -> Instruction {
    let preimage = format!("global:{name}");
    let discriminator = Sha256::digest(preimage.as_bytes());
    let mut data = discriminator[..8].to_vec();
    data.extend_from_slice(args);
    Instruction {
        program_id,
        accounts,
        data,
    }
}

#[derive(Clone, Copy)]
struct PriceQuote {
    price: i64,
    confidence: u64,
    exponent: i32,
    publish_time: i64,
}

fn load_price_fixture(program_test: &mut ProgramTest) -> (Pubkey, PriceQuote) {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../test-client/fixtures/accounts/valid.json");
    let json: serde_json::Value = serde_json::from_slice(
        &fs::read(&path).unwrap_or_else(|error| panic!("read {}: {error}", path.display())),
    )
    .expect("parse generated valid Pyth account fixture");
    let address = json["pubkey"]
        .as_str()
        .expect("fixture pubkey")
        .parse::<Pubkey>()
        .expect("valid fixture pubkey");
    let account = &json["account"];
    let owner = account["owner"]
        .as_str()
        .expect("fixture owner")
        .parse::<Pubkey>()
        .expect("valid fixture owner");
    let lamports = account["lamports"].as_u64().expect("fixture lamports");
    let data = account["data"][0].as_str().expect("fixture base64 data");
    program_test.add_account_with_base64_data(address, lamports, owner, data);
    let metadata_path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test-client/fixtures/addresses.json");
    let metadata: serde_json::Value = serde_json::from_slice(
        &fs::read(&metadata_path)
            .unwrap_or_else(|error| panic!("read {}: {error}", metadata_path.display())),
    )
    .expect("parse generated fixture metadata");
    let valid = &metadata["valid"];
    let quote = PriceQuote {
        price: valid["price"]
            .as_str()
            .expect("fixture price")
            .parse()
            .expect("integer fixture price"),
        confidence: valid["confidence"]
            .as_str()
            .expect("fixture confidence")
            .parse()
            .expect("integer fixture confidence"),
        exponent: valid["exponent"]
            .as_i64()
            .expect("fixture exponent")
            .try_into()
            .expect("i32 fixture exponent"),
        publish_time: valid["publishTime"]
            .as_str()
            .expect("fixture publish time")
            .parse()
            .expect("integer fixture publish time"),
    };
    (address, quote)
}

fn start_campaign_instruction(
    program_id: Pubkey,
    creator: Pubkey,
    campaign: Pubkey,
) -> Instruction {
    anchor_instruction(
        program_id,
        "start_campaign",
        vec![
            AccountMeta::new(creator, true),
            AccountMeta::new(campaign, false),
            AccountMeta::new_readonly(Pubkey::from_str(SYSTEM_PROGRAM_ID).unwrap(), false),
        ],
        &CAMPAIGN_ID.to_le_bytes(),
    )
}

fn finalize_failure_instruction(
    program_id: Pubkey,
    caller: Pubkey,
    campaign: Pubkey,
) -> Instruction {
    anchor_instruction(
        program_id,
        "finalize_failure",
        vec![
            AccountMeta::new_readonly(caller, true),
            AccountMeta::new(campaign, false),
        ],
        &[],
    )
}

fn claim_refund_instruction(
    program_id: Pubkey,
    wallet: Pubkey,
    campaign: Pubkey,
    participant: Pubkey,
    vault: Pubkey,
) -> Instruction {
    anchor_instruction(
        program_id,
        "claim_refund",
        vec![
            AccountMeta::new(wallet, true),
            AccountMeta::new(campaign, false),
            AccountMeta::new(participant, false),
            AccountMeta::new(vault, false),
            AccountMeta::new_readonly(Pubkey::from_str(SYSTEM_PROGRAM_ID).unwrap(), false),
        ],
        &[],
    )
}

fn contribution_instruction(
    program_id: Pubkey,
    contributor: Pubkey,
    campaign: Pubkey,
    participant: Pubkey,
    vault: Pubkey,
    price_update: Pubkey,
    quote: PriceQuote,
    quote_expires_at: i64,
) -> Instruction {
    let mut args = Vec::with_capacity(36);
    args.extend_from_slice(&quote.price.to_le_bytes());
    args.extend_from_slice(&quote.confidence.to_le_bytes());
    args.extend_from_slice(&quote.exponent.to_le_bytes());
    args.extend_from_slice(&quote.publish_time.to_le_bytes());
    args.extend_from_slice(&quote_expires_at.to_le_bytes());
    args.extend_from_slice(&DEPOSIT_LAMPORTS.to_le_bytes());
    anchor_instruction(
        program_id,
        "contribute",
        vec![
            AccountMeta::new(contributor, true),
            AccountMeta::new(campaign, false),
            AccountMeta::new(participant, false),
            AccountMeta::new(vault, false),
            AccountMeta::new(price_update, false),
            AccountMeta::new_readonly(Pubkey::from_str(SYSTEM_PROGRAM_ID).unwrap(), false),
        ],
        &args,
    )
}

async fn process_at(
    context: &mut ProgramTestContext,
    unix_timestamp: i64,
    instruction: Instruction,
    additional_signers: &[&Keypair],
) -> Result<(), BanksClientError> {
    let current_clock = context.banks_client.get_sysvar::<Clock>().await?;
    context
        .warp_to_slot(current_clock.slot + 1)
        .expect("advance slot for a unique blockhash");

    let mut clock = context.banks_client.get_sysvar::<Clock>().await?;
    clock.unix_timestamp = unix_timestamp;
    context.set_sysvar(&clock);

    let payer = context.payer.pubkey();
    let mut signers = vec![&context.payer];
    signers.extend_from_slice(additional_signers);
    let transaction = Transaction::new_signed_with_payer(
        &[instruction],
        Some(&payer),
        &signers,
        context.last_blockhash,
    );
    context.banks_client.process_transaction(transaction).await
}

async fn assert_rejected_at(
    context: &mut ProgramTestContext,
    unix_timestamp: i64,
    instruction: Instruction,
    additional_signers: &[&Keypair],
    label: &str,
) {
    let result = process_at(context, unix_timestamp, instruction, additional_signers).await;
    assert!(result.is_err(), "{label} must be rejected; got {result:?}");
}

#[tokio::test]
async fn deadline_refund_lifecycle_uses_deterministic_clock_values() {
    let program_id = Pubkey::new_from_array(launchpad_escrow::ID.to_bytes());
    let wallet = Keypair::new();
    let late_contributor = Keypair::new();
    let attacker = Keypair::new();
    let campaign_id = CAMPAIGN_ID.to_le_bytes();
    let (campaign, _) = Pubkey::find_program_address(
        &[b"campaign", wallet.pubkey().as_ref(), &campaign_id],
        &program_id,
    );
    let (participant, _) = Pubkey::find_program_address(
        &[b"participant", campaign.as_ref(), wallet.pubkey().as_ref()],
        &program_id,
    );
    let (vault, _) = Pubkey::find_program_address(&[b"vault", campaign.as_ref()], &program_id);
    let (late_participant, _) = Pubkey::find_program_address(
        &[
            b"participant",
            campaign.as_ref(),
            late_contributor.pubkey().as_ref(),
        ],
        &program_id,
    );

    let mut program_test = ProgramTest::new("launchpad_escrow", program_id, None);
    program_test.add_account(wallet.pubkey(), system_account(TEST_WALLET_LAMPORTS));
    program_test.add_account(
        late_contributor.pubkey(),
        system_account(TEST_WALLET_LAMPORTS),
    );
    program_test.add_account(attacker.pubkey(), system_account(TEST_WALLET_LAMPORTS));
    let (price_update, quote) = load_price_fixture(&mut program_test);
    let base_time = quote.publish_time;
    let deadline = base_time + 3_600;
    let quote_expires_at = base_time + 20;
    let mut context = program_test.start_with_context().await;
    let fee_payer = context.payer.pubkey();

    process_at(
        &mut context,
        base_time,
        start_campaign_instruction(program_id, wallet.pubkey(), campaign),
        &[&wallet],
    )
    .await
    .expect("start campaign through the SBF program");
    process_at(
        &mut context,
        base_time + 1,
        contribution_instruction(
            program_id,
            wallet.pubkey(),
            campaign,
            participant,
            vault,
            price_update,
            quote,
            quote_expires_at,
        ),
        &[&wallet],
    )
    .await
    .expect("record the participant's real contribution through the SBF program");
    assert_eq!(
        context.banks_client.get_balance(vault).await.unwrap(),
        DEPOSIT_LAMPORTS
    );
    let participant_account = context
        .banks_client
        .get_account(participant)
        .await
        .unwrap()
        .expect("successful contribution creates a participant receipt");
    let receipt_rent_lamports = participant_account.lamports;
    let mut participant_bytes: &[u8] = &participant_account.data;
    let recorded_participant =
        Participant::try_deserialize(&mut participant_bytes).expect("deserialize participant");
    assert_eq!(recorded_participant.amount_lamports, DEPOSIT_LAMPORTS);

    assert_rejected_at(
        &mut context,
        deadline - 1,
        finalize_failure_instruction(program_id, fee_payer, campaign),
        &[],
        "finalizing before the deadline",
    )
    .await;
    assert_rejected_at(
        &mut context,
        deadline - 1,
        claim_refund_instruction(program_id, wallet.pubkey(), campaign, participant, vault),
        &[&wallet],
        "claiming before the campaign has failed",
    )
    .await;
    assert_rejected_at(
        &mut context,
        deadline,
        contribution_instruction(
            program_id,
            late_contributor.pubkey(),
            campaign,
            late_participant,
            vault,
            price_update,
            quote,
            quote_expires_at,
        ),
        &[&late_contributor],
        "contributing at the deadline",
    )
    .await;
    assert!(
        context
            .banks_client
            .get_account(late_participant)
            .await
            .unwrap()
            .is_none(),
        "rejected late contribution must not leave a receipt"
    );

    process_at(
        &mut context,
        deadline,
        finalize_failure_instruction(program_id, fee_payer, campaign),
        &[],
    )
    .await
    .expect("finalizing exactly at the deadline must succeed when the goal is missed");

    let wallet_before = context
        .banks_client
        .get_balance(wallet.pubkey())
        .await
        .unwrap();
    let vault_before_wrong_wallet = context.banks_client.get_balance(vault).await.unwrap();
    assert_rejected_at(
        &mut context,
        deadline + 1,
        claim_refund_instruction(program_id, attacker.pubkey(), campaign, participant, vault),
        &[&attacker],
        "another wallet claiming the participant's refund",
    )
    .await;
    assert_eq!(
        context.banks_client.get_balance(vault).await.unwrap(),
        vault_before_wrong_wallet,
        "a refund attempt from another wallet must not move escrow funds"
    );
    process_at(
        &mut context,
        deadline + 1,
        claim_refund_instruction(program_id, wallet.pubkey(), campaign, participant, vault),
        &[&wallet],
    )
    .await
    .expect("refund after the deadline must succeed for the failed campaign");
    let wallet_after = context
        .banks_client
        .get_balance(wallet.pubkey())
        .await
        .unwrap();
    assert_eq!(
        wallet_after - wallet_before,
        DEPOSIT_LAMPORTS + receipt_rent_lamports,
        "the wallet receives the exact saved deposit and its receipt rent; the separate test payer pays fees"
    );
    assert_eq!(context.banks_client.get_balance(vault).await.unwrap(), 0);

    assert_rejected_at(
        &mut context,
        deadline + 1,
        claim_refund_instruction(program_id, wallet.pubkey(), campaign, participant, vault),
        &[&wallet],
        "claiming the same refund twice",
    )
    .await;
    let campaign_account = context
        .banks_client
        .get_account(campaign)
        .await
        .unwrap()
        .expect("campaign remains available after refund");
    let mut campaign_bytes: &[u8] = &campaign_account.data;
    let failed_campaign =
        Campaign::try_deserialize(&mut campaign_bytes).expect("deserialize failed campaign state");
    assert!(failed_campaign.status == CampaignStatus::Failed);
    assert_eq!(failed_campaign.refunded_count, 1);
    assert_eq!(failed_campaign.total_lamports, 0);
    assert_eq!(failed_campaign.participant_count, 1);

    let receipt_after_refund = context.banks_client.get_account(participant).await.unwrap();
    assert!(
        receipt_after_refund
            .map(|account| account.lamports == 0 && account.data.is_empty())
            .unwrap_or(true),
        "the participant receipt is closed so it cannot authorize another refund"
    );
}
