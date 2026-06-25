import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import {
  ETHERSCAN_API_URLS,
  VERIFIED_TOKENS,
  getRpcUrl,
  sleep,
  getSenderPrivateKey,
} from '@/utils/wallet';

// Blockchain proof of wallet origin.
// Everything here is cryptographically verifiable on-chain — no trust needed.

type FirstTxProof = {
  chain_id: string;
  tx_hash: string;            // immutable — verify on Etherscan
  block_number: number;
  block_hash: string | null;  // block hash = cryptographic fingerprint
  block_timestamp: string;    // when wallet first appeared on this chain
  from: string;
  to: string | null;
  value_eth: string;
  role: 'sender' | 'receiver'; // was this wallet the sender or receiver of first tx?
  etherscan_url: string;
};

async function getFirstTx(
  address: string,
  chainId: string,
  apiKey: string,
  role: 'sender' | 'both'
): Promise<{ hash: string; blockNumber: string; timeStamp: string; from: string; to: string; value: string } | null> {
  const baseUrl = ETHERSCAN_API_URLS[chainId];
  if (!baseUrl) return null;

  const url = new URL(baseUrl);
  url.searchParams.set('module', 'account');
  url.searchParams.set('action', 'txlist');
  url.searchParams.set('address', address);
  url.searchParams.set('startblock', '0');
  url.searchParams.set('endblock', '99999999');
  url.searchParams.set('sort', 'asc');     // oldest first
  url.searchParams.set('page', '1');
  url.searchParams.set('offset', '10');    // first 10, pick earliest
  url.searchParams.set('apikey', apiKey);

  try {
    const res  = await fetch(url.toString(), { next: { revalidate: 3600 } });
    const data = await res.json();
    if (!Array.isArray(data.result) || data.result.length === 0) return null;

    if (role === 'sender') {
      return data.result.find(
        (t: { from: string }) => t.from.toLowerCase() === address.toLowerCase()
      ) ?? null;
    }
    return data.result[0];
  } catch {
    return null;
  }
}

async function getBlockHash(chainId: string, blockNumber: number): Promise<string | null> {
  const rpcUrl = getRpcUrl(chainId);
  if (!rpcUrl) return null;
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const block    = await provider.getBlock(blockNumber);
    return block?.hash ?? null;
  } catch {
    return null;
  }
}

function etherscanBaseForChain(chainId: string): string {
  const map: Record<string, string> = {
    '1':     'https://etherscan.io',
    '10':    'https://optimistic.etherscan.io',
    '56':    'https://bscscan.com',
    '137':   'https://polygonscan.com',
    '42161': 'https://arbiscan.io',
    '43114': 'https://snowscan.xyz',
    '8453':  'https://basescan.org',
    '324':   'https://explorer.zksync.io',
  };
  return map[chainId] ?? 'https://etherscan.io';
}

// GET /api/wallets/mine/proof
export async function GET() {
  const privateKey = getSenderPrivateKey();
  const apiKey     = process.env.ETHERSCAN_API_KEY;

  if (!privateKey) {
    return NextResponse.json({ error: 'SENDER_WALLET_PRIVATE_KEY not set' }, { status: 500 });
  }
  if (!apiKey) {
    return NextResponse.json({ error: 'ETHERSCAN_API_KEY not set' }, { status: 500 });
  }

  // ── 1. Cryptographic wallet identity (derived from private key) ───────────
  const signingKey  = new ethers.SigningKey(privateKey);
  const pubKeyFull  = signingKey.publicKey;           // 65-byte uncompressed
  const pubKeyComp  = signingKey.compressedPublicKey; // 33-byte compressed
  const wallet      = new ethers.Wallet(privateKey);
  const address     = wallet.address;                 // EIP-55 checksummed
  const addressLow  = address.toLowerCase();

  // ── 2. Find first transaction on every chain ──────────────────────────────
  const chainIds  = Object.keys(VERIFIED_TOKENS.USDT);
  const proofs: FirstTxProof[] = [];
  const BATCH = 3;

  for (let i = 0; i < chainIds.length; i += BATCH) {
    const batch = chainIds.slice(i, i + BATCH);

    const results = await Promise.all(
      batch.map(async (chainId) => {
        const tx = await getFirstTx(address, chainId, apiKey, 'both');
        if (!tx) return null;

        const blockNum  = parseInt(tx.blockNumber, 10);
        const blockHash = await getBlockHash(chainId, blockNum);
        const isSender  = tx.from.toLowerCase() === addressLow;

        return {
          chain_id:        chainId,
          tx_hash:         tx.hash,
          block_number:    blockNum,
          block_hash:      blockHash,                // cryptographic proof
          block_timestamp: new Date(parseInt(tx.timeStamp, 10) * 1000).toISOString(),
          from:            tx.from,
          to:              tx.to || null,
          value_eth:       ethers.formatEther(BigInt(tx.value)),
          role:            isSender ? 'sender' : 'receiver',
          etherscan_url:   `${etherscanBaseForChain(chainId)}/tx/${tx.hash}`,
        } satisfies FirstTxProof;
      })
    );

    for (const r of results) if (r) proofs.push(r);
    if (i + BATCH < chainIds.length) await sleep(250);
  }

  // Sort by earliest appearance
  proofs.sort(
    (a, b) => new Date(a.block_timestamp).getTime() - new Date(b.block_timestamp).getTime()
  );

  const firstAppearance = proofs[0] ?? null;

  // ── 3. Sign a proof message (self-verifiable) ─────────────────────────────
  // Anyone can verify this signature proves the server owns this private key
  const proofMessage = `Chainscout wallet proof | address:${address} | timestamp:${new Date().toISOString()}`;
  const signature    = await wallet.signMessage(proofMessage);

  return NextResponse.json({
    // ── Identity ─────────────────────────────────────────────────────────
    identity: {
      address,                        // EIP-55 checksummed
      address_lowercase: addressLow,
      public_key: {
        uncompressed: pubKeyFull,
        compressed:   pubKeyComp,
      },
    },

    // ── Cryptographic self-proof ─────────────────────────────────────────
    // Verify with: ethers.verifyMessage(proof_message, signature) === address
    self_proof: {
      message:   proofMessage,
      signature,
      verify_with: 'ethers.verifyMessage(message, signature) === address',
    },

    // ── Blockchain history ────────────────────────────────────────────────
    blockchain_history: {
      first_appearance: firstAppearance
        ? {
            chain_id:        firstAppearance.chain_id,
            date:            firstAppearance.block_timestamp,
            tx_hash:         firstAppearance.tx_hash,
            block_number:    firstAppearance.block_number,
            block_hash:      firstAppearance.block_hash,   // immutable on-chain
            role:            firstAppearance.role,
            etherscan_url:   firstAppearance.etherscan_url,
          }
        : null,
      total_chains_active: proofs.length,
      per_chain:           proofs,
    },

    // ── How to verify independently ───────────────────────────────────────
    verification_guide: {
      step1: `Go to etherscan_url of any tx listed above — tx is publicly verifiable`,
      step2: `block_hash confirms the block is immutable — check on any Ethereum node`,
      step3: `Run: ethers.verifyMessage("${proofMessage}", "<signature>") — should return ${address}`,
    },

    generated_at: new Date().toISOString(),
  });
}
