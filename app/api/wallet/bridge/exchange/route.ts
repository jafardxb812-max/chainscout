import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { CHANGENOW_CURRENCIES, isValidTronAddress } from '@/utils/tron';
import {
  isValidEVMAddress,
  getRpcUrl,
  VERIFIED_TOKENS,
  ERC20_ABI,
} from '@/utils/wallet';

const CHANGENOW = 'https://api.changenow.io/v2';

// POST /api/wallet/bridge/exchange
// Body: {
//   from: "usdt-erc20",
//   to:   "usdt-trc20",
//   amount: "100",
//   recipient_address: "T..."   ← TRC20 address to receive on TRON
//   chain_id: "1"               ← source EVM chain
// }
//
// Flow:
//   1. ChangeNow creates an exchange order → gives a deposit address (EVM)
//   2. We send USDT from WALLET_PRIVATE_KEY to that deposit address
//   3. ChangeNow converts and sends TRC20 USDT to recipient_address on TRON
export async function POST(req: NextRequest) {
  const privateKey = process.env.WALLET_PRIVATE_KEY;
  const apiKey     = process.env.CHANGENOW_API_KEY;

  if (!privateKey) return NextResponse.json({ error: 'WALLET_PRIVATE_KEY not set' }, { status: 500 });
  if (!apiKey)     return NextResponse.json({ error: 'CHANGENOW_API_KEY not set' },  { status: 500 });

  let body: {
    from?: string;
    to?: string;
    amount?: string;
    recipient_address?: string;
    chain_id?: string;
  };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { from, to, amount, recipient_address, chain_id = '1' } = body;

  if (!from || !to || !amount || !recipient_address) {
    return NextResponse.json(
      { error: 'Required: from, to, amount, recipient_address' },
      { status: 400 }
    );
  }

  // Validate recipient address based on destination network
  const isTronDest = to?.toLowerCase().includes('trc20') || to?.toLowerCase() === 'trx';
  if (isTronDest && !isValidTronAddress(recipient_address)) {
    return NextResponse.json(
      { error: 'recipient_address must be a valid TRON address (starts with T, 34 chars) for TRC20 destination' },
      { status: 400 }
    );
  }
  if (!isTronDest && !isValidEVMAddress(recipient_address)) {
    return NextResponse.json(
      { error: 'recipient_address must be a valid EVM address (0x...) for EVM destination' },
      { status: 400 }
    );
  }

  const fromCurrency = CHANGENOW_CURRENCIES[from.toLowerCase()];
  const toCurrency   = CHANGENOW_CURRENCIES[to.toLowerCase()];
  if (!fromCurrency || !toCurrency) {
    return NextResponse.json({ error: `Unknown from/to token. Check /api/wallet/bridge/quote for valid values` }, { status: 400 });
  }

  const senderWallet = new ethers.Wallet(privateKey);
  const senderAddress = senderWallet.address;

  // ── Step 1: Create ChangeNow exchange order ────────────────────────────────
  const createRes = await fetch(`${CHANGENOW}/exchange`, {
    method:  'POST',
    headers: {
      'x-changenow-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      fromCurrency,
      toCurrency,
      fromAmount:       parseFloat(amount),
      fromNetwork:      fromCurrency,
      toNetwork:        toCurrency,
      toAddress:        recipient_address,  // TRON address receiving TRC20 USDT
      refundAddress:    senderAddress,      // EVM address for refund if bridge fails
      flow:             'standard',
      type:             'direct',
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    return NextResponse.json({ error: `ChangeNow order failed: ${err}` }, { status: 502 });
  }

  const order: {
    id: string;
    payinAddress: string;    // we send USDT HERE on Ethereum
    payinAmount: string;
    payoutAmount: string;
    validUntil: string;
  } = await createRes.json();

  // ── Step 2: Send USDT from our wallet to ChangeNow deposit address ─────────
  const rpcUrl   = getRpcUrl(chain_id);
  const usdtAddr = VERIFIED_TOKENS.USDT[chain_id];

  if (!rpcUrl || !usdtAddr) {
    return NextResponse.json(
      {
        order_created: true,
        order_id:      order.id,
        deposit_address: order.payinAddress,
        deposit_amount:  order.payinAmount,
        warning: `Auto-send not possible for chain ${chain_id}. Manually send ${order.payinAmount} USDT to ${order.payinAddress}`,
      },
      { status: 202 }
    );
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet   = senderWallet.connect(provider);
  const contract = new ethers.Contract(usdtAddr, ERC20_ABI, wallet);

  // Verify balance
  const [rawBalance, decimals]: [bigint, number] = await Promise.all([
    contract.balanceOf(senderAddress),
    contract.decimals(),
  ]);
  const sendAmount = ethers.parseUnits(amount, decimals);
  if (rawBalance < sendAmount) {
    return NextResponse.json({
      error: `Insufficient USDT. Have: ${ethers.formatUnits(rawBalance, decimals)}, need: ${amount}`,
      order_id: order.id,
      note: 'ChangeNow order created but not funded. Fund manually or cancel.',
    }, { status: 400 });
  }

  // Send USDT to ChangeNow deposit address
  const tx      = await contract.transfer(order.payinAddress, sendAmount);
  const receipt = await tx.wait();

  return NextResponse.json({
    success: true,

    bridge_order: {
      id:              order.id,
      from:            `${amount} USDT (ERC20 on chain ${chain_id})`,
      to:              `~${order.payoutAmount} USDT (TRC20 on TRON)`,
      recipient:       recipient_address,
      valid_until:     order.validUntil,
      track_url:       `https://changenow.io/exchange/txs/${order.id}`,
    },

    send_tx: {
      hash:         tx.hash,
      from:         senderAddress,
      to:           order.payinAddress,
      amount:       amount,
      block_number: receipt?.blockNumber ?? null,
      status:       receipt?.status === 1 ? 'confirmed' : 'failed',
    },

    note: 'ChangeNow will convert ERC20 USDT → TRC20 USDT and send to your TRON address. Usually takes 5-30 minutes.',
  });
}
