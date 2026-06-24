import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import {
  VERIFIED_TOKENS,
  ETHERSCAN_API_URLS,
  COINGECKO_PLATFORMS,
  getRpcUrl,
  ERC20_ABI,
  sleep,
} from '@/utils/wallet';

const COINGECKO = 'https://api.coingecko.com/api/v3';

type UsdtTransfer = {
  hash: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  tokenDecimal: string;
  tokenSymbol: string;
  contractAddress: string;
};

type ChainCredit = {
  chain_id: string;
  usdt_contract: string;
  current_balance: string;
  current_balance_usd: string | null;
  total_received: string;        // all-time USDT credited
  total_received_usd: string | null;
  total_sent: string;
  incoming_tx_count: number;
  last_credit: {
    hash: string;
    amount: string;
    from: string;
    date: string;
  } | null;
};

function formatUsdt(value: string, decimal: string): number {
  const dec = parseInt(decimal, 10) || 6;
  return parseFloat(ethers.formatUnits(BigInt(value), dec));
}

async function fetchUsdtTransfers(
  address: string,
  chainId: string,
  apiKey: string
): Promise<UsdtTransfer[]> {
  const baseUrl    = ETHERSCAN_API_URLS[chainId];
  const usdtAddr   = VERIFIED_TOKENS.USDT[chainId];
  if (!baseUrl || !usdtAddr) return [];

  const url = new URL(baseUrl);
  url.searchParams.set('module', 'account');
  url.searchParams.set('action', 'tokentx');
  url.searchParams.set('address', address);
  url.searchParams.set('contractaddress', usdtAddr);
  url.searchParams.set('startblock', '0');
  url.searchParams.set('endblock', '99999999');
  url.searchParams.set('sort', 'desc');
  url.searchParams.set('offset', '500');
  url.searchParams.set('page', '1');
  url.searchParams.set('apikey', apiKey);

  try {
    const res  = await fetch(url.toString(), { next: { revalidate: 60 } });
    const data = await res.json();
    return Array.isArray(data.result) ? data.result : [];
  } catch {
    return [];
  }
}

async function getCurrentUsdtBalance(
  address: string,
  chainId: string
): Promise<string | null> {
  const rpcUrl   = getRpcUrl(chainId);
  const usdtAddr = VERIFIED_TOKENS.USDT[chainId];
  if (!rpcUrl || !usdtAddr) return null;
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const contract = new ethers.Contract(usdtAddr, ERC20_ABI, provider);
    const raw: bigint = await contract.balanceOf(address);
    return ethers.formatUnits(raw, 6);
  } catch {
    return null;
  }
}

async function fetchUsdtUsdPrice(chainId: string): Promise<number | null> {
  const platform = COINGECKO_PLATFORMS[chainId];
  const usdtAddr = VERIFIED_TOKENS.USDT[chainId];
  if (!platform || !usdtAddr) return null;
  try {
    const res  = await fetch(
      `${COINGECKO}/simple/token_price/${platform}?contract_addresses=${usdtAddr.toLowerCase()}&vs_currencies=usd`,
      { next: { revalidate: 60 } }
    );
    const data = await res.json();
    return (data[usdtAddr.toLowerCase()] as { usd?: number })?.usd ?? null;
  } catch {
    return null;
  }
}

