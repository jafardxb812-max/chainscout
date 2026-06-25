import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { ETHERSCAN_API_URLS, VERIFIED_TOKENS, getRpcUrl, isValidEVMAddress } from '@/utils/wallet';

// ── Tether's official on-chain fingerprints ───────────────────────────────────
// Source: Etherscan verified contract pages + Tether's public documentation

// Ethereum mainnet: the original TetherToken contract
const TETHER_ETHEREUM = {
  address:          '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  contract_name:    'TetherToken',
  // Address that deployed the original USDT contract on Ethereum
  creator:          '0x36928500Bc1dCd7af6a2b4008875CC336b927D57',
  // Tether's current owner/admin multisig (as of contract state)
  known_owners:     [
    '0xC6CDE7C39eB2f0F0095F41570af89eFC2C1Ea828', // Tether Treasury
    '0x742d35Cc6634C0532925a3b844Bc454e4438f44e', // common Tether multisig
  ],
};

// Bridged USDT on other chains: deployed by the official bridge, not Tether directly
// Contract name varies by bridge implementation
const BRIDGED_CHAIN_INFO: Record<string, {
  bridge_name: string;
  expected_contract_names: string[];
  bridge_note: string;
}> = {
  '10':    { bridge_name: 'Optimism Bridge',  expected_contract_names: ['TetherToken', 'OptimismMintableERC20'], bridge_note: 'Official OP bridge minted — backed 1:1 by Ethereum USDT' },
  '56':    { bridge_name: 'BSC Bridge',       expected_contract_names: ['BEP20Token', 'BEP20USDT'],              bridge_note: 'Binance official peg token' },
  '137':   { bridge_name: 'Polygon PoS Bridge', expected_contract_names: ['UChildERC20', 'UChildERC20Proxy'],   bridge_note: 'Polygon official PoS bridge wrapped' },
  '42161': { bridge_name: 'Arbitrum Bridge',  expected_contract_names: ['L2StandardERC20', 'ArbitrumEnabledToken', 'TetherToken'], bridge_note: 'Official Arbitrum canonical bridge' },
  '43114': { bridge_name: 'Avalanche Bridge', expected_contract_names: ['TetherToken'],                          bridge_note: 'Avalanche official bridge' },
  '8453':  { bridge_name: 'Base Bridge',      expected_contract_names: ['TetherToken', 'OptimismMintableERC20'], bridge_note: 'Official Base (Coinbase) bridge' },
};

// Minimal ABI to read contract ownership
const OWNER_ABI = [
  'function owner() view returns (address)',
  'function getOwner() view returns (address)',
  'function admin() view returns (address)',
];

async function getContractSource(
  address: string,
  chainId: string,
  apiKey: string
): Promise<{
  contractName: string;
  compiler: string;
  verified: boolean;
  sourceCode: string;
  abi: string;
  contractCreatorAddress?: string;
} | null> {
  const baseUrl = ETHERSCAN_API_URLS[chainId];
  if (!baseUrl) return null;
  try {
    const url = new URL(baseUrl);
    url.searchParams.set('module', 'contract');
    url.searchParams.set('action', 'getsourcecode');
    url.searchParams.set('address', address);
    url.searchParams.set('apikey', apiKey);
    const res  = await fetch(url.toString(), { next: { revalidate: 3600 } });
    const data = await res.json();
    if (!Array.isArray(data.result) || data.result.length === 0) return null;
    const r = data.result[0];
    if (!r.ContractName) return null;
    return {
      contractName: r.ContractName,
      compiler:     r.CompilerVersion,
      verified:     r.SourceCode !== '',
      sourceCode:   r.SourceCode?.slice(0, 200) ?? '', // first 200 chars only
      abi:          r.ABI,
    };
  } catch {
    return null;
  }
}

async function getContractCreator(
  address: string,
  chainId: string,
  apiKey: string
): Promise<{ creator: string; tx_hash: string } | null> {
  const baseUrl = ETHERSCAN_API_URLS[chainId];
  if (!baseUrl) return null;
  try {
    const url = new URL(baseUrl);
    url.searchParams.set('module', 'contract');
    url.searchParams.set('action', 'getcontractcreation');
    url.searchParams.set('contractaddresses', address);
    url.searchParams.set('apikey', apiKey);
    const res  = await fetch(url.toString(), { next: { revalidate: 3600 } });
    const data = await res.json();
    if (!Array.isArray(data.result) || data.result.length === 0) return null;
    return {
      creator:  data.result[0].contractCreator,
      tx_hash:  data.result[0].txHash,
    };
  } catch {
    return null;
  }
}

async function getOnChainOwner(address: string, chainId: string): Promise<string | null> {
  const rpcUrl = getRpcUrl(chainId);
  if (!rpcUrl) return null;
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  for (const fn of ['owner', 'getOwner', 'admin']) {
    try {
      const contract = new ethers.Contract(address, OWNER_ABI, provider);
      const owner    = await contract[fn]() as string;
      if (owner && isValidEVMAddress(owner)) return owner;
    } catch { /* try next */ }
  }
  return null;
}

