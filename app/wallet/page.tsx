'use client';

import { useState, useEffect } from 'react';
import { useAppKit } from '@reown/appkit/react';
import {
  useAccount, useDisconnect, useWriteContract, useSendTransaction,
  useBalance, useReadContract, useChainId, useSwitchChain,
} from 'wagmi';
import { parseUnits, parseEther, formatUnits, formatEther, parseGwei } from 'viem';
import { walletConnectEnabled } from '@/app/web3-providers';

// USDT contract addresses — only chains with working Etherscan v2 API
const USDT_ADDRESSES: Record<string, `0x${string}`> = {
  '1':     '0xdAC17F958D2ee523a2206206994597C13D831ec7', // Ethereum
  '137':   '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', // Polygon
  '42161': '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // Arbitrum
};

// USDC contract addresses
const USDC_ADDRESSES: Record<string, `0x${string}`> = {
  '1':     '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // Ethereum
  '137':   '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // Polygon
  '42161': '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', // Arbitrum
};

const ERC20_TRANSFER_ABI = [{
  name: 'transfer',
  type: 'function' as const,
  stateMutability: 'nonpayable' as const,
  inputs: [
    { name: 'to',    type: 'address' },
    { name: 'value', type: 'uint256' },
  ],
  outputs: [{ type: 'bool' }],
}];

const ERC20_BALANCE_ABI = [{
  name: 'balanceOf',
  type: 'function' as const,
  stateMutability: 'view' as const,
  inputs: [{ name: 'account', type: 'address' }],
  outputs: [{ name: '', type: 'uint256' }],
}];

// Only chains supported by Etherscan v2 API with a standard key
const CHAINS = [
  { id: '1',     name: 'Ethereum Mainnet' },
  { id: '137',   name: 'Polygon' },
  { id: '42161', name: 'Arbitrum One' },
];

type Tab = 'balance' | 'usdt' | 'send' | 'server' | 'bridge' | 'swap' | 'gas' | 'txs';
type SendToken = 'USDT' | 'ETH';
type GasSpeed = 'slow' | 'standard' | 'fast';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>;

function shortAddr(a: string) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
}
function fmtTime(ts: string) {
  const n = parseInt(ts, 10);
  if (!n) return '';
  return new Date(n * 1000).toLocaleString();
}
function apiErr(data: AnyObj): string | null {
  if (!data) return 'Empty response';
  if (typeof data.error === 'string') return data.error;
  if (typeof data.error === 'object' && data.error !== null) return JSON.stringify(data.error);
  return null;
}

const TOKENS = ['ETH', 'USDT', 'USDC', 'WETH'];

const TABS: { id: Tab; label: string; usdt?: boolean; swap?: boolean; server?: boolean }[] = [
  { id: 'balance', label: 'Balance' },
  { id: 'usdt',    label: 'USDT History', usdt: true },
  { id: 'send',    label: 'Send (MetaMask)', usdt: true },
  { id: 'server',  label: 'Server Wallet',  server: true },
  { id: 'bridge',  label: 'Bridge →TRC20',  usdt: true },
  { id: 'swap',    label: 'Swap',           swap: true },
  { id: 'gas',     label: 'Gas Prices' },
  { id: 'txs',     label: 'Transactions' },
];

