import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const API = 'http://127.0.0.1:3101/api';
export const unique = (label: string) =>
  `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const pickActor = (page: Page, actor: string) =>
  page.getByLabel('Acting as').selectOption(actor);

/** A board card (its `data-status` is the task's status). */
export const taskItem = (page: Page, title: string) =>
  page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
export const statusOf = taskItem;

export const column = (page: Page, status: 'to_do' | 'pending' | 'in_progress' | 'done') =>
  page.locator(`[data-column="${status}"]`);

/** Adds a task through the inline composer at the top of the "To do" column. */
export async function addTask(page: Page, title: string, description?: string): Promise<string> {
  const opener = page.getByRole('button', { name: 'Add a task' });
  if (await opener.isVisible()) await opener.click();
  const field = page.getByLabel('Task title');
  await field.fill(title);
  if (description) {
    const reveal = page.getByRole('button', { name: 'Add description' });
    if (await reveal.isVisible()) await reveal.click();
    await page.getByLabel('Task description').fill(description);
  }
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/tasks') && r.request().method() === 'POST',
  );
  await field.press('Enter');
  const id = ((await (await created).json()) as { task: { id: string } }).task.id;
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  return id;
}

/** Real mouse drag: grab the card, move past the activation distance, drop on the column. */
export async function dragCardTo(
  page: Page,
  title: string,
  status: 'to_do' | 'pending' | 'in_progress' | 'done',
) {
  const from = await taskItem(page, title).boundingBox();
  const to = await column(page, status).boundingBox();
  if (!from || !to) throw new Error('card or column not visible');
  await page.mouse.move(from.x + 24, from.y + 16);
  await page.mouse.down();
  await page.mouse.move(from.x + 44, from.y + 32, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + 50, { steps: 14 });
  return { drop: () => page.mouse.up() };
}

export const popup = (page: Page) => page.getByRole('dialog', { name: 'Task details' });
/**
 * Waits until a move has fully finished: its confirmation toast only appears after the server
 * answered and the board refetched. The short pause lets dnd-kit's own 50 ms "ignore the click that
 * follows a drag" guard expire. (Checking `aria-busy` alone races: it can read "not busy" before
 * React has rendered the busy state.)
 */
export async function movedTo(page: Page, label: string) {
  await expect(page.getByText(`Moved to ${label}`).first()).toBeVisible();
  await page.waitForTimeout(150);
}

export const historyOf = (page: Page) =>
  popup(page).getByRole('list', { name: 'History, oldest first' });

/** Opens the card popup by clicking the card title. */
export async function openCard(page: Page, title: string) {
  await taskItem(page, title).getByRole('button', { name: title, exact: true }).click();
  await expect(popup(page)).toBeVisible();
  return popup(page);
}

/**
 * Starts a test from an empty board. The backend is shared by the whole run, so without this a
 * long "To do" column would push the card being dragged below the visible viewport.
 * (Deleting is a soft delete; each task's history is kept.)
 */
export async function clearBoard(request: APIRequestContext) {
  const { tasks } = (await (await request.get(`${API}/tasks`)).json()) as {
    tasks: { id: string }[];
  };
  for (const t of tasks)
    await request.delete(`${API}/tasks/${t.id}`, { headers: { 'X-Actor': 'john.doe' } });
}
