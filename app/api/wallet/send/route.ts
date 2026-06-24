import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import {
  isValidEVMAddress,
  getRpcUrl,
  resolveTokenAddress,
  ERC20_ABI,
} from '@/utils/wallet';

// ─── Security note ────────────────────────────────────────────────────────────
// WALLET_PRIVATE_KEY must be set in .env.local (never commit it to git).
// This endpoint controls real funds — restrict access appropriately in production.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const privateKey = process.env.WALLET_PRIVATE_KEY;
  if (!privateKey) {
    return NextResponse.json(
      { error: 'WALLET_PRIVATE_KEY environment variable is not set' },
      { status: 500 }
    );
  }

  let body: {
    chain_id?: string;
    to?: string;
    amount?: string;
    token?: string; // 'eth' | 'usdt' | '0x...'
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { chain_id: chainId, to, amount, token = 'eth' } = body;

  if (!chainId) return NextResponse.json({ error: 'Missing: chain_id' }, { status: 400 });
  if (!to || !isValidEVMAddress(to)) return NextResponse.json({ error: 'Missing or invalid: to address' }, { status: 400 });
  if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
    return NextResponse.json({ error: 'Missing or invalid: amount (must be a positive number string)' }, { status: 400 });
  }

  const rpcUrl = getRpcUrl(chainId);
  if (!rpcUrl) {
    return NextResponse.json({ error: `No RPC URL for chain_id '${chainId}'` }, { status: 404 });
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const fromAddress = wallet.address;

  try {
    if (token.toLowerCase() === 'eth') {
      // Send native ETH
      const value = ethers.parseEther(amount);
      const balance = await provider.getBalance(fromAddress);
      if (balance < value) {
        return NextResponse.json({
          error: `Insufficient ETH balance. Have: ${ethers.formatEther(balance)} ETH, need: ${amount} ETH`,
        }, { status: 400 });
      }

      const tx = await wallet.sendTransaction({ to, value });
      const receipt = await tx.wait();

      return NextResponse.json({
        success: true,
        token: 'ETH',
        from: fromAddress,
        to,
        amount,
        tx_hash: tx.hash,
        block_number: receipt?.blockNumber ?? null,
        status: receipt?.status === 1 ? 'confirmed' : 'failed',
      });
    }

    // Send ERC-20 token (USDT or any contract)
    const tokenAddress = resolveTokenAddress(token, chainId);
    if (!tokenAddress) {
      return NextResponse.json(
        { error: `Unknown token '${token}'. Use 'eth', 'usdt', or a 0x contract address` },
        { status: 400 }
      );
    }

    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
    const [decimals, symbol, rawBalance] = await Promise.all([
      contract.decimals() as Promise<number>,
      contract.symbol() as Promise<string>,
      contract.balanceOf(fromAddress) as Promise<bigint>,
    ]);

    const sendAmount = ethers.parseUnits(amount, decimals);
    if (rawBalance < sendAmount) {
      return NextResponse.json({
        error: `Insufficient ${symbol} balance. Have: ${ethers.formatUnits(rawBalance, decimals)} ${symbol}, need: ${amount}`,
      }, { status: 400 });
    }

    const tx = await contract.transfer(to, sendAmount);
    const receipt = await tx.wait();

    return NextResponse.json({
      success: true,
      token: symbol,
      token_address: tokenAddress,
      from: fromAddress,
      to,
      amount,
      tx_hash: tx.hash,
      block_number: receipt?.blockNumber ?? null,
      status: receipt?.status === 1 ? 'confirmed' : 'failed',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Transaction failed: ${msg}` }, { status: 500 });
  }
}