// Isolated component so useAppKit hook is only called when AppKit is initialised
function ConnectButton() {
  const { open } = useAppKit();
  return (
    <button onClick={() => open()}
      style={{ width: '100%', padding: '10px', borderRadius: 8, border: '1px solid #2563eb', background: '#eff6ff', color: '#2563eb', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>
      </svg>
      Connect Wallet (MetaMask / Trust Wallet / WalletConnect)
    </button>
  );
}

// Reads balances directly from MetaMask — no server RPC needed
function BalancePanel({ address, chainId, token }: { address: string; chainId: string; token: string }) {
  const walletAddr = address ? (address as `0x${string}`) : undefined;

  const { data: ethBal, isLoading: ethLoading } = useBalance({
    address: walletAddr,
  });

  const usdtAddr = USDT_ADDRESSES[chainId];
  const usdcAddr = USDC_ADDRESSES[chainId];
  const tokenAddr = token === 'USDT' ? usdtAddr : token === 'USDC' ? usdcAddr : undefined;

  const { data: tokenBal, isLoading: tokenLoading } = useReadContract({
    address: tokenAddr,
    abi: ERC20_BALANCE_ABI,
    functionName: 'balanceOf',
    args: walletAddr ? [walletAddr] : undefined,
    query: { enabled: !!tokenAddr && !!walletAddr },
  });

  const card: React.CSSProperties = {
    background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 20, marginBottom: 16,
  };

  if (!walletAddr) {
    return (
      <div style={{ ...card, textAlign: 'center', color: '#94a3b8', fontSize: 14, padding: '32px 20px' }}>
        Connect your wallet above to see balance
      </div>
    );
  }

  if (token === 'ETH' || token === 'WETH') {
    const val = ethBal ? parseFloat(formatEther(ethBal.value)).toFixed(6) : '–';
    const sym = ethBal?.symbol ?? 'ETH';
    return (
      <div style={card}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
          {sym} Balance · {CHAINS.find(c => c.id === chainId)?.name ?? `Chain ${chainId}`}
        </div>
        <div style={{ fontSize: 30, fontWeight: 700, color: '#1e293b' }}>
          {ethLoading ? 'Loading…' : val}{' '}
          <span style={{ fontSize: 16, color: '#94a3b8' }}>{sym}</span>
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>
          Live · reads from connected wallet
        </div>
      </div>
    );
  }

  const decimals = 6;
  const formatted = tokenBal !== undefined ? parseFloat(formatUnits(tokenBal as bigint, decimals)).toFixed(2) : '–';
  const contractAddr = token === 'USDT' ? usdtAddr : usdcAddr;

  return (
    <div style={card}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#0d9488', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
        {token} Balance · {CHAINS.find(c => c.id === chainId)?.name ?? `Chain ${chainId}`}
      </div>
      {!contractAddr ? (
        <div style={{ color: '#94a3b8', fontSize: 14 }}>{token} not available on this chain</div>
      ) : (
        <>
          <div style={{ fontSize: 30, fontWeight: 700, color: '#1e293b' }}>
            {tokenLoading ? 'Loading…' : formatted}{' '}
            <span style={{ fontSize: 16, color: '#94a3b8' }}>{token}</span>
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>
            Live · reads from connected wallet
          </div>
        </>
      )}
    </div>
  );
}

function GasSpeedPicker({ value, onChange, liveGas, color = '#2563eb' }: {
  value: GasSpeed;
  onChange: (s: GasSpeed) => void;
  liveGas: { slow: number; standard: number; fast: number } | null;
  color?: string;
}) {
  const opts: [GasSpeed, string][] = [['slow', '🐢 Slow'], ['standard', '⚡ Standard'], ['fast', '🚀 Fast']];
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {opts.map(([speed, lbl]) => (
        <button key={speed} onClick={() => onChange(speed)}
          style={{ flex: 1, padding: '7px 4px', borderRadius: 8, border: `2px solid ${value === speed ? color : '#e2e8f0'}`, background: value === speed ? `${color}18` : '#fff', color: value === speed ? color : '#64748b', fontSize: 11, fontWeight: 600, cursor: 'pointer', lineHeight: 1.4 }}>
          <div>{lbl}</div>
          {liveGas && <div style={{ fontSize: 10, opacity: 0.75 }}>{liveGas[speed]} Gwei</div>}
        </button>
      ))}
    </div>
  );
}

export default function WalletPage() {
  const { address: connectedAddress, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();
  const connectedChainId = useChainId();
  const { switchChain } = useSwitchChain();

  const [address,  setAddress]  = useState('');
  const [chainId,  setChainId]  = useState('1');
  const [tab,      setTab]      = useState<Tab>('balance');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  // balance tab
  const [token, setToken] = useState('USDT');

  // usdt history tab
  const [usdtTxs, setUsdtTxs] = useState<AnyObj[]>([]);

  // send tab
  const [sendToken,    setSendToken]    = useState<SendToken>('USDT');
  const [sendTo,       setSendTo]       = useState('');
  const [sendAmount,   setSendAmount]   = useState('');
  const [sendResult,   setSendResult]   = useState<AnyObj | null>(null);
  const [sendGasSpeed, setSendGasSpeed] = useState<GasSpeed>('standard');

  // bridge tab
  const [bridgeTo,     setBridgeTo]     = useState('');
  const [bridgeAmt,    setBridgeAmt]    = useState('');
  const [bridgeQuote,  setBridgeQuote]  = useState<AnyObj | null>(null);
  const [bridgeResult, setBridgeResult] = useState<AnyObj | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<AnyObj | null>(null);

  // swap tab
  const [swapFrom,   setSwapFrom]   = useState('ETH');
  const [swapTo,     setSwapTo]     = useState('USDT');
  const [swapAmount, setSwapAmount] = useState('');
  const [swapQuote,  setSwapQuote]  = useState<AnyObj | null>(null);
  const [swapResult, setSwapResult] = useState<AnyObj | null>(null);

  // server wallet tab
  const [serverWallet,      setServerWallet]      = useState<AnyObj | null>(null);
  const [serverSendTo,      setServerSendTo]       = useState('');
  const [serverSendAmt,     setServerSendAmt]      = useState('');
  const [serverSendToken,   setServerSendToken]    = useState<'ETH' | 'USDT'>('ETH');
  const [serverSendResult,  setServerSendResult]   = useState<AnyObj | null>(null);
  const [serverGasSpeed,    setServerGasSpeed]     = useState<GasSpeed>('standard');

  // live gas prices (shared, fetched on send tabs)
  const [liveGas, setLiveGas] = useState<{ slow: number; standard: number; fast: number } | null>(null);

  // gas tab
  const [gas, setGas] = useState<AnyObj | null>(null);

  // txs tab
  const [txs,        setTxs]        = useState<AnyObj[]>([]);
  const [txsPage,    setTxsPage]    = useState(1);
  const [txsHasMore, setTxsHasMore] = useState(false);

  // usdt history pagination
  const [usdtPage,    setUsdtPage]    = useState(1);
  const [usdtHasMore, setUsdtHasMore] = useState(false);

  useEffect(() => {
    if (connectedAddress) setAddress(connectedAddress);
  }, [connectedAddress]);

  // Auto-switch MetaMask chain when user picks a different chain for send
  useEffect(() => {
    if (tab === 'send' && isConnected && connectedChainId !== parseInt(chainId, 10)) {
      switchChain?.({ chainId: parseInt(chainId, 10) });
    }
  }, [chainId, tab, isConnected, connectedChainId, switchChain]);

  // Auto-fetch live gas prices when on a send tab
  useEffect(() => {
    if (tab === 'send' || tab === 'server') fetchLiveGas();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, chainId]);

  // Auto-load server wallet when server tab opens or chain changes
  useEffect(() => {
    if (tab === 'server') fetchServerWallet();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, chainId]);

  async function fetchLiveGas() {
    try {
      const res = await fetch(`/api/wallet/gas?chain_id=${chainId}`);
      const data: AnyObj = await res.json();
      if (data.gas_price_gwei) {
        setLiveGas({
          slow:     data.gas_price_gwei.slow     ?? 0,
          standard: data.gas_price_gwei.standard ?? 0,
          fast:     data.gas_price_gwei.fast     ?? 0,
        });
      }
    } catch { /* ignore — gas selector still works without live prices */ }
  }

  async function call(url: string, opts?: RequestInit) {
    setLoading(true);
    setError('');
    try {
      const res  = await fetch(url, opts);
      const data: AnyObj = await res.json();
      const err  = apiErr(data);
      if (err) { setError(err); return null; }
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      return null;
    } finally {
      setLoading(false);
    }
  }

  // ── Fetch handlers ──────────────────────────────────────────────────────────

  async function fetchUsdtHistory(append = false) {
    const page = append ? usdtPage + 1 : 1;
    const data = await call(
      `/api/wallet/token-transfers?chain_id=${chainId}&address=${address}&token=usdt&offset=20&page=${page}`
    );
    if (data) {
      const list = Array.isArray(data.transfers) ? data.transfers : [];
      setUsdtTxs(prev => append ? [...prev, ...list] : list);
      setUsdtPage(page);
      setUsdtHasMore(data.has_more ?? list.length === 20);
    }
  }

  async function doSend() {
    if (!sendTo.startsWith('0x') || sendTo.length !== 42) { setError('Invalid recipient address'); return; }
    if (!sendAmount || parseFloat(sendAmount) <= 0) { setError('Enter a valid amount'); return; }
    setLoading(true);
    setError('');
    try {
      // Gas price override from live oracle
      const gweiValue = liveGas?.[sendGasSpeed];
      const gasOverride = gweiValue ? { gasPrice: parseGwei(gweiValue.toString()) } : {};

      let txHash: string;
      if (sendToken === 'ETH') {
        // Send ETH directly via MetaMask
        txHash = await sendTransactionAsync({
          to: sendTo as `0x${string}`,
          value: parseEther(sendAmount),
          ...gasOverride,
        });
      } else {
        // Send USDT ERC-20 via MetaMask
        const usdtAddr = USDT_ADDRESSES[chainId];
        if (!usdtAddr) { setError(`USDT not supported on chain ${chainId}`); setLoading(false); return; }
        txHash = await writeContractAsync({
          address: usdtAddr,
          abi: ERC20_TRANSFER_ABI,
          functionName: 'transfer',
          args: [sendTo as `0x${string}`, parseUnits(sendAmount, 6)],
          ...gasOverride,
        });
      }
      setSendResult({ success: true, tx_hash: txHash, token: sendToken, from: connectedAddress, to: sendTo, amount: sendAmount, gas_speed: sendGasSpeed });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transaction failed');
    } finally {
      setLoading(false);
    }
  }

  async function fetchServerWallet() {
    const data = await call(`/api/wallet/server-wallet?chain_id=${chainId}`);
    if (data) setServerWallet(data);
  }

  async function doServerSend() {
    if (!serverSendTo.startsWith('0x') || serverSendTo.length !== 42) {
      setError('Invalid recipient address'); return;
    }
    if (!serverSendAmt || parseFloat(serverSendAmt) <= 0) {
      setError('Enter a valid amount'); return;
    }
    const data = await call('/api/wallet/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chain_id: chainId,
        to: serverSendTo,
        amount: serverSendAmt,
        token: serverSendToken.toLowerCase(),
        gas_speed: serverGasSpeed,
      }),
    });
    if (data) {
      setServerSendResult(data);
      fetchServerWallet(); // refresh balance after send
    }
  }

  async function fetchBridgeQuote() {
    setBridgeQuote(null);
    const data = await call(
      `/api/wallet/bridge/quote?from=usdt-erc20&to=usdt-trc20&amount=${bridgeAmt}`
    );
    if (data) setBridgeQuote(data);
  }

  async function doBridge() {
    const data = await call('/api/wallet/bridge/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'usdt-erc20',
        to: 'usdt-trc20',
        amount: parseFloat(bridgeAmt),
        recipient_address: bridgeTo,
        chain_id: chainId,
      }),
    });
    if (data) setBridgeResult(data);
  }

  async function fetchBridgeStatus(orderId: string) {
    const data = await call(`/api/wallet/bridge/status/${orderId}`);
    if (data) setBridgeStatus(data);
  }

  async function fetchSwapQuote() {
    setSwapQuote(null);
    const data = await call(
      `/api/wallet/swap?chain_id=${chainId}&from=${swapFrom.toLowerCase()}&to=${swapTo.toLowerCase()}&amount=${swapAmount}`
    );
    if (data) setSwapQuote(data);
  }

  async function doSwap() {
    const data = await call('/api/wallet/swap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chain_id: chainId, from: swapFrom.toLowerCase(), to: swapTo.toLowerCase(), amount: swapAmount, slippage: 1 }),
    });
    if (data) setSwapResult(data);
  }

  async function fetchGas() {
    const data = await call(`/api/wallet/gas?chain_id=${chainId}`);
    if (data) setGas(data);
  }

  async function fetchTxs(append = false) {
    const page = append ? txsPage + 1 : 1;
    const data = await call(
      `/api/wallet/transactions?chain_id=${chainId}&address=${address}&offset=20&page=${page}`
    );
    if (data) {
      const list = Array.isArray(data.transactions) ? data.transactions : [];
      setTxs(prev => append ? [...prev, ...list] : list);
      setTxsPage(page);
      setTxsHasMore(data.has_more ?? list.length === 20);
    }
  }

  function go() {
    if (tab === 'usdt')   { setUsdtPage(1); fetchUsdtHistory(); }
    else if (tab === 'gas')    fetchGas();
    else if (tab === 'txs')  { setTxsPage(1); fetchTxs(); }
    else if (tab === 'server') fetchServerWallet();
  }

  const needsAddr = tab !== 'gas' && tab !== 'send' && tab !== 'bridge' && tab !== 'swap' && tab !== 'balance' && tab !== 'server';
  const canFetch  = !needsAddr || address.startsWith('0x');
  const showFetch = tab !== 'send' && tab !== 'bridge' && tab !== 'swap' && tab !== 'balance' && tab !== 'server';

  // ── styles ──────────────────────────────────────────────────────────────────
  const card: React.CSSProperties = {
    background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 20, marginBottom: 16,
  };
  const label: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6,
  };
  const input: React.CSSProperties = {
    display: 'block', width: '100%', padding: '8px 12px', borderRadius: 8,
    border: '1px solid #e2e8f0', fontSize: 13, boxSizing: 'border-box',
  };
  const btn = (active = true, color = '#2563eb'): React.CSSProperties => ({
    width: '100%', padding: '10px', borderRadius: 8, border: 'none',
    cursor: active ? 'pointer' : 'not-allowed',
    background: active ? color : '#94a3b8', color: '#fff', fontSize: 14, fontWeight: 600,
  });

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', padding: '24px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1e293b', margin: 0 }}>
            Wallet Dashboard
          </h1>
          <p style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
            USDT send · bridge ERC20→TRC20 · history · gas
          </p>
        </div>

        {/* Main card */}
        <div style={card}>

          {/* Chain */}
          <div style={{ marginBottom: 12 }}>
            <label style={label}>Chain</label>
            <select value={chainId} onChange={e => setChainId(e.target.value)}
              style={{ ...input, fontSize: 14 }}>
              {CHAINS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {/* Connect wallet */}
          <div style={{ marginBottom: 12 }}>
            {isConnected ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', flexShrink: 0, display: 'inline-block' }} />
                  <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#15803d', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {connectedAddress}
                  </span>
                </div>
                <button onClick={() => disconnect()}
                  style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #fecaca', background: '#fff', color: '#dc2626', fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
                  Disconnect
                </button>
              </div>
            ) : walletConnectEnabled ? (
              <ConnectButton />
            ) : (
              <div style={{ padding: '10px 14px', borderRadius: 8, background: '#fefce8', border: '1px solid #fde68a', fontSize: 12, color: '#92400e' }}>
                Wallet connect disabled — add <code>NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID</code> to .env.local to enable MetaMask/Trust Wallet. You can still paste an address manually below.
              </div>
            )}
          </div>

          {/* Address input (for history/txs tabs) */}
          {needsAddr && (
            <div style={{ marginBottom: 16 }}>
              <label style={label}>Wallet Address {isConnected ? '(connected)' : '(or paste)'}</label>
              <input type="text" value={address} onChange={e => setAddress(e.target.value)}
                placeholder="0x..." style={{ ...input, fontFamily: 'monospace', border: `1px solid ${isConnected ? '#bbf7d0' : '#e2e8f0'}` }} />
            </div>
          )}

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500,
                background: tab === t.id
                  ? (t.server ? '#ea580c' : t.usdt ? '#0d9488' : t.swap ? '#7c3aed' : '#2563eb')
                  : '#f1f5f9',
                color: tab === t.id ? '#fff' : '#475569',
              }}>
                {t.label}
              </button>
            ))}
            {tab === 'balance' && (
              <select value={token} onChange={e => setToken(e.target.value)}
                style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: 20, border: '1px solid #e2e8f0', fontSize: 12 }}>
                {['USDT', 'USDC', 'ETH'].map(t => <option key={t}>{t}</option>)}
              </select>
            )}
          </div>

          {/* Send form — ETH or USDT via MetaMask */}
          {tab === 'send' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {!isConnected && (
                <div style={{ padding: '10px 14px', borderRadius: 8, background: '#fefce8', border: '1px solid #fde68a', fontSize: 12, color: '#92400e' }}>
                  Connect your wallet above to send
                </div>
              )}
              {/* Token selector */}
              <div style={{ display: 'flex', gap: 8 }}>
                {(['ETH', 'USDT'] as SendToken[]).map(t => (
                  <button key={t} onClick={() => { setSendToken(t); setSendResult(null); setError(''); }}
                    style={{ flex: 1, padding: '8px', borderRadius: 8, border: `2px solid ${sendToken === t ? '#0d9488' : '#e2e8f0'}`, background: sendToken === t ? '#f0fdfa' : '#fff', color: sendToken === t ? '#0d9488' : '#64748b', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                    {t === 'ETH' ? '⬡ ETH' : '$ USDT'}
                  </button>
                ))}
              </div>
              <div>
                <label style={label}>Recipient Address</label>
                <input value={sendTo} onChange={e => setSendTo(e.target.value)}
                  placeholder="0x..." style={{ ...input, fontFamily: 'monospace' }} />
              </div>
              <div>
                <label style={label}>Amount ({sendToken})</label>
                <input type="number" value={sendAmount} onChange={e => setSendAmount(e.target.value)}
                  placeholder={sendToken === 'ETH' ? 'e.g. 0.01' : 'e.g. 10'} style={input} />
              </div>
              <div>
                <label style={label}>Gas Speed</label>
                <GasSpeedPicker value={sendGasSpeed} onChange={setSendGasSpeed} liveGas={liveGas} color="#0d9488" />
              </div>
              <button onClick={doSend} disabled={loading || !isConnected || !sendTo || !sendAmount}
                style={btn(!loading && isConnected && !!sendTo && !!sendAmount, '#0d9488')}>
                {loading ? 'Sending…' : `Send ${sendToken} via MetaMask`}
              </button>
            </div>
          )}

          {/* Bridge form */}
          {tab === 'bridge' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ padding: '10px 14px', borderRadius: 8, background: '#f0fdfa', border: '1px solid #99f6e4', fontSize: 12, color: '#0f766e' }}>
                ERC20 USDT (from server wallet) → TRC20 USDT (your TRON address)
              </div>
              <div>
                <label style={label}>TRON Recipient Address</label>
                <input value={bridgeTo} onChange={e => setBridgeTo(e.target.value)}
                  placeholder="T..." style={{ ...input, fontFamily: 'monospace' }} />
              </div>
              <div>
                <label style={label}>Amount (USDT)</label>
                <input type="number" value={bridgeAmt} onChange={e => setBridgeAmt(e.target.value)}
                  placeholder="e.g. 50" style={input} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={fetchBridgeQuote} disabled={loading || !bridgeAmt}
                  style={{ ...btn(!loading && !!bridgeAmt, '#64748b'), flex: 1 }}>
                  {loading ? '…' : 'Get Quote'}
                </button>
                <button onClick={doBridge} disabled={loading || !bridgeTo || !bridgeAmt || !bridgeQuote}
                  style={{ ...btn(!loading && !!bridgeTo && !!bridgeAmt && !!bridgeQuote, '#0d9488'), flex: 2 }}>
                  {loading ? 'Bridging…' : 'Bridge Now'}
                </button>
              </div>
            </div>
          )}

          {/* Swap form */}
          {tab === 'swap' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ padding: '10px 14px', borderRadius: 8, background: '#faf5ff', border: '1px solid #e9d5ff', fontSize: 12, color: '#6b21a8' }}>
                Swap tokens via 1inch — requires ONEINCH_API_KEY + WALLET_PRIVATE_KEY in .env.local
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 40px 1fr', gap: 8, alignItems: 'end' }}>
                <div>
                  <label style={label}>From</label>
                  <select value={swapFrom} onChange={e => { setSwapFrom(e.target.value); setSwapQuote(null); }}
                    style={{ ...input, fontSize: 14 }}>
                    {TOKENS.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div style={{ textAlign: 'center', paddingBottom: 8, fontSize: 18, color: '#7c3aed', fontWeight: 700 }}>⇄</div>
                <div>
                  <label style={label}>To</label>
                  <select value={swapTo} onChange={e => { setSwapTo(e.target.value); setSwapQuote(null); }}
                    style={{ ...input, fontSize: 14 }}>
                    {TOKENS.filter(t => t !== swapFrom).map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={label}>Amount ({swapFrom})</label>
                <input type="number" value={swapAmount} onChange={e => { setSwapAmount(e.target.value); setSwapQuote(null); }}
                  placeholder="e.g. 0.1" style={input} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={fetchSwapQuote} disabled={loading || !swapAmount}
                  style={{ ...btn(!loading && !!swapAmount, '#64748b'), flex: 1 }}>
                  {loading ? '…' : 'Get Quote'}
                </button>
                <button onClick={doSwap} disabled={loading || !swapAmount || !swapQuote}
                  style={{ ...btn(!loading && !!swapAmount && !!swapQuote, '#7c3aed'), flex: 2 }}>
                  {loading ? 'Swapping…' : 'Execute Swap'}
                </button>
              </div>
            </div>
          )}

          {/* Fetch button for non-form tabs */}
          {showFetch && (
            <button onClick={go} disabled={loading || !canFetch}
              style={btn(!loading && canFetch)}>
              {loading ? 'Loading…' : 'Fetch'}
            </button>
          )}
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', marginBottom: 16, color: '#dc2626', fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* ── Balance (wagmi hooks, no server RPC) ───────────────────────────── */}
        {tab === 'balance' && (
          <BalancePanel address={address} chainId={chainId} token={token} />
        )}

        {/* ── Server Wallet ─────────────────────────────────────────────────── */}
        {tab === 'server' && (
          <div>
            {/* Info + load button */}
            <div style={{ ...card }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#ea580c', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
                Server Wallet · No MetaMask Needed
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14, lineHeight: 1.6 }}>
                This wallet is managed on the server using <code>SENDER_WALLET_PRIVATE_KEY</code> from <code>.env.local</code>.
                Fund it with ETH/USDT and send directly without MetaMask.
              </div>
              <button onClick={fetchServerWallet} disabled={loading}
                style={{ width: '100%', padding: '10px', borderRadius: 8, border: 'none', cursor: loading ? 'not-allowed' : 'pointer', background: loading ? '#94a3b8' : '#ea580c', color: '#fff', fontSize: 14, fontWeight: 600 }}>
                {loading ? 'Loading…' : serverWallet ? '↻ Refresh Balance' : 'Load Server Wallet'}
              </button>
            </div>

            {/* Wallet info */}
            {serverWallet && !serverWallet.error && (
              <>
                <div style={card}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                    Wallet Address
                  </div>
                  <div style={{ fontFamily: 'monospace', fontSize: 13, color: '#1e293b', wordBreak: 'break-all', marginBottom: 6 }}>
                    {String(serverWallet.address ?? '')}
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>
                    {serverWallet.funded ? '● Funded' : '○ Empty — send ETH/USDT to this address to fund'}
                  </div>

                  {/* Balances + Gas */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 16 }}>
                    {[
                      { label: 'ETH Balance', value: serverWallet.balances?.eth?.amount ?? '–', symbol: 'ETH', color: '#2563eb' },
                      { label: 'USDT Balance', value: serverWallet.balances?.usdt?.amount ?? '–', symbol: 'USDT', color: '#0d9488' },
                      { label: 'Gas (Standard)', value: liveGas ? liveGas.standard.toString() : '…', symbol: 'Gwei', color: '#d97706' },
                    ].map(b => (
                      <div key={b.label} style={{ padding: '14px', borderRadius: 10, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{b.label}</div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: b.color }}>
                          {b.value} <span style={{ fontSize: 11, color: '#94a3b8' }}>{b.symbol}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Slow / Fast gas inline */}
                  {liveGas && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <div style={{ flex: 1, padding: '6px 10px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #bbf7d0', fontSize: 11, color: '#16a34a', textAlign: 'center' }}>
                        🐢 Slow: {liveGas.slow} Gwei
                      </div>
                      <div style={{ flex: 1, padding: '6px 10px', borderRadius: 8, background: '#fff1f2', border: '1px solid #fecdd3', fontSize: 11, color: '#e11d48', textAlign: 'center' }}>
                        🚀 Fast: {liveGas.fast} Gwei
                      </div>
                    </div>
                  )}
                </div>

                {/* Send from server wallet */}
                <div style={card}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#ea580c', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 }}>
                    Send from Server Wallet
                  </div>

                  {/* Token selector */}
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    {(['ETH', 'USDT'] as const).map(t => (
                      <button key={t} onClick={() => { setServerSendToken(t); setServerSendResult(null); }}
                        style={{ flex: 1, padding: '8px', borderRadius: 8, border: `2px solid ${serverSendToken === t ? '#ea580c' : '#e2e8f0'}`, background: serverSendToken === t ? '#fff7ed' : '#fff', color: serverSendToken === t ? '#ea580c' : '#64748b', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                        {t === 'ETH' ? '⬡ ETH' : '$ USDT'}
                      </button>
                    ))}
                  </div>

                  <div style={{ marginBottom: 10 }}>
                    <label style={label}>Recipient Address</label>
                    <input value={serverSendTo} onChange={e => setServerSendTo(e.target.value)}
                      placeholder="0x..." style={{ ...input, fontFamily: 'monospace' }} />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={label}>Amount ({serverSendToken})</label>
                    <input type="number" value={serverSendAmt} onChange={e => setServerSendAmt(e.target.value)}
                      placeholder={serverSendToken === 'ETH' ? 'e.g. 0.01' : 'e.g. 10'} style={input} />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={label}>Gas Speed</label>
                    <GasSpeedPicker value={serverGasSpeed} onChange={setServerGasSpeed} liveGas={liveGas} color="#ea580c" />
                  </div>
                  <button onClick={doServerSend} disabled={loading || !serverSendTo || !serverSendAmt}
                    style={btn(!loading && !!serverSendTo && !!serverSendAmt, '#ea580c')}>
                    {loading ? 'Sending…' : `Send ${serverSendToken} from Server Wallet`}
                  </button>
                </div>

                {/* Send result */}
                {serverSendResult && (
                  <div style={{ ...card, borderColor: '#fed7aa', background: '#fff7ed' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#c2410c', marginBottom: 10 }}>
                      ✓ Sent from Server Wallet
                    </div>
                    <div style={{ fontSize: 12, color: '#374151', marginBottom: 4 }}>
                      Tx Hash: <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{String(serverSendResult.tx_hash ?? '')}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
                      To: <span style={{ fontFamily: 'monospace' }}>{shortAddr(String(serverSendResult.to ?? serverSendTo))}</span>
                      · Amount: {String(serverSendResult.amount ?? serverSendAmt)} {serverSendToken}
                      {serverSendResult.gas_speed && ` · Gas: ${String(serverSendResult.gas_speed)}`}
                      {serverSendResult.gas_price_gwei && ` (${String(serverSendResult.gas_price_gwei)} Gwei)`}
                    </div>
                    {serverSendResult.tx_hash && (
                      <a href={`https://etherscan.io/tx/${serverSendResult.tx_hash}`} target="_blank" rel="noreferrer"
                        style={{ fontSize: 12, color: '#2563eb' }}>View on Etherscan ↗</a>
                    )}
                  </div>
                )}
              </>
            )}

            {serverWallet?.error && (
              <div style={{ ...card, borderColor: '#fecaca', background: '#fef2f2', color: '#dc2626', fontSize: 13 }}>
                {String(serverWallet.error)}
              </div>
            )}
          </div>
        )}

        {/* ── USDT Transfer History ──────────────────────────────────────────── */}
        {tab === 'usdt' && (
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#0d9488', textTransform: 'uppercase', letterSpacing: 1 }}>
                USDT Transfers ({usdtTxs.length})
              </span>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>Official ERC-20 USDT only</span>
            </div>
            {usdtTxs.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 14, padding: '40px 0' }}>
                No USDT transfers found
              </div>
            ) : (
              <>
                {usdtTxs.map((tx: AnyObj, i: number) => (
                  <div key={String(tx.hash ?? i)} style={{ padding: '14px 20px', borderBottom: '1px solid #f8fafc' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                          fontSize: 11, padding: '2px 8px', borderRadius: 12, fontWeight: 700,
                          background: tx.direction === 'incoming' ? '#dcfce7' : '#fef3c7',
                          color: tx.direction === 'incoming' ? '#16a34a' : '#d97706',
                        }}>
                          {tx.direction === 'incoming' ? '↓ IN' : '↑ OUT'}
                        </span>
                        <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#64748b' }}>{shortAddr(String(tx.hash ?? ''))}</span>
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 700, color: tx.direction === 'incoming' ? '#16a34a' : '#1e293b' }}>
                        {tx.amount_formatted ?? parseFloat(String(tx.value ?? '0'))} USDT
                      </span>
                    </div>
                    <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#94a3b8' }}>
                      <span>{shortAddr(String(tx.from ?? ''))} → {shortAddr(String(tx.to ?? ''))}</span>
                      <span>{fmtTime(String(tx.timeStamp ?? ''))}</span>
                    </div>
                  </div>
                ))}
                {usdtHasMore && (
                  <div style={{ padding: '12px 20px', textAlign: 'center' }}>
                    <button onClick={() => fetchUsdtHistory(true)} disabled={loading}
                      style={{ padding: '8px 24px', borderRadius: 8, border: '1px solid #0d9488', background: '#fff', color: '#0d9488', fontSize: 13, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer' }}>
                      {loading ? 'Loading…' : 'Load More'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Send result ────────────────────────────────────────────────────── */}
        {tab === 'send' && sendResult && (
          <div style={{ ...card, borderColor: '#bbf7d0', background: '#f0fdf4' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#16a34a', marginBottom: 10 }}>
              ✓ {String(sendResult.token ?? 'Token')} Sent Successfully
            </div>
            <div style={{ fontSize: 12, color: '#374151', marginBottom: 6 }}>
              Tx Hash: <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{String(sendResult.tx_hash ?? '')}</span>
            </div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              From: {shortAddr(String(sendResult.from ?? ''))} · To: {shortAddr(String(sendResult.to ?? ''))} · Amount: {String(sendResult.amount ?? '')} {String(sendResult.token ?? '')}
              {sendResult.gas_speed && ` · Gas: ${String(sendResult.gas_speed)}`}
            </div>
            {sendResult.tx_hash && (
              <a href={`https://etherscan.io/tx/${sendResult.tx_hash}`} target="_blank" rel="noreferrer"
                style={{ display: 'inline-block', marginTop: 10, fontSize: 12, color: '#2563eb' }}>
                View on Etherscan ↗
              </a>
            )}
          </div>
        )}

        {/* ── Bridge quote + result ──────────────────────────────────────────── */}
        {tab === 'bridge' && bridgeQuote && (
          <div style={{ ...card, marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#0d9488', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
              Bridge Quote
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                ['You Send',     `${bridgeQuote.from_amount ?? bridgeAmt} USDT (ERC20)`],
                ['You Receive',  `≈ ${bridgeQuote.estimated_amount ?? '–'} USDT (TRC20)`],
                ['Rate',         bridgeQuote.rate ? `1 ERC20 = ${bridgeQuote.rate} TRC20` : '–'],
                ['Min Amount',   `${bridgeQuote.minimum_amount ?? '–'} USDT`],
              ].map(([k, v]) => (
                <div key={k} style={{ padding: '10px 14px', borderRadius: 8, background: '#f8fafc' }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>{k}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {tab === 'bridge' && bridgeResult && (
          <div style={{ ...card, borderColor: '#a7f3d0', background: '#ecfdf5' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#065f46', marginBottom: 10 }}>
              ✓ Bridge Order Created
            </div>
            <div style={{ fontSize: 12, color: '#374151', marginBottom: 4 }}>
              Order ID: <span style={{ fontFamily: 'monospace' }}>{String(bridgeResult.bridge_order?.id ?? '')}</span>
            </div>
            <div style={{ fontSize: 12, color: '#374151', marginBottom: 4 }}>
              Send Tx: <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{String(bridgeResult.send_tx?.tx_hash ?? '')}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {bridgeResult.bridge_order?.id && (
                <button onClick={() => fetchBridgeStatus(String(bridgeResult.bridge_order.id))} disabled={loading}
                  style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: '#0d9488', color: '#fff', fontSize: 12, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer' }}>
                  {loading ? 'Checking…' : '↻ Check Status'}
                </button>
              )}
              {bridgeResult.bridge_order?.id && (
                <a href={`https://changenow.io/exchange/txs/${bridgeResult.bridge_order.id}`} target="_blank" rel="noreferrer"
                  style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #0d9488', background: '#fff', color: '#0d9488', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
                  Track on ChangeNow ↗
                </a>
              )}
            </div>
            {bridgeStatus && (
              <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: bridgeStatus.is_complete ? '#f0fdf4' : bridgeStatus.is_failed ? '#fef2f2' : '#fefce8', border: `1px solid ${bridgeStatus.is_complete ? '#bbf7d0' : bridgeStatus.is_failed ? '#fecaca' : '#fde68a'}` }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: bridgeStatus.is_complete ? '#16a34a' : bridgeStatus.is_failed ? '#dc2626' : '#92400e', marginBottom: 4 }}>
                  Status: {String(bridgeStatus.status_description ?? bridgeStatus.status ?? '')}
                </div>
                {bridgeStatus.exchange?.to?.tx_hash && (
                  <div style={{ fontSize: 11, color: '#6b7280' }}>
                    TRC20 Tx: <span style={{ fontFamily: 'monospace' }}>{shortAddr(String(bridgeStatus.exchange.to.tx_hash))}</span>
                  </div>
                )}
              </div>
            )}
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 8 }}>
              TRC20 USDT will arrive in 5–30 minutes
            </div>
          </div>
        )}

        {/* ── Swap quote ────────────────────────────────────────────────────── */}
        {tab === 'swap' && swapQuote && !swapResult && (
          <div style={{ ...card, marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
              Swap Quote · 1inch
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                ['You Pay',      `${swapQuote.from?.amount ?? swapAmount} ${swapQuote.from?.token ?? swapFrom}`],
                ['You Receive',  `≈ ${parseFloat(String(swapQuote.to?.amount ?? '0')).toFixed(6)} ${swapQuote.to?.token ?? swapTo}`],
                ['Est. Gas',     swapQuote.estimated_gas ? `${swapQuote.estimated_gas.toLocaleString()} gas` : '–'],
                ['Slippage',     '1%'],
              ].map(([k, v]) => (
                <div key={k} style={{ padding: '10px 14px', borderRadius: 8, background: '#f5f3ff' }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>{k}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {tab === 'swap' && swapResult && (
          <div style={{ ...card, borderColor: '#ddd6fe', background: '#faf5ff' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#6d28d9', marginBottom: 10 }}>
              ✓ Swap Executed
            </div>
            <div style={{ fontSize: 12, color: '#374151', marginBottom: 4 }}>
              {String(swapResult.from?.token ?? swapFrom)} → {String(swapResult.to?.token ?? swapTo)}
            </div>
            <div style={{ fontSize: 12, color: '#374151', marginBottom: 4 }}>
              Tx Hash: <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{String(swapResult.tx_hash ?? '')}</span>
            </div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              Block #{String(swapResult.block_number ?? '')} · {String(swapResult.status ?? '')}
            </div>
            {swapResult.tx_hash && (
              <a href={`https://etherscan.io/tx/${swapResult.tx_hash}`} target="_blank" rel="noreferrer"
                style={{ display: 'inline-block', marginTop: 10, fontSize: 12, color: '#7c3aed' }}>
                View on Etherscan ↗
              </a>
            )}
          </div>
        )}

        {/* ── Gas ───────────────────────────────────────────────────────────── */}
        {tab === 'gas' && gas && (
          <div style={card}>
            <div style={{ ...label, marginBottom: 16 }}>Gas Prices · {String(gas.source ?? '')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
              {(['slow', 'standard', 'fast'] as const).map((speed, i) => (
                <div key={speed} style={{ borderRadius: 10, padding: 14, textAlign: 'center', background: ['#f0fdf4','#fefce8','#fff1f2'][i] }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'capitalize', marginBottom: 6 }}>{speed}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#1e293b' }}>{Number(gas.gas_price_gwei?.[speed] ?? 0)}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>Gwei</div>
                </div>
              ))}
            </div>
            <div>
              {(gas.fee_estimates as AnyObj[] ?? []).map((f: AnyObj) => (
                <div key={String(f.operation)} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
                  <span style={{ color: '#475569', textTransform: 'capitalize' }}>{String(f.operation ?? '').replace(/_/g, ' ')}</span>
                  <span style={{ color: '#1e293b', fontWeight: 500 }}>
                    {f.fee_usd ? `$${f.fee_usd.slow} – $${f.fee_usd.fast}` : '–'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── All Transactions ──────────────────────────────────────────────── */}
        {tab === 'txs' && (
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>
              Recent Transactions ({txs.length})
            </div>
            {txs.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 14, padding: '40px 0' }}>
                Enter a wallet address and click Fetch
              </div>
            ) : (
              <>
                {txs.map((tx: AnyObj, i: number) => (
                  <div key={String(tx.hash ?? i)} style={{ padding: '14px 20px', borderBottom: '1px solid #f8fafc' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                          fontSize: 11, padding: '2px 8px', borderRadius: 12, fontWeight: 600,
                          background: tx.direction === 'incoming' ? '#dcfce7' : '#fee2e2',
                          color: tx.direction === 'incoming' ? '#16a34a' : '#dc2626',
                        }}>
                          {String(tx.direction ?? (String(tx.from ?? '').toLowerCase() === address.toLowerCase() ? 'OUT' : 'IN')).toUpperCase()}
                        </span>
                        <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#64748b' }}>{shortAddr(String(tx.hash ?? ''))}</span>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: tx.isError === '1' ? '#dc2626' : '#16a34a' }}>
                        {tx.isError === '1' ? 'Failed' : 'Success'}
                      </span>
                    </div>
                    <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#94a3b8' }}>
                      <span>{shortAddr(String(tx.from ?? ''))} → {shortAddr(String(tx.to ?? ''))}</span>
                      {tx.value_eth && <span>{parseFloat(String(tx.value_eth)).toFixed(5)} ETH</span>}
                    </div>
                    {tx.timeStamp && (
                      <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 4 }}>{fmtTime(String(tx.timeStamp))}</div>
                    )}
                  </div>
                ))}
                {txsHasMore && (
                  <div style={{ padding: '12px 20px', textAlign: 'center' }}>
                    <button onClick={() => fetchTxs(true)} disabled={loading}
                      style={{ padding: '8px 24px', borderRadius: 8, border: '1px solid #2563eb', background: '#fff', color: '#2563eb', fontSize: 13, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer' }}>
                      {loading ? 'Loading…' : 'Load More'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
