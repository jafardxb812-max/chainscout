import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import {
  VERIFIED_TOKENS,
  ETHERSCAN_API_URLS,
  fetchCoinAbout,
  getRpcUrl,
  ERC20_ABI,
  sleep,
} from '@/utils/wallet';

type RawTransfer = {
  hash: string;
  blockNumber: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimal: string;
  contractAddress: string;
  gasUsed: string;
  gasPrice: string;
};

async function fetchLatestCredit(
  address: string,
  chainId: string,
  apiKey: string
): Promise<(RawTransfer & { chain_id: string }) | null> {
  const baseUrl  = ETHERSCAN_API_URLS[chainId];
  const usdtAddr = VERIFIED_TOKENS.USDT[chainId];
  if (!baseUrl || !usdtAddr) return null;

  const url = new URL(baseUrl);
  url.searchParams.set('module', 'account');
  url.searchParams.set('action', 'tokentx');
  url.searchParams.set('address', address);
  url.searchParams.set('contractaddress', usdtAddr);
  url.searchParams.set('sort', 'desc');
  url.searchParams.set('page', '1');
  url.searchParams.set('offset', '20'); // check last 20 to find incoming
  url.searchParams.set('startblock', '0');
  url.searchParams.set('endblock', '99999999');
  url.searchParams.set('apikey', apiKey);

  try {
    const res  = await fetch(url.toString(), { next: { revalidate: 30 } });
    const data = await res.json();
    if (!Array.isArray(data.result)) return null;

    const incoming = (data.result as RawTransfer[]).find(
      (t) => t.to.toLowerCase() === address.toLowerCase()
    );
    return incoming ? { ...incoming, chain_id: chainId } : null;
  } catch {
    return null;
  }
}

async function getCurrentUsdtBalance(address: string, chainId: string): Promise<string> {
  const rpcUrl   = getRpcUrl(chainId);
  const usdtAddr = VERIFIED_TOKENS.USDT[chainId];
  if (!rpcUrl || !usdtAddr) return '0';
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const contract = new ethers.Contract(usdtAddr, ERC20_ABI, provider);
    const raw: bigint = await contract.balanceOf(address);
    return ethers.formatUnits(raw, 6);
  } catch {
    return '0';
  }
}

// GET /api/wallets/mine/credits/latest
// Returns the most recent USDT credit across all chains + full coin about
export async function GET() {
  const privateKey = process.env.WALLET_PRIVATE_KEY;
  const apiKey     = process.env.ETHERSCAN_API_KEY;

  if (!privateKey) return NextResponse.json({ error: 'WALLET_PRIVATE_KEY not set' }, { status: 500 });
  if (!apiKey)     return NextResponse.json({ error: 'ETHERSCAN_API_KEY not set' },  { status: 500 });

  const address  = new ethers.Wallet(privateKey).address;
  const chainIds = Object.keys(VERIFIED_TOKENS.USDT);
  const BATCH    = 3;

  // Scan all chains for the most recent incoming USDT credit
  const candidates: Array<RawTransfer & { chain_id: string }> = [];

  for (let i = 0; i < chainIds.length; i += BATCH) {
    const batch   = chainIds.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map((chainId) => fetchLatestCredit(address, chainId, apiKey))
    );
    for (const r of results) if (r) candidates.push(r);
    if (i + BATCH < chainIds.length) await sleep(250);
  }

  if (candidates.length === 0) {
    return NextResponse.json({
      wallet_address: address,
      latest_credit: null,
      message: 'No USDT credits found on any chain',
    });
  }

  // Pick the most recent credit across all chains
  candidates.sort((a, b) => parseInt(b.timeStamp, 10) - parseInt(a.timeStamp, 10));
  const latest = candidates[0];

  const dec    = parseInt(latest.tokenDecimal, 10) || 6;
  const amount = ethers.formatUnits(BigInt(latest.value), dec);

  // Fetch current balance on that chain + coin about in parallel
  const [currentBalance, coinAbout] = await Promise.all([
    getCurrentUsdtBalance(address, latest.chain_id),
    fetchCoinAbout('USDT', latest.chain_id, latest.contractAddress),
  ]);

  const gasFeeEth = ethers.formatEther(BigInt(latest.gasUsed) * BigInt(latest.gasPrice));

  return NextResponse.json({
    wallet_address: address,

    latest_credit: {
      tx_hash:        latest.hash,
      chain_id:       latest.chain_id,
      date:           new Date(parseInt(latest.timeStamp, 10) * 1000).toISOString(),
      amount:         amount,
      amount_usd:     coinAbout
        ? (parseFloat(amount) * coinAbout.market_data.price_usd).toFixed(2)
        : null,
      from:           latest.from,
      block_number:   parseInt(latest.blockNumber, 10),
      gas_fee_eth:    gasFeeEth,
    },

    current_balance: {
      usdt:     currentBalance,
      usdt_usd: coinAbout
        ? (parseFloat(currentBalance) * coinAbout.market_data.price_usd).toFixed(2)
        : null,
    },

    coin_about: coinAbout
      ? {
          name:                coinAbout.name,
          symbol:              coinAbout.symbol,
          logo:                coinAbout.logo,
          description:         coinAbout.description,
          price_usd:           coinAbout.market_data.price_usd,
          price_change_24h:    coinAbout.market_data.price_change_24h_pct,
          market_cap_usd:      coinAbout.market_data.market_cap_usd,
          total_supply:        coinAbout.market_data.total_supply,
          circulating_supply:  coinAbout.market_data.circulating_supply,
          max_supply:          coinAbout.market_data.max_supply,
          ath_usd:             coinAbout.market_data.ath_usd,
          website:             coinAbout.links.website,
          whitepaper:          coinAbout.links.whitepaper,
          genesis_date:        coinAbout.genesis_date,
        }
      : null,
  });
}
