'use client';

import { useState, useCallback } from 'react';
import { ethers } from 'ethers';
import {
  getLPRedemptionQuote,
  redeemLPTokens,
  applySlippage,
  ADDRESSES,
  getPairAddress,
  type LPRedemptionQuote,
} from '@/utils/pancakeswap-lp';

const SLIPPAGE_BPS = 50; // 0.5% default slippage

type Step = 'idle' | 'approving' | 'redeeming' | 'done' | 'error';

export default function LPRedemption() {
  const [wallet, setWallet] = useState('');
  const [lpToken, setLpToken] = useState('');
  const [quote, setQuote] = useState<LPRedemptionQuote | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [txHashes, setTxHashes] = useState<{ approveTx: string; redeemTx: string } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const connectWallet = useCallback(async () => {
    if (!window.ethereum) {
      setError('Wallet കണ്ടെത്തിയില്ല. MetaMask അല്ലെങ്കിൽ Trust Wallet (WalletConnect) install ചെയ്യുക.');
      return;
    }
    try {
      const accounts = (await window.ethereum.request({ method: 'eth_requestAccounts' })) as string[];
      if (accounts[0]) {
        setWallet(accounts[0]);
        setError('');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes('user rejected') || msg.includes('4001')) {
        setError('Connection request reject ചെയ്തു. Wallet-ൽ approve ചെയ്യുക.');
      } else {
        setError('Wallet connect ചെയ്യാൻ കഴിഞ്ഞില്ല: ' + msg);
      }
    }
  }, []);

  const fetchQuote = useCallback(async () => {
    if (!ethers.isAddress(wallet)) { setError('Enter a valid BSC wallet address'); return; }
    setError('');
    setLoading(true);
    try {
      const provider = new ethers.JsonRpcProvider('https://bsc-dataseed.binance.org/', 56);
      let pairAddress = lpToken.trim();
      if (!pairAddress) {
        pairAddress = await getPairAddress(ADDRESSES.USDT, ADDRESSES.WBNB, provider);
        setLpToken(pairAddress);
      }
      const q = await getLPRedemptionQuote(wallet, pairAddress, provider);
      setQuote(q);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [wallet, lpToken]);

  const redeem = useCallback(async () => {
    if (!quote || !window.ethereum) return;
    setError('');
    try {
      const browserProvider = new ethers.BrowserProvider(window.ethereum);
      const network = await browserProvider.getNetwork();
      if (network.chainId !== 56n) {
        try {
          await window.ethereum!.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x38' }],
          });
        } catch {
          throw new Error('BNB Smart Chain (BSC) network-ലേക്ക് switch ചെയ്യുക. Wallet-ൽ network change approve ചെയ്യുക.');
        }
      }
      const signer = await browserProvider.getSigner();

      const amount0Min = applySlippage(
        ethers.parseUnits(quote.amount0Out, quote.token0.decimals).toString(),
        SLIPPAGE_BPS,
      );
      const amount1Min = applySlippage(
        ethers.parseUnits(quote.amount1Out, quote.token1.decimals).toString(),
        SLIPPAGE_BPS,
      );

      setStep('approving');
      const result = await redeemLPTokens({
        lpTokenAddress: quote.lpTokenAddress,
        lpAmountRaw: quote.lpBalanceRaw,
        token0Address: quote.token0.address,
        token1Address: quote.token1.address,
        amount0Min,
        amount1Min,
        walletAddress: wallet,
        signer,
      });

      setTxHashes(result);
      setStep('done');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setStep('error');
    }
  }, [quote, wallet]);

  return (
    <div className="max-w-xl mx-auto mt-10 p-6 bg-white dark:bg-gray-900 rounded-2xl shadow-lg space-y-5">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
        PancakeSwap LP Token Redemption
      </h2>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Redeem your LP tokens back to the underlying tokens (e.g. USDT + WBNB) on BSC.
      </p>

      {/* Wallet */}
      <div className="space-y-1">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Wallet Address (BSC)
        </label>
        <div className="flex gap-2">
          <input
            className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="0x..."
            value={wallet}
            onChange={e => setWallet(e.target.value)}
          />
          <button
            onClick={connectWallet}
            className="px-3 py-2 rounded-lg bg-yellow-400 hover:bg-yellow-500 text-black text-sm font-semibold transition"
          >
            Connect
          </button>
        </div>
      </div>

      {/* LP Token */}
      <div className="space-y-1">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          LP Token Address{' '}
          <span className="text-gray-400 font-normal">(leave blank for USDT/WBNB pair)</span>
        </label>
        <input
          className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="0x... (optional)"
          value={lpToken}
          onChange={e => setLpToken(e.target.value)}
        />
      </div>

      <button
        onClick={fetchQuote}
        disabled={loading}
        className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold transition"
      >
        {loading ? 'Fetching quote…' : 'Get Redemption Quote'}
      </button>

      {/* Quote */}
      {quote && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
          <h3 className="font-semibold text-gray-800 dark:text-gray-200">Redemption Quote</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <span className="text-gray-500">LP Balance</span>
            <span className="font-mono text-right text-gray-900 dark:text-white">
              {Number(quote.lpBalance).toFixed(8)} LP
            </span>
            <span className="text-gray-500">Pool Share</span>
            <span className="font-mono text-right text-gray-900 dark:text-white">
              {quote.sharePercent}%
            </span>
            <span className="text-gray-500">You receive ({quote.token0.symbol})</span>
            <span className="font-mono text-right text-gray-900 dark:text-white">
              {Number(quote.amount0Out).toLocaleString(undefined, { maximumFractionDigits: 6 })}
            </span>
            <span className="text-gray-500">You receive ({quote.token1.symbol})</span>
            <span className="font-mono text-right text-gray-900 dark:text-white">
              {Number(quote.amount1Out).toLocaleString(undefined, { maximumFractionDigits: 6 })}
            </span>
          </div>

          {step === 'idle' || step === 'error' ? (
            <button
              onClick={redeem}
              disabled={quote.lpBalanceRaw === '0'}
              className="w-full py-2 rounded-lg bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-semibold transition"
            >
              {quote.lpBalanceRaw === '0' ? 'No LP tokens to redeem' : 'Approve & Redeem LP Tokens'}
            </button>
          ) : step === 'approving' ? (
            <div className="text-center text-sm text-yellow-600 font-medium animate-pulse">
              Step 1/2 — Approving LP tokens…
            </div>
          ) : step === 'redeeming' ? (
            <div className="text-center text-sm text-blue-600 font-medium animate-pulse">
              Step 2/2 — Removing liquidity…
            </div>
          ) : null}
        </div>
      )}

      {/* Success */}
      {step === 'done' && txHashes && (
        <div className="rounded-xl border border-green-400 bg-green-50 dark:bg-green-950 p-4 space-y-2 text-sm">
          <p className="font-semibold text-green-700 dark:text-green-300">Redemption successful!</p>
          <p className="text-gray-600 dark:text-gray-400 break-all">
            Approve TX:{' '}
            <a
              href={`https://bscscan.com/tx/${txHashes.approveTx}`}
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 underline"
            >
              {txHashes.approveTx}
            </a>
          </p>
          <p className="text-gray-600 dark:text-gray-400 break-all">
            Redeem TX:{' '}
            <a
              href={`https://bscscan.com/tx/${txHashes.redeemTx}`}
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 underline"
            >
              {txHashes.redeemTx}
            </a>
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950 p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}