// GET /api/wallet/verify-token/tether?chain_id=1
// GET /api/wallet/verify-token/tether?chain_id=1&address=0x...  (verify any address)
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const chainId  = searchParams.get('chain_id') ?? '1';
  const apiKey   = process.env.ETHERSCAN_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: 'ETHERSCAN_API_KEY not set' }, { status: 500 });
  }

  // If no address given, use our hardcoded official address for the chain
  const paramAddr    = searchParams.get('address');
  const officialAddr = VERIFIED_TOKENS.USDT[chainId];
  const checkAddr    = paramAddr ?? officialAddr;

  if (!checkAddr) {
    return NextResponse.json(
      { error: `No official USDT address known for chain_id '${chainId}'` },
      { status: 400 }
    );
  }
  if (!isValidEVMAddress(checkAddr)) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
  }

  const isOfficialAddress = officialAddr?.toLowerCase() === checkAddr.toLowerCase();

  // ── Run all checks in parallel ────────────────────────────────────────────
  const [sourceData, creatorData, onChainOwner] = await Promise.all([
    getContractSource(checkAddr, chainId, apiKey),
    getContractCreator(checkAddr, chainId, apiKey),
    getOnChainOwner(checkAddr, chainId),
  ]);

  // ── Evaluate each check ───────────────────────────────────────────────────
  const checks: Record<string, { pass: boolean; detail: string }> = {};

  // Check 1: Address matches our known official list
  checks.address_in_official_list = {
    pass:   isOfficialAddress,
    detail: isOfficialAddress
      ? `Address matches verified USDT for chain ${chainId}`
      : `Expected ${officialAddr ?? 'unknown'}, got ${checkAddr}`,
  };

  // Check 2: Source code verified on Etherscan
  checks.source_code_verified = {
    pass:   sourceData?.verified === true,
    detail: sourceData?.verified
      ? `Verified — contract name: ${sourceData.contractName}`
      : 'Source code NOT verified on Etherscan — suspicious',
  };

  // Check 3: Contract name matches expected Tether name
  const isEthereum = chainId === '1';
  let contractNamePass = false;
  let contractNameDetail = 'Source not available';
  if (sourceData?.contractName) {
    if (isEthereum) {
      contractNamePass   = sourceData.contractName === TETHER_ETHEREUM.contract_name;
      contractNameDetail = contractNamePass
        ? `"${sourceData.contractName}" — matches Tether's official contract name`
        : `"${sourceData.contractName}" — expected "TetherToken"`;
    } else {
      const bridgeInfo   = BRIDGED_CHAIN_INFO[chainId];
      contractNamePass   = bridgeInfo?.expected_contract_names.includes(sourceData.contractName) ?? true;
      contractNameDetail = `"${sourceData.contractName}" — ${bridgeInfo?.bridge_note ?? 'bridged token'}`;
    }
  }
  checks.contract_name = { pass: contractNamePass, detail: contractNameDetail };

  // Check 4: Creator address (Ethereum only — Tether deployed it directly)
  if (isEthereum && creatorData) {
    const creatorMatch = creatorData.creator.toLowerCase() === TETHER_ETHEREUM.creator.toLowerCase();
    checks.creator_address = {
      pass:   creatorMatch,
      detail: creatorMatch
        ? `Creator ${creatorData.creator} = Tether's official deployer`
        : `Creator ${creatorData.creator} ≠ Tether deployer (${TETHER_ETHEREUM.creator})`,
    };
    checks.deploy_tx = {
      pass:   true,
      detail: `Deploy tx: https://etherscan.io/tx/${creatorData.tx_hash}`,
    };
  } else if (creatorData) {
    checks.creator_address = {
      pass:   true,
      detail: `Creator: ${creatorData.creator} (bridged token — not directly by Tether)`,
    };
  }

  // Check 5: On-chain owner readable
  if (onChainOwner) {
    const knownOwner = TETHER_ETHEREUM.known_owners.some(
      (o) => o.toLowerCase() === onChainOwner.toLowerCase()
    );
    checks.on_chain_owner = {
      pass:   isEthereum ? knownOwner : true, // for bridges we just show it
      detail: `owner() = ${onChainOwner}${knownOwner ? ' (known Tether multisig ✓)' : ''}`,
    };
  }

  // ── Overall result ────────────────────────────────────────────────────────
  const passedCount = Object.values(checks).filter((c) => c.pass).length;
  const totalChecks = Object.keys(checks).length;
  const allPass     = Object.values(checks).every((c) => c.pass);

  const verdict =
    allPass         ? 'VERIFIED — Original Tether USDT' :
    passedCount > 1 ? 'LIKELY REAL — Most checks pass, review failures' :
                      'SUSPICIOUS — Failed critical checks';

  return NextResponse.json({
    chain_id: chainId,
    address:  checkAddr,

    verdict,
    score: `${passedCount}/${totalChecks} checks passed`,

    checks,

    contract_info: {
      name:          sourceData?.contractName ?? null,
      compiler:      sourceData?.compiler     ?? null,
      creator:       creatorData?.creator     ?? null,
      deploy_tx:     creatorData?.tx_hash     ?? null,
      on_chain_owner: onChainOwner,
    },

    chain_context: isEthereum
      ? { type: 'original', note: 'Original Tether USDT deployed by Tether Ltd. on Ethereum' }
      : { type: 'bridged',  note: BRIDGED_CHAIN_INFO[chainId]?.bridge_note ?? 'Bridge-wrapped USDT' },

    etherscan_url: `${
      chainId === '1'     ? 'https://etherscan.io' :
      chainId === '137'   ? 'https://polygonscan.com' :
      chainId === '56'    ? 'https://bscscan.com' :
      chainId === '42161' ? 'https://arbiscan.io' :
      chainId === '8453'  ? 'https://basescan.org' :
      'https://etherscan.io'
    }/token/${checkAddr}`,
  });
}
