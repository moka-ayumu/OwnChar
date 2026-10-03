import { expect, test } from '@playwright/test'
import { savedProject, startProject, writingCanvas } from './helpers'

// First sentence: 배고픈 너구리가 … — cell 1 is 고, cell 6 is 리.
const id = (role: string, variant: number, char: string) => `${role}-${variant}-${char.codePointAt(0)}`

test('splits the strokes of a syllable into its jamo and keeps them across a reload', async ({ page }) => {
  await startProject(page)
  await expect(page.getByRole('heading', { name: '배고픈 너구리가 몰래 부엌에서 닭볶음탕을 끓여 먹었대요' })).toBeVisible()
  await expect(page.getByTestId('writing-canvas')).toHaveAttribute('data-cell-size', '148')
  await page.getByRole('slider', { name: '글자 칸 크기' }).press('ArrowRight')
  await expect(page.getByTestId('writing-canvas')).toHaveAttribute('data-cell-size', '152')

  const { frame, stroke } = await writingCanvas(page)
  await stroke(1, 40, 35, 100, 35) // ㄱ
  await stroke(1, 70, 60, 70, 95) // ㅗ
  await stroke(1, 30, 95, 115, 95)
  await expect(page.getByText('고 · ㄱ')).toBeVisible()
  await expect(page.getByText('고 · ㅗ')).toBeVisible()
  await expect(frame).toHaveAttribute('data-assignment-prompts', [id('initial', 1, 'ㄱ'), id('medial', 0, 'ㅗ'), id('medial', 0, 'ㅗ')].join(','))
  await expect(page.getByText('작성한 획의 칸 위치를 보존하기 위해 크기가 고정됐어요.')).toBeVisible()

  const project = await savedProject(page, (saved) => saved.writingSessions['hangul-sentence-0']?.elements.length === 3)
  expect(project.schemaVersion).toBe(1)
  expect(project.drawings[id('initial', 1, 'ㄱ')].capture).toEqual({ exerciseId: 'hangul-sentence-0', cellIndex: 1, slotIndex: 0 })
  // The contextual ㄱ also serves as the standalone consonant.
  expect(project.drawings[`consonant-${'ㄱ'.codePointAt(0)}`].derivedFromPromptId).toBe(id('initial', 1, 'ㄱ'))

  await page.reload()
  await expect(page.getByText('고 · ㄱ')).toBeVisible()
  await expect(page.getByText('고 · ㅗ')).toBeVisible()
  await page.getByRole('button', { name: '다음 문장' }).click()
  await expect(page.getByText('고 · ㄱ')).toHaveCount(0)
  await page.getByRole('button', { name: '이전 문장' }).click()
  await expect(page.getByText('고 · ㅗ')).toBeVisible()
})

test('a jamo can be finished by hand before its usual stroke count, and the boundary undone', async ({ page }) => {
  await startProject(page)
  const { frame, stroke } = await writingCanvas(page)
  // ㄹ is usually three strokes; write it in one.
  await stroke(6, 25, 34, 74, 34)
  await page.getByRole('button', { name: '리 · 초성 ㄹ 완료' }).click()
  await stroke(6, 100, 30, 100, 110)
  await expect(frame).toHaveAttribute('data-assignment-prompts', new RegExp(id('medial', 0, 'ㅣ')))
  await expect(page.getByText('리 · ㅣ')).toBeVisible()
  await savedProject(page, (saved) => saved.writingSessions['hangul-sentence-0']?.elements.length === 2 && saved.writingSessions['hangul-sentence-0'].boundaries[6]?.length === 1)
  await page.reload()
  await expect(page.getByText('리 · ㅣ')).toBeVisible()
  await page.getByRole('button', { name: '경계 되돌리기' }).click()
  await expect(page.getByText('리 · ㅣ')).toHaveCount(0)
  await expect(page.getByText('리 · ㄹ')).toBeVisible()
})

test('a pen stroke records its pressure and does not scroll the canvas', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Pen pointer events are sent through Chromium CDP.')
  await startProject(page)
  const region = page.locator('.sentence-canvas-region')
  const frame = page.getByTestId('writing-canvas')
  await region.evaluate((element) => { element.scrollTop = 180 })
  const scrollTop = await region.evaluate((element) => element.scrollTop)
  expect(scrollTop).toBeGreaterThan(0)
  const box = (await frame.boundingBox())!
  const client = await page.context().newCDPSession(page)
  const x = box.x + 35
  const y = Math.max(box.y + 35, 120)
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, pointerType: 'pen' })
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: 0.05 })
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + 35, y, button: 'left', buttons: 1, pointerType: 'pen', force: 0.5 })
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 35, y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' })
  const project = await savedProject(page, (saved) => saved.writingSessions['hangul-sentence-0']?.elements[0]?.pressures.length === 2)
  const { pressures } = project.writingSessions['hangul-sentence-0'].elements[0]
  expect(pressures[0]).toBeCloseTo(0.05, 3)
  expect(pressures[1]).toBeCloseTo(0.5, 3)
  expect(await region.evaluate((element) => element.scrollTop)).toBe(scrollTop)
  await frame.hover({ position: { x: 35, y: 35 } })
  await page.mouse.wheel(0, 80)
  await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBeGreaterThan(scrollTop)
})
