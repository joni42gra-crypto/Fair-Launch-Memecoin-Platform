use {
    anchor_lang::{prelude::Pubkey as AnchorPubkey, AccountDeserialize, AccountSerialize},
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
const BASE_TIME: i64 = 1_700_000_000;
const DEADLINE: i64 = BASE_TIME + 3_600;
const DEPOSIT_LAMPORTS: u64 = 100_000_000;
const RECEIPT_RENT_LAMPORTS: u64 = 10_000_000;
const TEST_WALLET_LAMPORTS: u64 = 5_000_000_000;
const SYSTEM_PROGRAM_ID: &str = "11111111111111111111111111111111";

fn as_anchor_pubkey(pubkey: Pubkey) -> AnchorPubkey {
    AnchorPubkey::new_from_array(pubkey.to_bytes())
}

fn account_data<T: AccountSerialize>(value: &T) -> Vec<u8> {
    let mut data = Vec::new();
    value
        .try_serialize(&mut data)
        .expect("serialize fixture account");
    data
}

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

fn load_price_fixture(program_test: &mut ProgramTest) -> Pubkey {
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
    address
}

fn campaign_data(creator: Pubkey, campaign_bump: u8) -> Vec<u8> {
    account_data(&Campaign {
        creator: as_anchor_pubkey(creator),
        campaign_id: CAMPAIGN_ID,
        started_at: BASE_TIME,
        ends_at: DEADLINE,
        participant_count: 1,
        refunded_count: 0,
        status: CampaignStatus::Open,
        total_lamports: DEPOSIT_LAMPORTS,
        bump: campaign_bump,
    })
}

fn participant_data(campaign: Pubkey, wallet: Pubkey, participant_bump: u8) -> Vec<u8> {
    account_data(&Participant {
        campaign: as_anchor_pubkey(campaign),
        wallet: as_anchor_pubkey(wallet),
        amount_lamports: DEPOSIT_LAMPORTS,
        price: 10_000_000_000,
        confidence: 10_000_000,
        exponent: -8,
        publish_time: BASE_TIME,
        quote_expires_at: BASE_TIME + 20,
        joined_at: BASE_TIME,
        bump: participant_bump,
    })
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

fn late_contribution_instruction(
    program_id: Pubkey,
    contributor: Pubkey,
    campaign: Pubkey,
    participant: Pubkey,
    vault: Pubkey,
    price_update: Pubkey,
) -> Instruction {
    let mut args = Vec::with_capacity(36);
    args.extend_from_slice(&10_000_000_000_i64.to_le_bytes());
    args.extend_from_slice(&10_000_000_u64.to_le_bytes());
    args.extend_from_slice(&(-8_i32).to_le_bytes());
    args.extend_from_slice(&BASE_TIME.to_le_bytes());
    args.extend_from_slice(&(DEADLINE + 10).to_le_bytes());
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
    let system_program = Pubkey::from_str(SYSTEM_PROGRAM_ID).unwrap();
    let wallet = Keypair::new();
    let late_contributor = Keypair::new();
    let attacker = Keypair::new();
    let campaign_id = CAMPAIGN_ID.to_le_bytes();
    let (campaign, campaign_bump) = Pubkey::find_program_address(
        &[b"campaign", wallet.pubkey().as_ref(), &campaign_id],
        &program_id,
    );
    let (participant, participant_bump) = Pubkey::find_program_address(
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
    program_test.add_account(
        campaign,
        Account {
            lamports: RECEIPT_RENT_LAMPORTS,
            data: campaign_data(wallet.pubkey(), campaign_bump),
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        },
    );
    program_test.add_account(
        participant,
        Account {
            lamports: RECEIPT_RENT_LAMPORTS,
            data: participant_data(campaign, wallet.pubkey(), participant_bump),
            owner: program_id,
            executable: false,
            rent_epoch: 0,
        },
    );
    program_test.add_account(
        vault,
        Account {
            lamports: DEPOSIT_LAMPORTS,
            data: Vec::new(),
            owner: system_program,
            executable: false,
            rent_epoch: 0,
        },
    );
    let price_update = load_price_fixture(&mut program_test);
    let mut context = program_test.start_with_context().await;
    let fee_payer = context.payer.pubkey();

    assert_rejected_at(
        &mut context,
        DEADLINE - 1,
        finalize_failure_instruction(program_id, fee_payer, campaign),
        &[],
        "finalizing before the deadline",
    )
    .await;
    assert_rejected_at(
        &mut context,
        DEADLINE - 1,
        claim_refund_instruction(program_id, wallet.pubkey(), campaign, participant, vault),
        &[&wallet],
        "claiming before the campaign has failed",
    )
    .await;
    assert_rejected_at(
        &mut context,
        DEADLINE,
        late_contribution_instruction(
            program_id,
            late_contributor.pubkey(),
            campaign,
            late_participant,
            vault,
            price_update,
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
        DEADLINE,
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
        DEADLINE + 1,
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
        DEADLINE + 1,
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
        DEPOSIT_LAMPORTS + RECEIPT_RENT_LAMPORTS,
        "the wallet receives the exact saved deposit and its receipt rent; the separate test payer pays fees"
    );
    assert_eq!(context.banks_client.get_balance(vault).await.unwrap(), 0);

    assert_rejected_at(
        &mut context,
        DEADLINE + 1,
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
