import { expect, test } from '@playwright/test'
import { savedProject, startProject, writingCanvas } from './helpers'

// First sentence: 배고픈 너구리가 … — cell 1 is 고, cell 6 is 리.
const id = (role: string, variant: number, char: string) => `${role}-${variant}-${char.codePointAt(0)}`

test('splits the strokes of a syllable into its jamo and keeps them across a reload', async ({ page }) => {
  await startProject(page)
  await expect(page.getByRole('heading', { name: '배고픈 너구리가 몰래 부엌에서 닭볶음탕을 끓여 먹었대요' })).toBeVisible()
  await expect(page.getByTestId('writing-canvas')).toHaveAttribute('data-cell-size', '148')
  await page.getByRole('button', { name: '쓰기 설정' }).click()
  await page.getByRole('slider', { name: '글자 칸 크기' }).press('ArrowRight')
  await expect(page.getByTestId('writing-canvas')).toHaveAttribute('data-cell-size', '152')

  const { frame, stroke } = await writingCanvas(page)
  const cell = (index: number) => frame.locator('.writing-grid > div').nth(index)
  const popover = page.getByTestId('cell-popover')
  await stroke(1, 40, 35, 100, 35) // ㄱ
  // The popover beside the cell follows collection to the next jamo.
  await expect(popover.getByRole('button', { name: '중성 ㅗ' })).toHaveAttribute('aria-pressed', 'true')
  await expect(popover.getByText('남은 획 2')).toBeVisible()
  await expect(cell(1)).not.toHaveAttribute('data-complete')
  await stroke(1, 70, 60, 70, 95) // ㅗ
  await stroke(1, 30, 95, 115, 95)
  // A finished cell is marked, and its popover leaves the next cell free.
  await expect(cell(1)).toHaveAttribute('data-complete', 'true')
  await expect(popover).toHaveCount(0)
  // The space after it counts as finished once writing has moved past it.
  await expect(cell(3)).not.toHaveAttribute('data-complete')
  await stroke(4, 40, 35, 100, 35)
  await expect(cell(3)).toHaveAttribute('data-complete', 'true')
  await page.getByRole('button', { name: '실행 취소' }).click()
  await expect(frame).toHaveAttribute('data-assignment-prompts', [id('initial', 1, 'ㄱ'), id('medial', 0, 'ㅗ'), id('medial', 0, 'ㅗ')].join(','))
  // The locked size explains itself on hover.
  await page.getByRole('button', { name: '쓰기 설정' }).click()
  await page.getByRole('slider', { name: '글자 칸 크기' }).hover({ force: true })
  await expect(page.getByRole('tooltip')).toHaveText('작성한 획의 칸 위치를 보존하기 위해 크기가 고정됐어요.')

  const project = await savedProject(page, (saved) => saved.writingSessions['hangul-sentence-0']?.elements.length === 3)
  expect(project.schemaVersion).toBe(1)
  expect(project.drawings[id('initial', 1, 'ㄱ')].capture).toEqual({ exerciseId: 'hangul-sentence-0', cellIndex: 1, slotIndex: 0 })
  // The contextual ㄱ also serves as the standalone consonant.
  expect(project.drawings[`consonant-${'ㄱ'.codePointAt(0)}`].derivedFromPromptId).toBe(id('initial', 1, 'ㄱ'))

  await page.reload()
  await expect(cell(1)).toHaveAttribute('data-complete', 'true')
  await page.getByRole('button', { name: '다음 문장' }).click()
  await expect(frame).toHaveAttribute('data-assignment-prompts', '')
  await page.getByRole('button', { name: '이전 문장' }).click()
  await expect(cell(1)).toHaveAttribute('data-complete', 'true')
})

test('a jamo can be finished by hand before its usual stroke count, and collection moved back to it', async ({ page }) => {
  await startProject(page)
  const { frame, stroke } = await writingCanvas(page)
  const popover = page.getByTestId('cell-popover')
  const initial = `initial-\\d+-${'ㄹ'.codePointAt(0)}`
  const split = new RegExp(`^${initial},${id('medial', 0, 'ㅣ')}$`)
  // ㄹ is usually three strokes; write it in one.
  await stroke(6, 25, 34, 74, 34)
  await expect(popover.getByText('남은 획 2')).toBeVisible()
  await popover.getByRole('button', { name: 'ㄹ 완료' }).click()
  await expect(popover.getByRole('button', { name: '중성 ㅣ' })).toHaveAttribute('aria-pressed', 'true')
  await stroke(6, 100, 30, 100, 110)
  await expect(frame).toHaveAttribute('data-assignment-prompts', split)
  await savedProject(page, (saved) => saved.writingSessions['hangul-sentence-0']?.elements.length === 2 && saved.writingSessions['hangul-sentence-0'].boundaries[6]?.length === 1)
  await page.reload()
  await expect(frame).toHaveAttribute('data-assignment-prompts', split)
  // The finished cell is opened again from its corner, and ㄹ takes the second stroke back.
  await page.getByRole('button', { name: '리 칸의 자모 나누기 고치기' }).click()
  await popover.getByRole('button', { name: '초성 ㄹ', exact: true }).click()
  await expect(frame).toHaveAttribute('data-assignment-prompts', new RegExp(`^${initial},${initial}$`))
  await expect(popover.getByRole('button', { name: '초성 ㄹ', exact: true })).toHaveAttribute('aria-pressed', 'true')
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
  // The frame is scrolled up; write in a part of it that is inside the scrolling region.
  const y = Math.max(box.y + 35, (await region.boundingBox())!.y + 24)
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, pointerType: 'pen' })
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: 0.05 })
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + 35, y, button: 'left', buttons: 1, pointerType: 'pen', force: 0.5 })
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 35, y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' })
  const project = await savedProject(page, (saved) => saved.writingSessions['hangul-sentence-0']?.elements[0]?.pressures.length === 2)
  const { pressures } = project.writingSessions['hangul-sentence-0'].elements[0]
  expect(pressures[0]).toBeCloseTo(0.05, 3)
  expect(pressures[1]).toBeCloseTo(0.5, 3)
  expect(await region.evaluate((element) => element.scrollTop)).toBe(scrollTop)
  await frame.hover({ position: { x: 35, y: scrollTop + 60 } })
  await page.mouse.wheel(0, 80)
  await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBeGreaterThan(scrollTop)
})
