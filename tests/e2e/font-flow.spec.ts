import { expect, test } from '@playwright/test'
import fs from 'node:fs/promises'
import opentype from 'opentype.js'
import { savedProject, startProject, writingCanvas } from './helpers'

test('writes a jamo, generates the font, traces a glyph back to its cell, and guards manual edits', async ({ page }) => {
  test.setTimeout(240_000)
  await startProject(page)
  const { stroke } = await writingCanvas(page)
  await stroke(1, 25, 34, 74, 34) // ㄹ of 린
  await expect(page.getByTestId('cell-popover').getByText('남은 획 2')).toBeVisible()
  await savedProject(page, (saved) => Boolean(saved.drawings[`initial-5-${'ㄹ'.codePointAt(0)}`]))

  // Generating with characters missing asks first.
  await page.getByRole('button', { name: '지금 폰트 만들기' }).click()
  await expect(page.getByRole('dialog')).toContainText('아직 수집하지 않은 글자가 있어요')
  await page.getByRole('button', { name: '그래도 생성하기' }).click()
  await expect(page.getByRole('heading', { name: '폰트를 만들고 있어요' })).toBeVisible()
  await expect(page).toHaveURL(/\/preview$/, { timeout: 150_000 })

  const preview = page.getByLabel('직접 입력해 보세요')
  await expect(preview).toHaveCSS('font-size', '80px')
  await page.getByRole('slider', { name: '미리보기 글자 크기' }).press('ArrowRight')
  await expect(preview).toHaveCSS('font-size', '82px')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /OTF 다운로드/ }).click()
  const data = await fs.readFile((await (await downloadPromise).path())!)
  const font = opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
  // Every syllable has a glyph; what was not written is empty, and unwritten symbols are left out.
  expect(font.charToGlyph('힣').advanceWidth).toBe(1000)
  expect(font.charToGlyph('린').path.commands.length).toBeGreaterThan(0)
  expect(font.charToGlyph('가').path.commands).toHaveLength(0)
  expect(font.charToGlyph('A').advanceWidth).toBe(680)
  expect(font.charToGlyph('?').index).toBe(0)

  // A glyph links to the cell its ink was written in, and back.
  await page.getByRole('link', { name: /고급 편집/ }).click()
  await page.getByPlaceholder('문자 검색').fill('린')
  await page.getByRole('button', { name: '린', exact: true }).click()
  await page.getByRole('button', { name: '초성 ㄹ' }).click()
  await expect(page).toHaveURL(/\/write\?exerciseId=hangul-sentence-0&cellIndex=1&returnGlyph=47536/)
  await expect(page.locator('[data-source-cell="true"]')).toContainText('린')
  await page.getByRole('button', { name: '기존 폰트 미리보기 · 편집' }).click()
  await expect(page).toHaveURL(/\/edit\?glyph=47536/)
  await expect(page.getByPlaceholder('문자 검색')).toHaveValue('린')

  // The composition tab previews example syllables live from the handwriting.
  await page.getByRole('button', { name: '한글 조합 설정' }).click()
  await expect(page.locator('.composition-example-card canvas')).toHaveCount(13)
  await page.getByRole('slider', { name: '수직 정렬' }).fill('0.5')
  await expect(page.getByText('0.50', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '글리프 편집' }).click()

  // Rewriting after a manual glyph edit asks what to do with the edit.
  await page.getByLabel('왼쪽 여백').fill('12')
  await expect(page.getByText('1개 수정됨')).toBeVisible()
  await page.getByRole('link', { name: /글자 다시 쓰기/ }).click()
  const canvas = await writingCanvas(page)
  await canvas.stroke(4, 40, 35, 100, 35)
  await expect(page.getByTestId('cell-popover').getByRole('button', { name: '중성 ㅡ' })).toHaveAttribute('aria-pressed', 'true')
  await savedProject(page, (saved) => saved.sourceDirty)
  await page.getByRole('button', { name: '지금 폰트 만들기' }).click()
  await page.getByRole('button', { name: '그래도 생성하기' }).click()
  await expect(page.getByRole('dialog')).toContainText('기존 글리프 보정을 어떻게 할까요?')
  await expect(page.getByRole('dialog')).toContainText('1개 글리프')
})
