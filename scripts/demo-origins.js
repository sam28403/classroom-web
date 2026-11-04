export function demoOrigins(addresses, apiPort = 3001, configured = '') {
  const hosts = [...new Set(['localhost', '127.0.0.1', '[::1]', ...addresses])]
  const ports = [...new Set([5173, apiPort])]
  return [...new Set([
    ...configured.split(',').map(value => value.trim()).filter(Boolean),
    ...hosts.flatMap(host => ports.map(port => `http://${host}:${port}`)),
  ])].join(',')
}