// GET /api/wallets/mine/credits
// Shows total USDT credited (received) across all chains for the server wallet.
export async function GET() {
  const privateKey = process.env.WALLET_PRIVATE_KEY;
  const apiKey     = process.env.ETHERSCAN_API_KEY;

  if (!privateKey) {
    return NextResponse.json({ error: 'WALLET_PRIVATE_KEY not set' }, { status: 500 });
  }
  if (!apiKey) {
    return NextResponse.json({ error: 'ETHERSCAN_API_KEY not set' }, { status: 500 });
  }

  const address    = new ethers.Wallet(privateKey).address;
  const addrLower  = address.toLowerCase();
  const chainIds   = Object.keys(VERIFIED_TOKENS.USDT);
  const BATCH      = 3;

  const chainResults: ChainCredit[] = [];

  for (let i = 0; i < chainIds.length; i += BATCH) {
    const batch = chainIds.slice(i, i + BATCH);

    const results = await Promise.all(
      batch.map(async (chainId) => {
        const [transfers, balance, usdtUsd] = await Promise.all([
          fetchUsdtTransfers(address, chainId, apiKey),
          getCurrentUsdtBalance(address, chainId),
          fetchUsdtUsdPrice(chainId),
        ]);

        const incoming = transfers.filter(
          (t) => t.to.toLowerCase() === addrLower
        );
        const outgoing = transfers.filter(
          (t) => t.from.toLowerCase() === addrLower
        );

        const totalIn  = incoming.reduce((s, t) => s + formatUsdt(t.value, t.tokenDecimal), 0);
        const totalOut = outgoing.reduce((s, t) => s + formatUsdt(t.value, t.tokenDecimal), 0);

        // Most recent incoming credit
        const lastCredit = incoming[0] ?? null;

        const balNum = balance ? parseFloat(balance) : 0;

        return {
          chain_id:             chainId,
          usdt_contract:        VERIFIED_TOKENS.USDT[chainId],
          current_balance:      balance ?? '0',
          current_balance_usd:  usdtUsd ? (balNum * usdtUsd).toFixed(2) : null,
          total_received:       totalIn.toFixed(2),
          total_received_usd:   usdtUsd ? (totalIn * usdtUsd).toFixed(2) : null,
          total_sent:           totalOut.toFixed(2),
          incoming_tx_count:    incoming.length,
          last_credit: lastCredit
            ? {
                hash:   lastCredit.hash,
                amount: formatUsdt(lastCredit.value, lastCredit.tokenDecimal).toFixed(2),
                from:   lastCredit.from,
                date:   new Date(parseInt(lastCredit.timeStamp, 10) * 1000).toISOString(),
              }
            : null,
        } satisfies ChainCredit;
      })
    );

    for (const r of results) {
      // Only include chains where some activity or balance exists
      if (parseFloat(r.total_received) > 0 || parseFloat(r.current_balance) > 0) {
        chainResults.push(r);
      }
    }

    if (i + BATCH < chainIds.length) await sleep(250);
  }

  // ── Grand totals ──────────────────────────────────────────────────────────
  const grandTotalReceived = chainResults
    .reduce((s, c) => s + parseFloat(c.total_received), 0)
    .toFixed(2);

  const grandTotalReceivedUsd = chainResults
    .reduce((s, c) => s + (c.total_received_usd ? parseFloat(c.total_received_usd) : 0), 0)
    .toFixed(2);

  const grandCurrentBalance = chainResults
    .reduce((s, c) => s + parseFloat(c.current_balance), 0)
    .toFixed(2);

  const grandCurrentBalanceUsd = chainResults
    .reduce((s, c) => s + (c.current_balance_usd ? parseFloat(c.current_balance_usd) : 0), 0)
    .toFixed(2);

  const totalIncomingTxs = chainResults
    .reduce((s, c) => s + c.incoming_tx_count, 0);

  // Most recent credit across all chains
  const allLastCredits = chainResults
    .filter((c) => c.last_credit !== null)
    .sort((a, b) =>
      new Date(b.last_credit!.date).getTime() - new Date(a.last_credit!.date).getTime()
    );

  return NextResponse.json({
    wallet_address: address,

    summary: {
      total_usdt_received:      grandTotalReceived,      // all-time credited
      total_usdt_received_usd:  grandTotalReceivedUsd,
      current_usdt_balance:     grandCurrentBalance,     // what's left now
      current_usdt_balance_usd: grandCurrentBalanceUsd,
      total_incoming_txs:       totalIncomingTxs,
      chains_with_activity:     chainResults.length,
      last_credit:              allLastCredits[0]?.last_credit ?? null,
    },

    by_chain: chainResults,
    updated_at: new Date().toISOString(),
  });
}
