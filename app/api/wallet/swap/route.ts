import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import {
  isValidEVMAddress,
  getRpcUrl,
  resolveTokenAddress,
  ERC20_ABI,
  getSenderPrivateKey,
} from '@/utils/wallet';

// Uses 1inch Aggregation Protocol v6 (https://portal.1inch.dev)
// Set ONEINCH_API_KEY in .env.local for authenticated access.
// Swap execution also requires WALLET_PRIVATE_KEY in .env.local.

const ONEINCH_BASE = 'https://api.1inch.dev/swap/v6.0';

// Native token address used by 1inch to represent ETH/native coin
const NATIVE_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

function resolveForSwap(token: string, chainId: string): string | null {
  if (token.toLowerCase() === 'eth') return NATIVE_TOKEN;
  return resolveTokenAddress(token, chainId);
}

async function oneInchFetch(path: string, apiKey: string): Promise<Response> {
  return fetch(`${ONEINCH_BASE}${path}`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
  });
}

// GET  /api/wallet/swap?chain_id=1&from=eth&to=usdt&amount=0.1
//   → returns quote (no tx sent)
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const chainId = searchParams.get('chain_id');
  const fromToken = searchParams.get('from');
  const toToken = searchParams.get('to');
  const amount = searchParams.get('amount');

  if (!chainId || !fromToken || !toToken || !amount) {
    return NextResponse.json(
      { error: 'Required: chain_id, from, to, amount' },
      { status: 400 }
    );
  }

  const apiKey = process.env.ONEINCH_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ONEINCH_API_KEY environment variable is not set. Get a free key at https://portal.1inch.dev' },
      { status: 500 }
    );
  }

  const rpcUrl = getRpcUrl(chainId);
  if (!rpcUrl) {
    return NextResponse.json({ error: `No RPC URL for chain_id '${chainId}'` }, { status: 404 });
  }

  const fromAddress = resolveForSwap(fromToken, chainId);
  const toAddress = resolveForSwap(toToken, chainId);
  if (!fromAddress) return NextResponse.json({ error: `Unknown 'from' token: ${fromToken}` }, { status: 400 });
  if (!toAddress) return NextResponse.json({ error: `Unknown 'to' token: ${toToken}` }, { status: 400 });

  // Get decimals for from-token to parse amount
  let fromDecimals = 18;
  if (fromAddress !== NATIVE_TOKEN) {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const contract = new ethers.Contract(fromAddress, ERC20_ABI, provider);
      fromDecimals = await contract.decimals();
    } catch {
      // use default 18
    }
  }

  const amountInWei = ethers.parseUnits(amount, fromDecimals).toString();

  const quoteUrl = `/${chainId}/quote?src=${fromAddress}&dst=${toAddress}&amount=${amountInWei}`;
  const quoteRes = await oneInchFetch(quoteUrl, apiKey);
  if (!quoteRes.ok) {
    const err = await quoteRes.text();
    return NextResponse.json({ error: `1inch quote failed: ${err}` }, { status: 502 });
  }

  const quote = await quoteRes.json();

  // Determine to-token decimals for formatting
  let toDecimals = 18;
  if (toAddress !== NATIVE_TOKEN) {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const contract = new ethers.Contract(toAddress, ERC20_ABI, provider);
      toDecimals = await contract.decimals();
    } catch {
      // use default 18
    }
  }

  const toAmountFormatted = ethers.formatUnits(quote.dstAmount ?? quote.toAmount ?? '0', toDecimals);

  return NextResponse.json({
    chain_id: chainId,
    from: { token: fromToken.toUpperCase(), address: fromAddress, amount, decimals: fromDecimals },
    to: { token: toToken.toUpperCase(), address: toAddress, amount: toAmountFormatted, decimals: toDecimals },
    estimated_gas: quote.gas,
    protocols: quote.protocols,
  });
}

