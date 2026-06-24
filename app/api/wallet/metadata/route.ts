import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import {
  isValidEVMAddress,
  getRpcUrl,
  ETHERSCAN_API_URLS,
  VERIFIED_TOKENS,
  COINGECKO_PLATFORMS,
  NATIVE_COIN_IDS,
  ERC20_ABI,
} from '@/utils/wallet';

const COINGECKO = 'https://api.coingecko.com/api/v3';

type EtherscanTx = {
  hash: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  isError: string;
  gasUsed: string;
  gasPrice: string;
};

type EtherscanTokenTx = {
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  tokenSymbol: string;
  tokenDecimal: string;
  contractAddress: string;
};

async function etherscanGet(
  baseUrl: string,
  params: Record<string, string>,
  apiKey: string
): Promise<{ status: string; result: unknown }> {
  const url = new URL(baseUrl);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('apikey', apiKey);
  const res = await fetch(url.toString(), { next: { revalidate: 120 } });
  return res.json();
}

function formatUsdt(value: string, decimal: string): number {
  const dec = parseInt(decimal, 10) || 6;
  return parseFloat(ethers.formatUnits(BigInt(value), dec));
}

// GET /api/wallet/metadata?chain_id=1&address=0x...
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const chainId = searchParams.get('chain_id');
  const address = searchParams.get('address');

  if (!chainId) return NextResponse.json({ error: 'Missing: chain_id' }, { status: 400 });
  if (!address || !isValidEVMAddress(address)) {
    return NextResponse.json({ error: 'Missing or invalid: address' }, { status: 400 });
  }

  const apiKey  = process.env.ETHERSCAN_API_KEY;
  const baseUrl = ETHERSCAN_API_URLS[chainId];
  if (!apiKey || !baseUrl) {
    return NextResponse.json({ error: 'ETHERSCAN_API_KEY not set or chain not supported' }, { status: 500 });
  }

  const rpcUrl   = getRpcUrl(chainId);
  const platform = COINGECKO_PLATFORMS[chainId];
  const usdtAddr = VERIFIED_TOKENS.USDT[chainId];

  // ── Fetch everything in parallel ──────────────────────────────────────────
  const [
    firstTxData,
    lastTxData,
    txCountData,
    usdtTxData,
    nativeBalRaw,
    usdtBalRaw,
    ethPrice,
    usdtPrice,
  ] = await Promise.all([
    // Oldest tx (wallet creation date)
    etherscanGet(baseUrl, {
      module: 'account', action: 'txlist',
      address, sort: 'asc', page: '1', offset: '1',
      startblock: '0', endblock: '99999999',
    }, apiKey),

    // Most recent tx
    etherscanGet(baseUrl, {
      module: 'account', action: 'txlist',
      address, sort: 'desc', page: '1', offset: '1',
      startblock: '0', endblock: '99999999',
    }, apiKey),

    // Total tx count via proxy (eth_getTransactionCount)
    etherscanGet(baseUrl, {
      module: 'proxy', action: 'eth_getTransactionCount',
      address, tag: 'latest',
    }, apiKey),

    // USDT transfers summary (last 500)
    usdtAddr ? etherscanGet(baseUrl, {
      module: 'account', action: 'tokentx',
      address, contractaddress: usdtAddr,
      sort: 'asc', page: '1', offset: '500',
      startblock: '0', endblock: '99999999',
    }, apiKey) : Promise.resolve({ status: '0', result: [] }),

    // Native balance from RPC
    (async () => {
      if (!rpcUrl) return null;
      try {
        const p = new ethers.JsonRpcProvider(rpcUrl);
        return p.getBalance(address);
      } catch { return null; }
    })(),

    // USDT balance from RPC
    (async () => {
      if (!rpcUrl || !usdtAddr) return null;
      try {
        const p = new ethers.JsonRpcProvider(rpcUrl);
        const c = new ethers.Contract(usdtAddr, ERC20_ABI, p);
        return c.balanceOf(address) as Promise<bigint>;
      } catch { return null; }
    })(),

    // Native coin USD price
    (async () => {
      const coinId = NATIVE_COIN_IDS[chainId];
      if (!coinId) return null;
      try {
        const res = await fetch(`${COINGECKO}/simple/price?ids=${coinId}&vs_currencies=usd`);
        const d = await res.json();
        return d[coinId]?.usd ?? null;
      } catch { return null; }
    })(),

    // USDT USD price
    (async () => {
      if (!platform || !usdtAddr) return null;
      try {
        const res = await fetch(
          `${COINGECKO}/simple/token_price/${platform}?contract_addresses=${usdtAddr.toLowerCase()}&vs_currencies=usd`
        );
        const d = await res.json();
        return (d[usdtAddr.toLowerCase()] as { usd?: number })?.usd ?? null;
      } catch { return null; }
    })(),
  ]);

  // ── Parse first / last transaction ────────────────────────────────────────
  const firstTxArr = Array.isArray(firstTxData.result) ? firstTxData.result as EtherscanTx[] : [];
  const lastTxArr  = Array.isArray(lastTxData.result)  ? lastTxData.result  as EtherscanTx[] : [];
  const firstTx    = firstTxArr[0] ?? null;
  const lastTx     = lastTxArr[0]  ?? null;

  const firstTxDate = firstTx
    ? new Date(parseInt(firstTx.timeStamp, 10) * 1000).toISOString()
    : null;
  const lastTxDate  = lastTx
    ? new Date(parseInt(lastTx.timeStamp, 10) * 1000).toISOString()
    : null;

  // Wallet age in days
  const walletAgeDays = firstTxDate
    ? Math.floor((Date.now() - new Date(firstTxDate).getTime()) / 86_400_000)
    : null;

  // Total tx count (nonce = number of sent txs from this address)
  const nonce = typeof txCountData.result === 'string'
    ? parseInt(txCountData.result, 16)
    : null;

  // ── USDT analytics ─────────────────────────────────────────────────────────
  const usdtTxs = Array.isArray(usdtTxData.result) ? usdtTxData.result as EtherscanTokenTx[] : [];
  const addrLow = address.toLowerCase();

  let usdtTotalIn  = 0;
  let usdtTotalOut = 0;
  let usdtTxCount  = usdtTxs.length;

  for (const t of usdtTxs) {
    const amt = formatUsdt(t.value, t.tokenDecimal);
    if (t.to.toLowerCase() === addrLow)   usdtTotalIn  += amt;
    if (t.from.toLowerCase() === addrLow) usdtTotalOut += amt;
  }

  const firstUsdtDate = usdtTxs[0]
    ? new Date(parseInt(usdtTxs[0].timeStamp, 10) * 1000).toISOString()
    : null;

  // ── Balances ───────────────────────────────────────────────────────────────
  const nativeBalance    = nativeBalRaw ? ethers.formatEther(nativeBalRaw) : null;
  const nativeBalanceUsd = nativeBalance && ethPrice
    ? (parseFloat(nativeBalance) * ethPrice).toFixed(2) : null;

  const usdtBalance    = usdtBalRaw ? ethers.formatUnits(usdtBalRaw, 6) : null;
  const usdtBalanceUsd = usdtBalance && usdtPrice
    ? (parseFloat(usdtBalance) * usdtPrice).toFixed(2) : null;

  // ── Gas spent ──────────────────────────────────────────────────────────────
  // Estimate from last page of txs (rough, only over fetched txs)
  const allSentTxs = firstTxArr.concat(lastTxArr).filter(
    (t) => t.from.toLowerCase() === addrLow
  );
  const gasSpentEth = allSentTxs.reduce((sum, t) => {
    return sum + parseFloat(ethers.formatEther(
      BigInt(t.gasUsed) * BigInt(t.gasPrice)
    ));
  }, 0);

  return NextResponse.json({
    chain_id: chainId,
    address,

    profile: {
      first_tx_date:  firstTxDate,
      last_tx_date:   lastTxDate,
      wallet_age_days: walletAgeDays,
      tx_count_sent:  nonce,         // total txs sent (nonce)
      first_usdt_date: firstUsdtDate,
    },

    balances: {
      native: {
        balance:     nativeBalance,
        balance_usd: nativeBalanceUsd,
        price_usd:   ethPrice,
      },
      usdt: {
        balance:     usdtBalance,
        balance_usd: usdtBalanceUsd,
        contract:    usdtAddr ?? null,
        price_usd:   usdtPrice,
      },
    },

    usdt_activity: {
      total_received:  +usdtTotalIn.toFixed(2),
      total_sent:      +usdtTotalOut.toFixed(2),
      net:             +(usdtTotalIn - usdtTotalOut).toFixed(2),
      tx_count:        usdtTxCount,
      note: usdtTxCount >= 500 ? 'Showing last 500 txs only' : null,
    },

    gas: {
      estimated_eth_spent: +gasSpentEth.toFixed(8),
      estimated_usd_spent: ethPrice
        ? +(gasSpentEth * ethPrice).toFixed(2)
        : null,
      note: 'Estimated from sampled transactions only',
    },

    updated_at: new Date().toISOString(),
  });
}
