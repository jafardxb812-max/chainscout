// TRON network utilities (TRC20 USDT support)
// TRON uses different address format (T...) and is NOT EVM compatible

export const TRON_USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
export const TRON_API_BASE      = 'https://api.trongrid.io';

// Validate TRC20 / TRON address (starts with T, 34 chars, base58)
export function isValidTronAddress(address: string): boolean {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
}

// ChangeNow currency identifiers for cross-chain bridging
export const CHANGENOW_CURRENCIES: Record<string, string> = {
  'usdt-erc20': 'usdterc20',  // USDT on Ethereum
  'usdt-trc20': 'usdttrc20',  // USDT on TRON
  'usdt-bep20': 'usdtbsc',    // USDT on BSC
  'usdt-polygon': 'usdtmatic',
  'usdt-arbitrum': 'usdtarb',
  'usdt-avax':    'usdtavax',
  'eth':          'eth',
  'bnb':          'bnb',
  'trx':          'trx',
};

// Fetch TRC20 USDT balance from TronGrid public API (no key needed)
export async function getTrc20Balance(tronAddress: string): Promise<string | null> {
  if (!isValidTronAddress(tronAddress)) return null;
  try {
    const res = await fetch(
      `${TRON_API_BASE}/v1/accounts/${tronAddress}`,
      { headers: { Accept: 'application/json' }, next: { revalidate: 30 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const trc20 = data.data?.[0]?.trc20 ?? [];
    const usdtEntry = trc20.find(
      (t: Record<string, string>) => Object.keys(t)[0] === TRON_USDT_CONTRACT
    );
    if (!usdtEntry) return '0';
    const raw = usdtEntry[TRON_USDT_CONTRACT];
    // USDT on TRON has 6 decimals
    const value = BigInt(raw);
    const divisor = BigInt(1_000_000);
    const whole = value / divisor;
    const frac  = (value % divisor).toString().padStart(6, '0').replace(/0+$/, '');
    return frac ? `${whole}.${frac}` : `${whole}`;
  } catch {
    return null;
  }
}

// Fetch recent TRC20 USDT transactions for a TRON address
export async function getTrc20Transactions(
  tronAddress: string,
  limit = 20
): Promise<unknown[]> {
  if (!isValidTronAddress(tronAddress)) return [];
  try {
    const res = await fetch(
      `${TRON_API_BASE}/v1/accounts/${tronAddress}/transactions/trc20` +
      `?contract_address=${TRON_USDT_CONTRACT}&limit=${limit}&order_by=block_timestamp,desc`,
      { headers: { Accept: 'application/json' }, next: { revalidate: 30 } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.data ?? [];
  } catch {
    return [];
  }
}
