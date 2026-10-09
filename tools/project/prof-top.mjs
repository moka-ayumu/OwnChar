// node tools/project/prof-top.mjs <dir>  — .cpuprofile의 self time 상위 함수를 출력한다.
import { readdirSync, readFileSync } from 'node:fs'
const dir = process.argv[2]
const file = readdirSync(dir).find((name) => name.endsWith('.cpuprofile'))
const profile = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'))
const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
const self = new Map()
profile.samples.forEach((id, index) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[index] ?? 0)))
const total = [...self.values()].reduce((a, b) => a + b, 0)
const byName = new Map()
for (const [id, time] of self) {
  const { functionName, url, lineNumber } = nodes.get(id).callFrame
  const key = `${functionName || '(anon)'} ${url.split('/').slice(-2).join('/')}:${lineNumber}`
  byName.set(key, (byName.get(key) ?? 0) + time)
}
for (const [key, time] of [...byName].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${(time / total * 100).toFixed(1)}%`, key)
