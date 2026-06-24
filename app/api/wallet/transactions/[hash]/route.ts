import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { ETHERSCAN_API_URLS, getRpcUrl } from '@/utils/wallet';

// Common ERC-20 / ERC-721 event signatures for log decoding
const EVENT_SIGS: Record<string, string> = {
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef': 'Transfer(address,address,uint256)',
  '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925': 'Approval(address,address,uint256)',
  '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822': 'Swap(address,uint256,uint256,uint256,uint256,address)',
  '0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1': 'Sync(uint112,uint112)',
};

// Common function selectors
const FUNC_SIGS: Record<string, string> = {
  '0xa9059cbb': 'transfer(address,uint256)',
  '0x23b872dd': 'transferFrom(address,address,uint256)',
  '0x095ea7b3': 'approve(address,uint256)',
  '0x70a08231': 'balanceOf(address)',
  '0x18160ddd': 'totalSupply()',
  '0x38ed1739': 'swapExactTokensForTokens',
  '0x7ff36ab5': 'swapExactETHForTokens',
  '0x791ac947': 'swapExactTokensForETH',
  '0x12aa3caf': '1inch: swap',
  '0xe449022e': '1inch: uniswapV3Swap',
  '0x8803dbee': 'swapTokensForExactTokens',
};

function decodeInput(input: string): { selector: string; method: string | null; raw: string } {
  if (!input || input === '0x') return { selector: '0x', method: 'ETH Transfer', raw: input };
  const selector = input.slice(0, 10).toLowerCase();
  return {
    selector,
    method: FUNC_SIGS[selector] ?? null,
    raw: input,
  };
}

function decodeLog(log: {
  address: string;
  topics: string[];
  data: string;
}): { event: string | null; decoded: Record<string, string> | null } {
  const sig = log.topics[0]?.toLowerCase();
  const event = sig ? (EVENT_SIGS[sig] ?? null) : null;

  if (!event) return { event: null, decoded: null };

  // Decode Transfer(address,address,uint256)
  if (sig === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
    const from  = log.topics[1] ? '0x' + log.topics[1].slice(26) : null;
    const to    = log.topics[2] ? '0x' + log.topics[2].slice(26) : null;
    const value = log.data !== '0x' ? BigInt(log.data).toString() : null;
    return {
      event: 'Transfer',
      decoded: { from: from ?? '', to: to ?? '', value: value ?? '0' },
    };
  }

  // Decode Approval(address,address,uint256)
  if (sig === '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925') {
    const owner   = log.topics[1] ? '0x' + log.topics[1].slice(26) : null;
    const spender = log.topics[2] ? '0x' + log.topics[2].slice(26) : null;
    const value   = log.data !== '0x' ? BigInt(log.data).toString() : null;
    return {
      event: 'Approval',
      decoded: { owner: owner ?? '', spender: spender ?? '', value: value ?? '0' },
    };
  }

  return { event, decoded: null };
}

