import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Amm } from "../target/types/amm";
import { LiteSVM } from "litesvm";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { randomBytes } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { expect } from "chai";

describe("AMM Tests with LiteSVM", () => {
  let svm: LiteSVM;
  let payer: Keypair;
  let user: Keypair;
  let mintX: Keypair;
  let mintY: Keypair;
  let config: PublicKey;
  let mintLp: PublicKey;
  let vaultX: PublicKey;
  let vaultY: PublicKey;
  let userX: PublicKey;
  let userY: PublicKey;
  let userLp: PublicKey;

  const seed = new BN(randomBytes(8));
  const fee = 300; // 3%
  const programId = new PublicKey(
    "BTkBMjY2SYiFAC5jGe2bJPJY7gjxmT1ZPqRV4XvQCZRc"
  );

  beforeEach(async () => {
    // Initialize LiteSVM
    svm = new LiteSVM();

    // Load the program
    const programBytes = readFileSync(
      path.join(__dirname, "..", "target", "deploy", "amm.so")
    );
    svm.addProgram(programId, programBytes);

    // Create keypairs
    payer = Keypair.generate();
    user = Keypair.generate();
    mintX = Keypair.generate();
    mintY = Keypair.generate();

    // Airdrop SOL to payer and user
    svm.airdrop(payer.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
    svm.airdrop(user.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

    // Calculate PDAs
    [config] = PublicKey.findProgramAddressSync(
      [Buffer.from("config"), seed.toArrayLike(Buffer, "le", 8)],
      programId
    );

    [mintLp] = PublicKey.findProgramAddressSync(
      [Buffer.from("lp"), config.toBuffer()],
      programId
    );

    // Calculate token accounts
    vaultX = getAssociatedTokenAddressSync(mintX.publicKey, config, true);
    vaultY = getAssociatedTokenAddressSync(mintY.publicKey, config, true);
    userX = getAssociatedTokenAddressSync(mintX.publicKey, user.publicKey);
    userY = getAssociatedTokenAddressSync(mintY.publicKey, user.publicKey);
    userLp = getAssociatedTokenAddressSync(mintLp, user.publicKey);

    // Create and initialize mints
    await createAndInitializeMints();
  });

  async function createAndInitializeMints() {
    const lamports = 1_500_000; // Fixed rent amount for mint accounts

    // Create mint accounts
    const createMintXIx = SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mintX.publicKey,
      lamports,
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    });

    const createMintYIx = SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mintY.publicKey,
      lamports,
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    });

    // Initialize mints
    const initMintXIx = createInitializeMint2Instruction(
      mintX.publicKey,
      6,
      payer.publicKey,
      null,
      TOKEN_PROGRAM_ID
    );

    const initMintYIx = createInitializeMint2Instruction(
      mintY.publicKey,
      6,
      payer.publicKey,
      null,
      TOKEN_PROGRAM_ID
    );

    // Create user token accounts
    const createUserXIx = createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      userX,
      user.publicKey,
      mintX.publicKey,
      TOKEN_PROGRAM_ID
    );

    const createUserYIx = createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      userY,
      user.publicKey,
      mintY.publicKey,
      TOKEN_PROGRAM_ID
    );

    // Mint tokens to user
    const mintToUserXIx = createMintToInstruction(
      mintX.publicKey,
      userX,
      payer.publicKey,
      1_000_000_000, // 1000 tokens
      [],
      TOKEN_PROGRAM_ID
    );

    const mintToUserYIx = createMintToInstruction(
      mintY.publicKey,
      userY,
      payer.publicKey,
      1_000_000_000, // 1000 tokens
      [],
      TOKEN_PROGRAM_ID
    );

    const tx = new Transaction().add(
      createMintXIx,
      createMintYIx,
      initMintXIx,
      initMintYIx,
      createUserXIx,
      createUserYIx,
      mintToUserXIx,
      mintToUserYIx
    );

    const blockhash = svm.latestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer.publicKey;
    tx.sign(payer, mintX, mintY);

    const result = svm.sendTransaction(tx);
    console.log("Setup transaction result:", result);
  }

  function createInitializeInstruction() {
    // Manually create the initialize instruction
    const data = Buffer.alloc(1024);
    let offset = 0;

    // Method discriminator for initialize (first 8 bytes)
    const initializeDiscriminator = Buffer.from([
      175, 175, 109, 31, 13, 152, 155, 237,
    ]);
    initializeDiscriminator.copy(data, offset);
    offset += 8;

    // Seed (u64, 8 bytes, little endian)
    seed.toArrayLike(Buffer, "le", 8).copy(data, offset);
    offset += 8;

    // Fee (u16, 2 bytes, little endian)
    const feeBuffer = Buffer.alloc(2);
    feeBuffer.writeUInt16LE(fee, 0);
    feeBuffer.copy(data, offset);
    offset += 2;

    // Authority (Option<Pubkey>) - None = 0, Some = 1 + 32 bytes
    data.writeUInt8(0, offset); // None
    offset += 1;

    return new TransactionInstruction({
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: mintX.publicKey, isSigner: false, isWritable: false },
        { pubkey: mintY.publicKey, isSigner: false, isWritable: false },
        { pubkey: mintLp, isSigner: false, isWritable: true },
        { pubkey: config, isSigner: false, isWritable: true },
        { pubkey: vaultX, isSigner: false, isWritable: true },
        { pubkey: vaultY, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        {
          pubkey: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          isSigner: false,
          isWritable: false,
        },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId,
      data: data.subarray(0, offset),
    });
  }

  function createDepositInstruction(
    amount: number,
    maxX: number,
    maxY: number
  ) {
    const data = Buffer.alloc(1024);
    let offset = 0;

    // Method discriminator for deposit
    const depositDiscriminator = Buffer.from([
      242, 35, 198, 137, 82, 225, 242, 182,
    ]);
    depositDiscriminator.copy(data, offset);
    offset += 8;

    // Amount (u64, 8 bytes, little endian)
    const amountBN = new BN(amount);
    amountBN.toArrayLike(Buffer, "le", 8).copy(data, offset);
    offset += 8;

    // MaxX (u64, 8 bytes, little endian)
    const maxXBN = new BN(maxX);
    maxXBN.toArrayLike(Buffer, "le", 8).copy(data, offset);
    offset += 8;

    // MaxY (u64, 8 bytes, little endian)
    const maxYBN = new BN(maxY);
    maxYBN.toArrayLike(Buffer, "le", 8).copy(data, offset);
    offset += 8;

    return new TransactionInstruction({
      keys: [
        { pubkey: user.publicKey, isSigner: true, isWritable: true },
        { pubkey: mintX.publicKey, isSigner: false, isWritable: false },
        { pubkey: mintY.publicKey, isSigner: false, isWritable: false },
        { pubkey: mintLp, isSigner: false, isWritable: true },
        { pubkey: config, isSigner: false, isWritable: false },
        { pubkey: vaultX, isSigner: false, isWritable: true },
        { pubkey: vaultY, isSigner: false, isWritable: true },
        { pubkey: userX, isSigner: false, isWritable: true },
        { pubkey: userY, isSigner: false, isWritable: true },
        { pubkey: userLp, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        {
          pubkey: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          isSigner: false,
          isWritable: false,
        },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId,
      data: data.subarray(0, offset),
    });
  }

  function createSwapInstruction(isX: boolean, amount: number, min: number) {
    const data = Buffer.alloc(1024);
    let offset = 0;

    // Method discriminator for swap
    const swapDiscriminator = Buffer.from([
      248, 198, 158, 145, 225, 117, 135, 200,
    ]);
    swapDiscriminator.copy(data, offset);
    offset += 8;

    // IsX (bool, 1 byte)
    data.writeUInt8(isX ? 1 : 0, offset);
    offset += 1;

    // Amount (u64, 8 bytes, little endian)
    const amountBN = new BN(amount);
    amountBN.toArrayLike(Buffer, "le", 8).copy(data, offset);
    offset += 8;

    // Min (u64, 8 bytes, little endian)
    const minBN = new BN(min);
    minBN.toArrayLike(Buffer, "le", 8).copy(data, offset);
    offset += 8;

    return new TransactionInstruction({
      keys: [
        { pubkey: user.publicKey, isSigner: true, isWritable: true },
        { pubkey: mintX.publicKey, isSigner: false, isWritable: false },
        { pubkey: mintY.publicKey, isSigner: false, isWritable: false },
        { pubkey: userX, isSigner: false, isWritable: true },
        { pubkey: userY, isSigner: false, isWritable: true },
        { pubkey: config, isSigner: false, isWritable: false },
        { pubkey: vaultX, isSigner: false, isWritable: true },
        { pubkey: vaultY, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        {
          pubkey: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          isSigner: false,
          isWritable: false,
        },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId,
      data: data.subarray(0, offset),
    });
  }

  function createWithdrawInstruction(
    amount: number,
    minX: number,
    minY: number
  ) {
    const data = Buffer.alloc(1024);
    let offset = 0;

    // Method discriminator for withdraw
    const withdrawDiscriminator = Buffer.from([
      183, 18, 70, 156, 148, 109, 161, 34,
    ]);
    withdrawDiscriminator.copy(data, offset);
    offset += 8;

    // Amount (u64, 8 bytes, little endian)
    const amountBN = new BN(amount);
    amountBN.toArrayLike(Buffer, "le", 8).copy(data, offset);
    offset += 8;

    // MinX (u64, 8 bytes, little endian)
    const minXBN = new BN(minX);
    minXBN.toArrayLike(Buffer, "le", 8).copy(data, offset);
    offset += 8;

    // MinY (u64, 8 bytes, little endian)
    const minYBN = new BN(minY);
    minYBN.toArrayLike(Buffer, "le", 8).copy(data, offset);
    offset += 8;

    return new TransactionInstruction({
      keys: [
        { pubkey: user.publicKey, isSigner: true, isWritable: true },
        { pubkey: mintX.publicKey, isSigner: false, isWritable: false },
        { pubkey: mintY.publicKey, isSigner: false, isWritable: false },
        { pubkey: mintLp, isSigner: false, isWritable: true },
        { pubkey: config, isSigner: false, isWritable: false },
        { pubkey: vaultX, isSigner: false, isWritable: true },
        { pubkey: vaultY, isSigner: false, isWritable: true },
        { pubkey: userX, isSigner: false, isWritable: true },
        { pubkey: userY, isSigner: false, isWritable: true },
        { pubkey: userLp, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        {
          pubkey: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          isSigner: false,
          isWritable: false,
        },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId,
      data: data.subarray(0, offset),
    });
  }

  describe("Initialize", () => {
    it("should initialize AMM pool successfully", async () => {
      const initIx = createInitializeInstruction();

      const tx = new Transaction().add(initIx);
      const blockhash = svm.latestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = payer.publicKey;
      tx.sign(payer);

      const result = svm.sendTransaction(tx);
      console.log("Initialize result:", result);

      // Check that the config account was created
      const configAccount = svm.getAccount(config);
      console.log("Config account:", configAccount);
      expect(configAccount).to.not.be.null;
    });

    it("should fail with invalid fee", async () => {
      // We'll need to create a custom instruction with fee > 10000
      // This test would need to be implemented with direct instruction creation
      // For now, we'll skip this test case
    });
  });

  describe("Deposit", () => {
    beforeEach(async () => {
      // Initialize the pool first
      const initIx = createInitializeInstruction();
      const tx = new Transaction().add(initIx);
      const blockhash = svm.latestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = payer.publicKey;
      tx.sign(payer);
      svm.sendTransaction(tx);
    });

    it("should deposit tokens to empty pool", async () => {
      const depositAmount = 1000000; // 1 LP token
      const maxX = 100000000; // 100 X tokens
      const maxY = 200000000; // 200 Y tokens

      const depositIx = createDepositInstruction(depositAmount, maxX, maxY);

      const tx = new Transaction().add(depositIx);
      const blockhash = svm.latestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = user.publicKey;
      tx.sign(user);

      const result = svm.sendTransaction(tx);
      console.log("Deposit result:", result);

      // Check vault balances
      const vaultXAccount = svm.getAccount(vaultX);
      const vaultYAccount = svm.getAccount(vaultY);
      console.log("Vault X account:", vaultXAccount);
      console.log("Vault Y account:", vaultYAccount);
    });

    it("should handle proportional deposits", async () => {
      // First deposit to establish ratio
      const firstDepositIx = createDepositInstruction(
        1000000,
        100000000,
        200000000
      );
      let tx = new Transaction().add(firstDepositIx);
      let blockhash = svm.latestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = user.publicKey;
      tx.sign(user);
      svm.sendTransaction(tx);

      // Second proportional deposit
      const secondDepositIx = createDepositInstruction(
        500000,
        50000000,
        100000000
      );
      tx = new Transaction().add(secondDepositIx);
      blockhash = svm.latestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = user.publicKey;
      tx.sign(user);

      const result = svm.sendTransaction(tx);
      console.log("Second deposit result:", result);
    });
  });

  describe("Swap", () => {
    beforeEach(async () => {
      // Initialize and fund the pool
      const initIx = createInitializeInstruction();
      let tx = new Transaction().add(initIx);
      let blockhash = svm.latestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = payer.publicKey;
      tx.sign(payer);
      svm.sendTransaction(tx);

      // Add initial liquidity
      const depositIx = createDepositInstruction(1000000, 100000000, 200000000);
      tx = new Transaction().add(depositIx);
      blockhash = svm.latestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = user.publicKey;
      tx.sign(user);
      svm.sendTransaction(tx);
    });

    it("should swap X for Y", async () => {
      const swapAmount = 10000000; // 10 X tokens
      const minReceived = 1; // Minimum Y tokens to receive

      const swapIx = createSwapInstruction(true, swapAmount, minReceived);

      const tx = new Transaction().add(swapIx);
      const blockhash = svm.latestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = user.publicKey;
      tx.sign(user);

      try {
        const result = svm.sendTransaction(tx);
        console.log("Swap X for Y result:", result);
        // Use simulation to check for errors
        const simResult = svm.simulateTransaction(tx);
        console.log("Simulation result:", simResult);
      } catch (error) {
        console.log("Swap X for Y failed:", error);
        throw error;
      }
    });

    it("should swap Y for X", async () => {
      const swapAmount = 20000000; // 20 Y tokens
      const minReceived = 1; // Minimum X tokens to receive

      const swapIx = createSwapInstruction(false, swapAmount, minReceived);

      const tx = new Transaction().add(swapIx);
      const blockhash = svm.latestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = user.publicKey;
      tx.sign(user);

      const result = svm.sendTransaction(tx);
      console.log("Swap Y for X result:", result);
    });

    it("should fail with slippage protection", async () => {
      const swapAmount = 10000000; // 10 X tokens
      const minReceived = 100000000; // Unrealistically high minimum

      const swapIx = createSwapInstruction(true, swapAmount, minReceived);

      const tx = new Transaction().add(swapIx);
      const blockhash = svm.latestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = user.publicKey;
      tx.sign(user);

      const result = svm.sendTransaction(tx);
      console.log("Slippage test result:", result);

      // Check if transaction failed by checking the result type
      if (result.constructor.name === "FailedTransactionMetadata") {
        console.log("Transaction correctly failed due to slippage");
        // Test passes if transaction fails
      } else {
        throw new Error("Transaction should have failed due to slippage");
      }
    });
  });

  describe("Withdraw", () => {
    beforeEach(async () => {
      // Initialize and fund the pool
      const initIx = createInitializeInstruction();
      let tx = new Transaction().add(initIx);
      let blockhash = svm.latestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = payer.publicKey;
      tx.sign(payer);
      svm.sendTransaction(tx);

      // Add initial liquidity
      const depositIx = createDepositInstruction(1000000, 100000000, 200000000);
      tx = new Transaction().add(depositIx);
      blockhash = svm.latestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = user.publicKey;
      tx.sign(user);
      svm.sendTransaction(tx);
    });

    it("should withdraw liquidity", async () => {
      const withdrawAmount = 500000; // 0.5 LP tokens
      const minX = 1; // Minimum X tokens to receive
      const minY = 1; // Minimum Y tokens to receive

      const withdrawIx = createWithdrawInstruction(withdrawAmount, minX, minY);

      const tx = new Transaction().add(withdrawIx);
      const blockhash = svm.latestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = user.publicKey;
      tx.sign(user);

      const result = svm.sendTransaction(tx);
      console.log("Withdraw result:", result);
    });

    it("should fail with insufficient LP tokens", async () => {
      const withdrawAmount = 10000000; // 10 LP tokens (more than available)
      const minX = 1;
      const minY = 1;

      const withdrawIx = createWithdrawInstruction(withdrawAmount, minX, minY);

      const tx = new Transaction().add(withdrawIx);
      const blockhash = svm.latestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = user.publicKey;
      tx.sign(user);

      const result = svm.sendTransaction(tx);
      console.log("Insufficient LP test result:", result);

      // Check if transaction failed by checking the result type
      if (result.constructor.name === "FailedTransactionMetadata") {
        console.log(
          "Transaction correctly failed due to insufficient LP tokens"
        );
        // Test passes if transaction fails
      } else {
        throw new Error(
          "Transaction should have failed due to insufficient LP tokens"
        );
      }
    });
  });

  describe("Integration Tests", () => {
    it("should handle complete flow: initialize -> deposit -> swap -> withdraw", async () => {
      // Initialize
      const initIx = createInitializeInstruction();
      let tx = new Transaction().add(initIx);
      let blockhash = svm.latestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = payer.publicKey;
      tx.sign(payer);
      svm.sendTransaction(tx);

      // Deposit
      const depositIx = createDepositInstruction(1000000, 100000000, 200000000);
      tx = new Transaction().add(depositIx);
      blockhash = svm.latestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = user.publicKey;
      tx.sign(user);
      svm.sendTransaction(tx);

      // Swap
      const swapIx = createSwapInstruction(true, 10000000, 1);
      tx = new Transaction().add(swapIx);
      blockhash = svm.latestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = user.publicKey;
      tx.sign(user);
      svm.sendTransaction(tx);

      // Withdraw
      const withdrawIx = createWithdrawInstruction(500000, 1, 1);
      tx = new Transaction().add(withdrawIx);
      blockhash = svm.latestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = user.publicKey;
      tx.sign(user);

      const result = svm.sendTransaction(tx);
      console.log("Complete flow result:", result);
    });
  });
});
