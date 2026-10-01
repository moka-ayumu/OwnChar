import { expect, test } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync, unlinkSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const url = 'http://127.0.0.1:5175'
const output = resolve('tools/out/layout-feedback-test.json')
let server: ChildProcess

test.beforeAll(async () => {
  if (existsSync(output)) unlinkSync(output)
  server = spawn(process.execPath, ['tools/tune-layout.mjs', '--port=5175', '--out=layout-feedback-test.json'], { stdio: 'pipe' })
  await expect.poll(async () => {
    try { return (await fetch(`${url}/api/session`)).status } catch { return 0 }
  }, { timeout: 30_000 }).toBe(200)
})

test.afterAll(() => {
  server?.kill()
  if (existsSync(output)) unlinkSync(output)
})

test('adjusts only the selected role and persists feedback across reloads', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1536, height: 1100 })
  await page.goto(url)
  await expect(page.getByRole('heading', { name: /^굵 / })).toBeVisible()
  await page.screenshot({ path: 'tools/out/tune-layout.png', fullPage: true })
  const session = await (await fetch(`${url}/api/session`)).json()
  const before = session.entries['굵'].paths
  const paths = (role: string) => page.locator(`#preview-svg path[data-role="${role}"]`)
  await page.getByRole('spinbutton', { name: '종성 좌우 위치 값', exact: true }).fill('65')
  await expect.poll(() => paths('final').getAttribute('d')).not.toBe(before.final)
  await expect(paths('initial')).toHaveAttribute('d', before.initial)
  await expect(paths('medial')).toHaveAttribute('d', before.medial)
  const translated = await (await fetch(`${url}/api/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ char: '굵', controls: { final: { x: 65, y: 0, scale: 1 } } }) })).json()
  const baseline = JSON.parse(readFileSync(output, 'utf8')).entries['굵'].baseline.parts.final
  expect(translated.commands.final[0].x - baseline[0].x).toBeCloseTo(65, 6)
  await expect.poll(() => JSON.parse(readFileSync(output, 'utf8')).entries['굵'].controls.final.x).toBe(65)
  await page.getByRole('spinbutton', { name: '초성 크기 값', exact: true }).fill('85')
  await expect.poll(() => paths('initial').getAttribute('d')).not.toBe(before.initial)
  await page.getByLabel('이 글자에 대한 메모').fill('받침을 오른쪽으로, 초성은 작게')
  await page.getByLabel('검토 완료', { exact: true }).check()
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await expect(page.locator('#save-status')).toContainText('자동 저장됨')
  await page.reload()
  await expect(page.getByRole('spinbutton', { name: '종성 좌우 위치 값', exact: true })).toHaveValue('65')
  await expect(page.getByRole('spinbutton', { name: '초성 크기 값', exact: true })).toHaveValue('85')
  await expect(page.getByLabel('이 글자에 대한 메모')).toHaveValue('받침을 오른쪽으로, 초성은 작게')
  await expect(page.getByLabel('검토 완료', { exact: true })).toBeChecked()
  const saved = JSON.parse(readFileSync(output, 'utf8'))
  expect(saved.entries['굵'].baseline.parts.final).toEqual(baseline)
  expect(saved.entries['굵'].adjusted.commands.final).toEqual(translated.commands.final)
  await page.getByRole('button', { name: '가 조정', exact: true }).click()
  await expect(page.getByRole('slider', { name: '종성 크기', exact: true })).toBeDisabled()
  await page.getByLabel('조정할 글자 목록').fill('굵 가 하')
  await page.getByRole('button', { name: '목록 적용', exact: true }).click()
  await expect(page.locator('#grid .tile')).toHaveCount(3)
  await page.getByRole('button', { name: '굵 조정', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: '종성 좌우 위치 값', exact: true })).toHaveValue('65')
  await page.getByRole('button', { name: '이 글자 초기화', exact: true }).click()
  await expect.poll(() => paths('final').getAttribute('d')).toBe(before.final)
  await expect.poll(() => paths('initial').getAttribute('d')).toBe(before.initial)
  await page.goto(`${url}/review`)
  await expect(page.getByRole('heading', { name: '조정본과 공통 배치 결과', exact: true })).toBeVisible()
  await expect.poll(() => page.locator('img').evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true)
  await page.screenshot({ path: 'tools/out/feedback-review-page.png', fullPage: true })
  expect(errors).toEqual([])
})
