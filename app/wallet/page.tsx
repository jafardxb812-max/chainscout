'use client';

import { useState, useEffect } from 'react';
import { useAppKit } from '@reown/appkit/react';
import { useAccount, useDisconnect } from 'wagmi';
import { walletConnectEnabled } from '@/app/web3-providers';

const CHAINS = [
  { id: '1',     name: 'Ethereum Mainnet' },
  { id: '137',   name: 'Polygon' },
  { id: '56',    name: 'BNB Chain' },
  { id: '42161', name: 'Arbitrum One' },
  { id: '10',    name: 'Optimism' },
  { id: '8453',  name: 'Base' },
  { id: '43114', name: 'Avalanche' },
];

type Tab = 'balance' | 'usdt' | 'send' | 'bridge' | 'gas' | 'txs';

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

const TABS: { id: Tab; label: string; usdt?: boolean }[] = [
  { id: 'balance', label: 'Balance' },
  { id: 'usdt',    label: 'USDT History', usdt: true },
  { id: 'send',    label: 'Send USDT',    usdt: true },
  { id: 'bridge',  label: 'Bridge →TRC20', usdt: true },
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

export default function WalletPage() {
  const { address: connectedAddress, isConnected } = useAccount();
  const { disconnect } = useDisconnect();

  const [address,  setAddress]  = useState('');
  const [chainId,  setChainId]  = useState('1');
  const [tab,      setTab]      = useState<Tab>('balance');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  // balance tab
  const [token,   setToken]   = useState('USDT');
  const [balance, setBalance] = useState<AnyObj | null>(null);

  // usdt history tab
  const [usdtTxs,    setUsdtTxs]    = useState<AnyObj[]>([]);

  // send tab
  const [sendTo,     setSendTo]     = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendResult, setSendResult] = useState<AnyObj | null>(null);

  // bridge tab
  const [bridgeTo,    setBridgeTo]    = useState('');   // TRON T... address
  const [bridgeAmt,   setBridgeAmt]   = useState('');
  const [bridgeQuote, setBridgeQuote] = useState<AnyObj | null>(null);
  const [bridgeResult,setBridgeResult]= useState<AnyObj | null>(null);

  // gas tab
  const [gas, setGas] = useState<AnyObj | null>(null);

  // txs tab
  const [txs, setTxs] = useState<AnyObj[]>([]);

  useEffect(() => {
    if (connectedAddress) setAddress(connectedAddress);
  }, [connectedAddress]);

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

  async function fetchBalance() {
    const data = await call(
      `/api/wallet/balance?chain_id=${chainId}&address=${address}&token=${token.toLowerCase()}`
    );
    if (data) setBalance(data);
  }

  async function fetchUsdtHistory() {
    const data = await call(
      `/api/wallet/token-transfers?chain_id=${chainId}&address=${address}&token=usdt&offset=30`
    );
    if (data) setUsdtTxs(Array.isArray(data.transfers) ? data.transfers : []);
  }

  async function doSend() {
    const data = await call('/api/wallet/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chain_id: chainId, to: sendTo, amount: sendAmount, token: 'usdt' }),
    });
    if (data) setSendResult(data);
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

  async function fetchGas() {
    const data = await call(`/api/wallet/gas?chain_id=${chainId}`);
    if (data) setGas(data);
  }

  async function fetchTxs() {
    const data = await call(
      `/api/wallet/transactions?chain_id=${chainId}&address=${address}&offset=20`
    );
    if (data) setTxs(Array.isArray(data.transactions) ? data.transactions : []);
  }

  function go() {
    if (tab === 'balance')  fetchBalance();
    else if (tab === 'usdt') fetchUsdtHistory();
    else if (tab === 'gas')  fetchGas();
    else if (tab === 'txs')  fetchTxs();
  }

  const needsAddr = tab !== 'gas' && tab !== 'send' && tab !== 'bridge';
  const canFetch  = !needsAddr || address.startsWith('0x');
  const showFetch = tab !== 'send' && tab !== 'bridge';

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

          {/* Address input */}
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
                background: tab === t.id ? (t.usdt ? '#0d9488' : '#2563eb') : '#f1f5f9',
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

          {/* Send USDT form */}
          {tab === 'send' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={label}>Recipient Address</label>
                <input value={sendTo} onChange={e => setSendTo(e.target.value)}
                  placeholder="0x..." style={{ ...input, fontFamily: 'monospace' }} />
              </div>
              <div>
                <label style={label}>Amount (USDT)</label>
                <input type="number" value={sendAmount} onChange={e => setSendAmount(e.target.value)}
                  placeholder="e.g. 10" style={input} />
              </div>
              <button onClick={doSend} disabled={loading || !sendTo || !sendAmount}
                style={btn(!loading && !!sendTo && !!sendAmount, '#0d9488')}>
                {loading ? 'Sending…' : 'Send USDT'}
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

        {/* ── Balance result ─────────────────────────────────────────────────── */}
        {tab === 'balance' && balance && (
          <div style={card}>
            <div style={{ ...label, marginBottom: 12 }}>{String(balance.token?.name ?? token)} Balance</div>
            <div style={{ fontSize: 30, fontWeight: 700, color: '#1e293b' }}>
              {parseFloat(String(balance.balance ?? '0')).toFixed(6)}{' '}
              <span style={{ fontSize: 16, color: '#94a3b8' }}>{String(balance.token?.symbol ?? token)}</span>
            </div>
            {balance.balance_usd && (
              <div style={{ fontSize: 20, color: '#16a34a', fontWeight: 600, marginTop: 4 }}>
                ≈ ${parseFloat(String(balance.balance_usd)).toLocaleString()} USD
              </div>
            )}
            {balance.price_usd && (
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>
                1 {String(balance.token?.symbol ?? token)} = ${Number(balance.price_usd).toLocaleString()} USD
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
            ) : usdtTxs.map((tx: AnyObj, i: number) => (
              <div key={String(tx.hash ?? i)} style={{ padding: '14px 20px', borderBottom: i < usdtTxs.length - 1 ? '1px solid #f8fafc' : 'none' }}>
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
          </div>
        )}

        {/* ── Send result ────────────────────────────────────────────────────── */}
        {tab === 'send' && sendResult && (
          <div style={{ ...card, borderColor: '#bbf7d0', background: '#f0fdf4' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#16a34a', marginBottom: 10 }}>
              ✓ USDT Sent Successfully
            </div>
            <div style={{ fontSize: 12, color: '#374151', marginBottom: 6 }}>
              Tx Hash: <span style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{String(sendResult.tx_hash ?? '')}</span>
            </div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              Block #{String(sendResult.block_number ?? '')} · Status: {String(sendResult.status ?? '')}
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
            {bridgeResult.bridge_order?.id && (
              <a href={`https://changenow.io/exchange/txs/${bridgeResult.bridge_order.id}`} target="_blank" rel="noreferrer"
                style={{ display: 'inline-block', marginTop: 8, fontSize: 12, color: '#0d9488', fontWeight: 600 }}>
                Track on ChangeNow ↗
              </a>
            )}
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 8 }}>
              TRC20 USDT will arrive in 5–30 minutes
            </div>
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
            ) : txs.map((tx: AnyObj, i: number) => (
              <div key={String(tx.hash ?? i)} style={{ padding: '14px 20px', borderBottom: i < txs.length - 1 ? '1px solid #f8fafc' : 'none' }}>
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
          </div>
        )}

      </div>
    </div>
  );
}
