import { NextRequest, NextResponse } from 'next/server';
import { ETHERSCAN_API_URLS, NATIVE_COIN_IDS, getWorkingProvider, fetchEtherscan } from '@/utils/wallet';

const COINGECKO = 'https://api.coingecko.com/api/v3';

// Typical gas units for common operations
const GAS_UNITS = {
  eth_transfer:    21_000,
  usdt_transfer:   65_000,
  erc20_transfer:  65_000,
  token_swap:     200_000,
  contract_deploy: 500_000,
};

async function getNativeUsdPrice(chainId: string): Promise<number | null> {
  const coinId = NATIVE_COIN_IDS[chainId];
  if (!coinId) return null;
  try {
    const res = await fetch(
      `${COINGECKO}/simple/price?ids=${coinId}&vs_currencies=usd`,
      { next: { revalidate: 60 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data[coinId]?.usd ?? null;
  } catch {
    return null;
  }
}

function gweiToUsd(gwei: number, gasUnits: number, ethUsd: number): string {
  // cost = gwei * gasUnits * 1e-9 ETH * ethUsd
  return (gwei * gasUnits * 1e-9 * ethUsd).toFixed(4);
}

function buildFeeTable(
  slow: number,
  standard: number,
  fast: number,
  ethUsd: number | null
) {
  return Object.entries(GAS_UNITS).map(([op, units]) => ({
    operation: op,
    gas_units: units,
    fee_gwei: {
      slow:     +(slow     * units * 1e-9).toFixed(8),
      standard: +(standard * units * 1e-9).toFixed(8),
      fast:     +(fast     * units * 1e-9).toFixed(8),
    },
    fee_usd: ethUsd
      ? {
          slow:     gweiToUsd(slow,     units, ethUsd),
          standard: gweiToUsd(standard, units, ethUsd),
          fast:     gweiToUsd(fast,     units, ethUsd),
        }
      : null,
  }));
}

// GET /api/wallet/gas?chain_id=1
export async function GET(req: NextRequest) {
  const chainId = req.nextUrl.searchParams.get('chain_id') ?? '1';

  const baseUrl = ETHERSCAN_API_URLS[chainId];

  // Fetch gas oracle + ETH price in parallel
  const [oracleData, ethUsd] = await Promise.all([
    // Etherscan gas oracle — uses key rotation + retry via fetchEtherscan
    (async () => {
      if (!baseUrl) return null;
      try {
        const data = await fetchEtherscan(baseUrl, {
          module: 'gastracker',
          action: 'gasoracle',
        }, { ttlMs: 15_000 }) as { status: string; result: Record<string, string> };
        if (data.status === '1' && data.result) return data.result as {
          SafeGasPrice: string;
          ProposeGasPrice: string;
          FastGasPrice: string;
          suggestBaseFee: string;
          gasUsedRatio: string;
        };
        return null;
      } catch { return null; }
    })(),
    getNativeUsdPrice(chainId),
  ]);

  // Fallback: read gas price directly from RPC if Etherscan oracle not available
  let slow = 0, standard = 0, fast = 0;
  let source = 'etherscan_oracle';

  if (oracleData) {
    slow     = parseFloat(oracleData.SafeGasPrice);
    standard = parseFloat(oracleData.ProposeGasPrice);
    fast     = parseFloat(oracleData.FastGasPrice);
  } else {
    source = 'rpc_estimate';
    const { ethers } = await import('ethers');
    const provider = await getWorkingProvider(chainId);
    if (provider) {
      try {
        const feeData  = await provider.getFeeData();
        const baseGwei = feeData.gasPrice
          ? parseFloat(ethers.formatUnits(feeData.gasPrice, 'gwei'))
          : 1;
        slow     = +(baseGwei * 0.9).toFixed(2);
        standard = +baseGwei.toFixed(2);
        fast     = +(baseGwei * 1.2).toFixed(2);
      } catch {
        return NextResponse.json(
          { error: `Could not fetch gas price for chain_id '${chainId}'` },
          { status: 502 }
        );
      }
    }
  }

  return NextResponse.json({
    chain_id: chainId,
    source,
    gas_price_gwei: {
      slow,
      standard,
      fast,
      base_fee: oracleData ? parseFloat(oracleData.suggestBaseFee) : null,
    },
    native_usd: ethUsd,
    fee_estimates: buildFeeTable(slow, standard, fast, ethUsd),
    updated_at: new Date().toISOString(),
  });
}
