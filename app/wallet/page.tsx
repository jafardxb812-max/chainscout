'use client';

import { useState, useEffect } from 'react';
import { useAppKit } from '@reown/appkit/react';
import { useAccount, useDisconnect } from 'wagmi';

const CHAINS = [
  { id: '1',     name: 'Ethereum Mainnet' },
  { id: '137',   name: 'Polygon' },
  { id: '56',    name: 'BNB Chain' },
  { id: '42161', name: 'Arbitrum One' },
  { id: '10',    name: 'Optimism' },
  { id: '8453',  name: 'Base' },
  { id: '43114', name: 'Avalanche' },
];

type Tab = 'balance' | 'gas' | 'txs';

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

export default function WalletPage() {
  const { open } = useAppKit();
  const { address: connectedAddress, isConnected } = useAccount();
  const { disconnect } = useDisconnect();

  const [address, setAddress] = useState('');
  const [chainId, setChainId] = useState('1');

  // Auto-fill address when wallet connects
  useEffect(() => {
    if (connectedAddress) setAddress(connectedAddress);
  }, [connectedAddress]);
  const [token,   setToken]   = useState('USDT');
  const [tab,     setTab]     = useState<Tab>('balance');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const [balance, setBalance] = useState<AnyObj | null>(null);
  const [gas,     setGas]     = useState<AnyObj | null>(null);
  const [txs,     setTxs]     = useState<AnyObj[]>([]);

  async function call(url: string) {
    setLoading(true);
    setError('');
    try {
      const res  = await fetch(url);
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

  async function fetchBalance() {
    const data = await call(
      `/api/wallet/balance?chain_id=${chainId}&address=${address}&token=${token.toLowerCase()}`
    );
    if (data) setBalance(data);
  }

  async function fetchGas() {
    const data = await call(`/api/wallet/gas?chain_id=${chainId}`);
    if (data) setGas(data);
  }

  async function fetchTxs() {
    const data = await call(
      `/api/wallet/transactions?chain_id=${chainId}&address=${address}&offset=20`
    );
    if (data) {
      const list = Array.isArray(data.transactions) ? data.transactions : [];
      setTxs(list);
    }
  }

  function go() {
    if (tab === 'balance') fetchBalance();
    else if (tab === 'gas') fetchGas();
    else fetchTxs();
  }

  const needsAddr = tab !== 'gas';
  const canFetch  = !needsAddr || address.startsWith('0x');

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', padding: '24px' }}>
      <div style={{ maxWidth: 700, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1e293b', margin: 0 }}>
            Wallet Dashboard
          </h1>
          <p style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>
            EVM balance · gas prices · transactions
          </p>
        </div>

        {/* Card */}
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 20, marginBottom: 16 }}>

          {/* Chain selector */}
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>
              Chain
            </label>
            <select
              value={chainId}
              onChange={e => setChainId(e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 14 }}
            >
              {CHAINS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {/* Connect Wallet button */}
          <div style={{ marginBottom: 12 }}>
            {isConnected ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', flexShrink: 0, display: 'inline-block' }} />
                  <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#15803d', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {connectedAddress}
                  </span>
                </div>
                <button
                  onClick={() => disconnect()}
                  style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #fecaca', background: '#fff', color: '#dc2626', fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                onClick={() => open()}
                style={{ width: '100%', padding: '10px', borderRadius: 8, border: '1px solid #2563eb', background: '#eff6ff', color: '#2563eb', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>
                </svg>
                Connect Wallet (Trust Wallet / MetaMask / WalletConnect)
              </button>
            )}
          </div>

          {/* Address input */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>
              Wallet Address {isConnected ? '(connected)' : '(or paste manually)'}
            </label>
            <input
              type="text"
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="0x..."
              style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 12px', borderRadius: 8, border: `1px solid ${isConnected ? '#bbf7d0' : '#e2e8f0'}`, fontSize: 13, fontFamily: 'monospace', boxSizing: 'border-box' }}
            />
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {(['balance', 'gas', 'txs'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: '6px 16px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500,
                  background: tab === t ? '#2563eb' : '#f1f5f9',
                  color: tab === t ? '#fff' : '#475569',
                }}
              >
                {t === 'balance' ? 'Balance' : t === 'gas' ? 'Gas Prices' : 'Transactions'}
              </button>
            ))}

            {tab === 'balance' && (
              <select
                value={token}
                onChange={e => setToken(e.target.value)}
                style={{ marginLeft: 'auto', padding: '6px 12px', borderRadius: 20, border: '1px solid #e2e8f0', fontSize: 13 }}
              >
                {['ETH', 'USDT', 'USDC'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            )}
          </div>

          <button
            onClick={go}
            disabled={loading || !canFetch}
            style={{
              width: '100%', padding: '10px', borderRadius: 8, border: 'none', cursor: loading || !canFetch ? 'not-allowed' : 'pointer',
              background: loading || !canFetch ? '#94a3b8' : '#2563eb', color: '#fff', fontSize: 14, fontWeight: 600,
            }}
          >
            {loading ? 'Loading…' : 'Fetch'}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', marginBottom: 16, color: '#dc2626', fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* Balance result */}
        {tab === 'balance' && balance && (
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
              {String(balance.token?.name ?? token)} Balance
            </div>
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

        {/* Gas result */}
        {tab === 'gas' && gas && (
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>
              Gas Prices · {String(gas.source ?? '')}
            </div>

            {/* Gwei cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
              {(['slow', 'standard', 'fast'] as const).map((speed, i) => (
                <div key={speed} style={{ borderRadius: 10, padding: 14, textAlign: 'center', background: ['#f0fdf4','#fefce8','#fff1f2'][i] }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'capitalize', marginBottom: 6 }}>{speed}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#1e293b' }}>
                    {Number(gas.gas_price_gwei?.[speed] ?? 0)}
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>Gwei</div>
                </div>
              ))}
            </div>

            {/* Fee table */}
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

        {/* Transactions */}
        {tab === 'txs' && txs.length > 0 && (
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', fontSize: 11, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>
              Recent Transactions ({txs.length})
            </div>
            {txs.map((tx: AnyObj, i: number) => (
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

        {tab === 'txs' && txs.length === 0 && !loading && !error && (
          <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 14, padding: '40px 0' }}>
            Enter a wallet address and click Fetch
          </div>
        )}

      </div>
    </div>
  );
}