// GET /api/wallet/transactions/[hash]?chain_id=1
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const { hash } = await params;
  const chainId  = req.nextUrl.searchParams.get('chain_id') ?? '1';

  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    return NextResponse.json({ error: 'Invalid transaction hash' }, { status: 400 });
  }

  const apiKey  = process.env.ETHERSCAN_API_KEY;
  const baseUrl = ETHERSCAN_API_URLS[chainId];
  if (!apiKey || !baseUrl) {
    return NextResponse.json({ error: 'ETHERSCAN_API_KEY not set or chain not supported' }, { status: 500 });
  }

  const rpcUrl = getRpcUrl(chainId);

  // ── Fetch all metadata in parallel ────────────────────────────────────────
  const [txData, receiptData, internalData, rpcTx] = await Promise.all([

    // Full tx details from Etherscan
    (async () => {
      const url = new URL(baseUrl);
      url.searchParams.set('module', 'proxy');
      url.searchParams.set('action', 'eth_getTransactionByHash');
      url.searchParams.set('txhash', hash);
      url.searchParams.set('apikey', apiKey);
      const r = await fetch(url.toString(), { next: { revalidate: 30 } });
      return r.json();
    })(),

    // Receipt with logs
    (async () => {
      const url = new URL(baseUrl);
      url.searchParams.set('module', 'proxy');
      url.searchParams.set('action', 'eth_getTransactionReceipt');
      url.searchParams.set('txhash', hash);
      url.searchParams.set('apikey', apiKey);
      const r = await fetch(url.toString(), { next: { revalidate: 30 } });
      return r.json();
    })(),

    // Internal transactions
    (async () => {
      const url = new URL(baseUrl);
      url.searchParams.set('module', 'account');
      url.searchParams.set('action', 'txlistinternal');
      url.searchParams.set('txhash', hash);
      url.searchParams.set('apikey', apiKey);
      const r = await fetch(url.toString(), { next: { revalidate: 30 } });
      return r.json();
    })(),

    // Block timestamp from RPC (more reliable)
    (async () => {
      if (!rpcUrl) return null;
      try {
        const provider = new ethers.JsonRpcProvider(rpcUrl);
        return provider.getTransaction(hash);
      } catch { return null; }
    })(),
  ]);

  const tx      = txData?.result ?? null;
  const receipt = receiptData?.result ?? null;
  const internalTxs = Array.isArray(internalData?.result) ? internalData.result : [];

  if (!tx) {
    return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
  }

  // ── Decode input ──────────────────────────────────────────────────────────
  const inputDecoded = decodeInput(tx.input ?? '0x');

  // ── Decode logs ───────────────────────────────────────────────────────────
  const logs: Array<{
    index: number;
    contract: string;
    event: string | null;
    decoded: Record<string, string> | null;
    topics: string[];
    data: string;
  }> = (receipt?.logs ?? []).map((log: { logIndex: string; address: string; topics: string[]; data: string }) => ({
    index:    parseInt(log.logIndex, 16),
    contract: log.address,
    ...decodeLog(log),
    topics:   log.topics,
    data:     log.data,
  }));

  // ── Gas details ───────────────────────────────────────────────────────────
  const gasUsed     = receipt?.gasUsed  ? parseInt(receipt.gasUsed, 16)  : null;
  const gasLimit    = tx.gas            ? parseInt(tx.gas, 16)           : null;
  const gasPriceWei = tx.gasPrice       ? BigInt(tx.gasPrice)            : null;
  const gasFeeEth   = gasUsed && gasPriceWei
    ? ethers.formatEther(BigInt(gasUsed) * gasPriceWei)
    : null;
  const gasEfficiency = gasUsed && gasLimit
    ? +((gasUsed / gasLimit) * 100).toFixed(1)
    : null;

  // ── Value ─────────────────────────────────────────────────────────────────
  const valueEth = tx.value ? ethers.formatEther(BigInt(tx.value)) : '0';

  // ── Block info ────────────────────────────────────────────────────────────
  const blockNumber = tx.blockNumber ? parseInt(tx.blockNumber, 16) : null;
  const blockTimestamp = rpcTx ? (await (async () => {
    if (!rpcUrl || !blockNumber) return null;
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const block = await provider.getBlock(blockNumber);
      return block ? new Date(block.timestamp * 1000).toISOString() : null;
    } catch { return null; }
  })()) : null;

  return NextResponse.json({
    chain_id: chainId,
    hash,

    status: receipt?.status === '0x1' ? 'success' : receipt?.status === '0x0' ? 'failed' : 'pending',

    block: {
      number:    blockNumber,
      timestamp: blockTimestamp,
    },

    from:      tx.from,
    to:        tx.to,
    value_eth: valueEth,

    input: inputDecoded,

    gas: {
      limit:           gasLimit,
      used:            gasUsed,
      efficiency_pct:  gasEfficiency,
      price_gwei:      gasPriceWei ? +ethers.formatUnits(gasPriceWei, 'gwei') : null,
      fee_eth:         gasFeeEth,
    },

    logs: {
      count: logs.length,
      entries: logs,
    },

    internal_transactions: {
      count: internalTxs.length,
      entries: internalTxs,
    },

    nonce: tx.nonce ? parseInt(tx.nonce, 16) : null,
    type:  tx.type  ? parseInt(tx.type, 16)  : null,
  });
}
