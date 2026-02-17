'use client';
import { useState, useEffect, useCallback } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type NayaxState = {
  connected: boolean;
  simulation: boolean;
  state: string;
  session: any | null;
  timestamp: number;
  link?: {
    poll_count: number;
    link_ready: boolean;
    comm_errors: number;
    crc_errors: number;
  };
};

function getBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://127.0.0.1:5001';
    }
    return `http://${hostname}:5001`;
  }
  return 'http://127.0.0.1:5001';
}

export function NayaxStatus() {
  const [status, setStatus] = useState<NayaxState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    const base = getBaseUrl();
    try {
      const res = await fetch(`${base}/nayax/status`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.ok !== false) {
          setStatus(data);
          setError(null);
        }
      }
    } catch (e) {
      setError('Impossible de contacter le service Nayax');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 5000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  const stateLabels: Record<string, string> = {
    disconnected: 'Deconnecte',
    idle: 'En attente',
    waiting_selection: 'Selection en cours',
    waiting_payment: 'Attente paiement',
    authorizing: 'Autorisation...',
    vend_approved: 'Paiement approuve',
    dispensing: 'Distribution...',
    settling: 'Reglement...',
    session_complete: 'Session terminee',
    error: 'Erreur',
  };

  const stateColors: Record<string, string> = {
    disconnected: 'destructive',
    idle: 'default',
    waiting_payment: 'secondary',
    authorizing: 'secondary',
    vend_approved: 'default',
    error: 'destructive',
  };

  const isLive = status && !status.simulation && status.connected && status.link?.link_ready;
  const isSim = status?.simulation;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
              <rect width="20" height="14" x="2" y="5" rx="2"/>
              <line x1="2" x2="22" y1="10" y2="10"/>
            </svg>
            <CardTitle>Terminal Nayax</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {status && (
              <Badge variant={isLive ? 'default' : isSim ? 'secondary' : 'destructive'} className="text-xs">
                {isLive ? 'LIVE' : isSim ? 'SIMULATION' : status.connected ? 'CONNECTE' : 'HORS LIGNE'}
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={fetchStatus} disabled={loading}>
              {loading ? '...' : 'Actualiser'}
            </Button>
          </div>
        </div>
        <CardDescription>
          Terminal de paiement Nayax VPOS Touch — Protocole Marshall RS232.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-800 p-3 text-sm text-red-800 dark:text-red-300">
            {error}
          </div>
        )}

        {status && (
          <>
            {/* Connection status */}
            <div className="flex items-center gap-3">
              <span className={`inline-block h-3 w-3 rounded-full ${
                isLive ? 'bg-green-500 animate-pulse' :
                isSim ? 'bg-yellow-500' :
                status.connected ? 'bg-yellow-500' : 'bg-red-500'
              }`} />
              <div>
                <p className="font-medium">
                  {isLive ? 'Detecte & Connecte' :
                   isSim ? 'Mode Simulation' :
                   status.connected ? 'Connecte (lien non etabli)' : 'Non detecte'}
                </p>
                <p className="text-sm text-muted-foreground">
                  Etat: {stateLabels[status.state] || status.state}
                </p>
              </div>
            </div>

            {/* Link stats (live mode only) */}
            {status.link && !status.simulation && (
              <div className="grid grid-cols-4 gap-3">
                <div className="rounded-lg border p-3 text-center">
                  <div className="text-2xl font-bold">{status.link.poll_count.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">Polls recus</div>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <span className={`inline-block h-2 w-2 rounded-full ${status.link.link_ready ? 'bg-green-500' : 'bg-red-500'}`} />
                    <span className="text-2xl font-bold">{status.link.link_ready ? 'OK' : 'NON'}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">Lien actif</div>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <div className={`text-2xl font-bold ${status.link.crc_errors > 0 ? 'text-red-600' : ''}`}>{status.link.crc_errors}</div>
                  <div className="text-xs text-muted-foreground">Erreurs CRC</div>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <div className={`text-2xl font-bold ${status.link.comm_errors > 0 ? 'text-red-600' : ''}`}>{status.link.comm_errors}</div>
                  <div className="text-xs text-muted-foreground">Erreurs Comm</div>
                </div>
              </div>
            )}

            {/* Session info */}
            {status.session && (
              <div className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Session active</span>
                  <Badge variant={(stateColors[status.state] || 'secondary') as any}>
                    {stateLabels[status.state] || status.state}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">ID: </span>
                    <span className="font-mono">{status.session.session_id}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Total: </span>
                    <span className="font-bold">{status.session.total_display}</span>
                  </div>
                  {status.session.transaction_id && (
                    <div>
                      <span className="text-muted-foreground">Transaction: </span>
                      <span className="font-mono">{status.session.transaction_id}</span>
                    </div>
                  )}
                  {status.session.payment_result && status.session.payment_result !== 'pending' && (
                    <div>
                      <span className="text-muted-foreground">Resultat: </span>
                      <Badge variant={status.session.payment_result === 'approved' ? 'default' : 'destructive'}>
                        {status.session.payment_result}
                      </Badge>
                    </div>
                  )}
                </div>
                {status.session.items && status.session.items.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    {status.session.items.length} article(s)
                  </div>
                )}
              </div>
            )}

            {/* Config info */}
            <div className="text-xs text-muted-foreground space-y-0.5">
              <div>Port: /dev/ttyUSB0 @ 115200 baud</div>
              {status.timestamp && (
                <div>Derniere MAJ: {new Date(status.timestamp * 1000).toLocaleTimeString('fr-FR')}</div>
              )}
            </div>
          </>
        )}

        {!status && !loading && !error && (
          <p className="text-sm text-muted-foreground text-center py-4">
            Service Nayax non disponible.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
