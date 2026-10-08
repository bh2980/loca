/** Literal loopback and RFC1918 IPv4 addresses for user-configured local inference.
 * No DNS lookup or hostname-prefix trust: 192.168.0.36.example.com is not local.
 */
export function isLocalApiHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '[::1]') return true;
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
  const parts = host.split('.').map(Number);
  if (parts.some(part => part > 255)) return false;
  return parts[0] === 127 || parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}