// POST /api/wallet/swap  body: { chain_id, from, to, amount, slippage? }
//   → executes the swap using WALLET_PRIVATE_KEY
export async function POST(req: NextRequest) {
  const privateKey = getSenderPrivateKey();
  const apiKey = process.env.ONEINCH_API_KEY;

  if (!privateKey) {
    return NextResponse.json({ error: 'WALLET_PRIVATE_KEY environment variable is not set' }, { status: 500 });
  }
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ONEINCH_API_KEY environment variable is not set. Get a free key at https://portal.1inch.dev' },
      { status: 500 }
    );
  }

  let body: {
    chain_id?: string;
    from?: string;
    to?: string;
    amount?: string;
    slippage?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { chain_id: chainId, from: fromToken, to: toToken, amount, slippage = 1 } = body;

  if (!chainId || !fromToken || !toToken || !amount) {
    return NextResponse.json({ error: 'Required: chain_id, from, to, amount' }, { status: 400 });
  }

  const rpcUrl = getRpcUrl(chainId);
  if (!rpcUrl) {
    return NextResponse.json({ error: `No RPC URL for chain_id '${chainId}'` }, { status: 404 });
  }

  const fromAddress = resolveForSwap(fromToken, chainId);
  const toAddress = resolveForSwap(toToken, chainId);
  if (!fromAddress) return NextResponse.json({ error: `Unknown 'from' token: ${fromToken}` }, { status: 400 });
  if (!toAddress) return NextResponse.json({ error: `Unknown 'to' token: ${toToken}` }, { status: 400 });

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const walletAddress = wallet.address;

  // Get decimals for from-token
  let fromDecimals = 18;
  if (fromAddress !== NATIVE_TOKEN) {
    try {
      const contract = new ethers.Contract(fromAddress, ERC20_ABI, provider);
      fromDecimals = await contract.decimals();
    } catch { /* use 18 */ }
  }

  const amountInWei = ethers.parseUnits(amount, fromDecimals).toString();

  // If ERC-20, approve 1inch router first
  if (fromAddress !== NATIVE_TOKEN) {
    const approvalRes = await oneInchFetch(
      `/${chainId}/approve/transaction?tokenAddress=${fromAddress}&amount=${amountInWei}`,
      apiKey
    );
    if (approvalRes.ok) {
      const approvalTx = await approvalRes.json();
      if (approvalTx?.to) {
        try {
          const approveTx = await wallet.sendTransaction({
            to: approvalTx.to,
            data: approvalTx.data,
            gasPrice: approvalTx.gasPrice ? BigInt(approvalTx.gasPrice) : undefined,
          });
          await approveTx.wait();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return NextResponse.json({ error: `Token approval failed: ${msg}` }, { status: 500 });
        }
      }
    }
  }

  // Get swap transaction data from 1inch
  const swapUrl = `/${chainId}/swap?src=${fromAddress}&dst=${toAddress}&amount=${amountInWei}&from=${walletAddress}&slippage=${slippage}&disableEstimate=false`;
  const swapRes = await oneInchFetch(swapUrl, apiKey);
  if (!swapRes.ok) {
    const err = await swapRes.text();
    return NextResponse.json({ error: `1inch swap quote failed: ${err}` }, { status: 502 });
  }

  const swapData = await swapRes.json();
  const txParams = swapData.tx;

  try {
    const tx = await wallet.sendTransaction({
      to: txParams.to,
      data: txParams.data,
      value: txParams.value ? BigInt(txParams.value) : 0n,
      gasPrice: txParams.gasPrice ? BigInt(txParams.gasPrice) : undefined,
      gasLimit: txParams.gas ? BigInt(Math.floor(txParams.gas * 1.25)) : undefined,
    });
    const receipt = await tx.wait();

    return NextResponse.json({
      success: true,
      from: { token: fromToken.toUpperCase(), amount },
      to: { token: toToken.toUpperCase() },
      tx_hash: tx.hash,
      block_number: receipt?.blockNumber ?? null,
      status: receipt?.status === 1 ? 'confirmed' : 'failed',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Swap transaction failed: ${msg}` }, { status: 500 });
  }
}
