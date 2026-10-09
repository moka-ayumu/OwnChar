import { expect, test } from '@playwright/test'
import type { FileChooser, Page } from '@playwright/test'
import { savedProject, startProject, storedProject, writingCanvas } from './helpers'

const PROMPT_ID = `initial-0-${'ㄹ'.codePointAt(0)}`

/** Opens the menu that holds the save, open and delete actions on the write page. */
async function openMenu(page: Page) {
  await page.getByRole('button', { name: /작업 저장 메뉴/ }).click()
}

/** Chooses a file in the dialog that the open action starts. */
async function openFile(page: Page, file: Parameters<FileChooser['setFiles']>[0]) {
  await openMenu(page)
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: '파일에서 불러오기' }).click()
  await (await chooser).setFiles(file)
}

test('saves the project to a file and restores it after the project is reset', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept())

  await startProject(page)
  const { stroke } = await writingCanvas(page)
  await stroke(6, 25, 34, 74, 34)
  await savedProject(page, (saved) => Boolean(saved.drawings[PROMPT_ID]))

  await openMenu(page)
  const download = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: '파일로 저장' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/\.ownchar$/)
  const path = await file.path()

  await page.goto('/')
  await page.getByRole('button', { name: /새 폰트 시작하기/ }).click()
  await expect(page).toHaveURL(/\/write$/)
  await savedProject(page, (saved) => !saved.drawings[PROMPT_ID])

  await openFile(page, path)
  await expect(page).toHaveURL(/\/write$/)
  const restored = await savedProject(page, (saved) => Boolean(saved.drawings[PROMPT_ID]))
  expect(restored.drawings[PROMPT_ID].elements.length).toBeGreaterThan(0)
})

test('rejects a file that is not a project archive and keeps the current project', async ({ page }) => {
  const messages: string[] = []
  page.on('dialog', (dialog) => {
    messages.push(dialog.message())
    void dialog.accept()
  })
  await startProject(page)
  await openFile(page, { name: 'broken.ownchar', mimeType: 'application/zip', buffer: Buffer.from('not a zip') })
  await expect.poll(() => messages.length).toBe(2)
  expect(messages[1]).toContain('OwnChar 프로젝트 파일이 아닙니다')
  await expect(page).toHaveURL(/\/write$/)
})

test('shows that the project is autosaved and deletes the saved project on request', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept())

  await startProject(page)
  const { stroke } = await writingCanvas(page)
  await stroke(6, 25, 34, 74, 34)
  await savedProject(page, (saved) => Boolean(saved.drawings[PROMPT_ID]))
  await expect(page.getByRole('status')).toHaveText('저장됨')

  await openMenu(page)
  await page.getByRole('menuitem', { name: '이 기기의 저장 내용 삭제' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect.poll(() => storedProject(page)).toBeNull()
  await openMenu(page)
  await expect(page.getByRole('menuitem', { name: '이 기기의 저장 내용 삭제' })).toHaveAttribute('aria-disabled', 'true')
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(page.getByRole('button', { name: /이어서 만들기/ })).toHaveCount(0)
})
