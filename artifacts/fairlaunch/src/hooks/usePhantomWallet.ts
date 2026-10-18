import { useCallback, useEffect, useRef, useState } from 'react';

type PhantomPublicKey = { toString: () => string };
type PhantomEvent = 'connect' | 'disconnect' | 'accountChanged';

interface PhantomSolanaProvider {
  isPhantom: boolean;
  isConnected: boolean;
  publicKey: PhantomPublicKey | null;
  connect: (options?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: PhantomPublicKey }>;
  disconnect: () => Promise<void>;
  on: (event: PhantomEvent, listener: (publicKey?: PhantomPublicKey | null) => void) => void;
  removeListener?: (event: PhantomEvent, listener: (publicKey?: PhantomPublicKey | null) => void) => void;
}

declare global {
  interface Window {
    phantom?: { solana?: PhantomSolanaProvider };
  }
}

function getPhantomProvider() {
  const provider = typeof window !== 'undefined' ? window.phantom?.solana : undefined;
  return provider?.isPhantom ? provider : undefined;
}

export function usePhantomWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [installed, setInstalled] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState('');
  const eagerConnectAttempted = useRef<PhantomSolanaProvider | null>(null);

  useEffect(() => {
    const provider = getPhantomProvider();
    setInstalled(Boolean(provider));
    if (!provider) return;

    const updateAddress = (key?: PhantomPublicKey | null) => {
      const currentKey = key === undefined ? provider.publicKey : key;
      setAddress(currentKey?.toString() ?? null);
    };
    const handleDisconnect = () => setAddress(null);
    provider.on('connect', updateAddress);
    provider.on('accountChanged', updateAddress);
    provider.on('disconnect', handleDisconnect);

    if (provider.isConnected && provider.publicKey) {
      updateAddress(provider.publicKey);
    } else if (eagerConnectAttempted.current !== provider) {
      eagerConnectAttempted.current = provider;
      provider.connect({ onlyIfTrusted: true })
        .then(({ publicKey }) => setAddress(publicKey.toString()))
        .catch(() => {
          // A silent reconnect is optional; do not interrupt the user with a prompt.
        });
    }

    return () => {
      provider.removeListener?.('connect', updateAddress);
      provider.removeListener?.('accountChanged', updateAddress);
      provider.removeListener?.('disconnect', handleDisconnect);
    };
  }, []);

  const connect = useCallback(async () => {
    setError('');
    const provider = getPhantomProvider();
    setInstalled(Boolean(provider));
    if (!provider) {
      setError('Phantom was not detected. Install the official wallet, then reload this page.');
      return false;
    }

    setConnecting(true);
    try {
      const { publicKey } = await provider.connect();
      setAddress(publicKey.toString());
      return true;
    } catch (cause) {
      const code = typeof cause === 'object' && cause !== null && 'code' in cause
        ? (cause as { code?: number }).code
        : undefined;
      setError(code === 4001 ? 'Connection request was declined in Phantom.' : 'Could not connect to Phantom. Please try again.');
      return false;
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setError('');
    const provider = getPhantomProvider();
    if (!provider) {
      setAddress(null);
      return true;
    }
    setDisconnecting(true);
    try {
      await provider.disconnect();
      setAddress(null);
      return true;
    } catch {
      setError('Could not disconnect Phantom. Please try again.');
      return false;
    } finally {
      setDisconnecting(false);
    }
  }, []);

  return { address, installed, connecting, disconnecting, error, connect, disconnect, clearError: () => setError('') };
}
