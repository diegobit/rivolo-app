import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Node 25+ enables Web Storage globally. Disable it before Vitest starts so
// jsdom can install its own Storage instances in browser tests. The flag has
// existed since Node 22.4; older supported runtimes do not need it.
const [major, minor] = process.versions.node.split('.').map(Number)
const supportsWebStorageFlag = major > 22 || (major === 22 && minor >= 4)
const vitestCli = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url))
const nodeOptions = [process.env.NODE_OPTIONS, supportsWebStorageFlag && '--no-experimental-webstorage']
  .filter(Boolean)
  .join(' ')
const vitest = spawn(process.execPath, [vitestCli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
})

vitest.on('error', (error) => {
  console.error(error)
  process.exitCode = 1
})

vitest.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})
