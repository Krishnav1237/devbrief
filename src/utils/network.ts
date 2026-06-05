import * as os from 'node:os';

/**
 * Detects the machine's Tailscale IP by finding the first `100.x.x.x`
 * network interface address. Falls back to the `TAILSCALE_IP` env var
 * if set.
 */
export function detectTailscaleIP(): string | null {
  const envIP = process.env.TAILSCALE_IP;
  if (envIP) return envIP;

  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const addrs = interfaces[name];
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && addr.address.startsWith('100.')) {
        return addr.address;
      }
    }
  }

  return null;
}
