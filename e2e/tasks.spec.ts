import { expect, test } from '@playwright/test';
import {
  addTask,
  API,
  clearBoard,
  column,
  dragCardTo,
  historyOf,
  movedTo,
  openCard,
  pickActor,
  popup,
  statusOf,
  taskItem,
  unique,
} from './helpers';

test('create, advance through the whole flow, read the history, delete, history survives', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Task log' })).toBeVisible();
  await pickActor(page, 'john.doe');

  const title = unique('Prepare invoice');
  const id = await addTask(page, title, 'Send to finance by Friday');
  const row = taskItem(page, title);
  await expect(row.getByText('Has a description')).toBeAttached(); // the card shows an indicator, the text lives in the popup
  await expect(
    column(page, 'to_do').getByRole('heading', { name: title, exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Task added')).toBeVisible();

  // The card travels column to column; only the next step is offered.
  for (const [label, status] of [
    ['Pending', 'pending'],
    ['In progress', 'in_progress'],
    ['Done', 'done'],
  ] as const) {
    await expect(row.getByRole('button', { name: /^Move to/ })).toHaveCount(1);
    await row.getByRole('button', { name: new RegExp(`Move to ${label}`) }).click();
    await expect(statusOf(page, title)).toHaveAttribute('data-status', status);
    await expect(
      column(page, status).getByRole('heading', { name: title, exact: true }),
    ).toBeVisible();
  }
  await expect(row.getByRole('button', { name: /^Move to/ })).toHaveCount(0);

  // History: chronological, with actor and from -> to.
  const dialog = await openCard(page, title);
  await expect(dialog.getByText('Send to finance by Friday')).toBeVisible();
  const sentences = historyOf(page).locator('li > .sr-only');
  await expect(sentences).toHaveCount(4);
  const texts = await sentences.allTextContents();
  expect(texts[0]).toMatch(
    new RegExp(`^john\\.doe created "${title}" at \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}$`),
  );
  expect(texts[1]).toContain('from "To do" to "Pending"');
  expect(texts[2]).toContain('from "Pending" to "In progress"');
  expect(texts[3]).toContain('from "In progress" to "Done"');
  await expect(historyOf(page).getByRole('button')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(popup(page)).toHaveCount(0);

  // Delete needs confirmation; Cancel keeps the task.
  await row.getByRole('button', { name: `Delete ${title}` }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: `Delete ${title}` }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete task' }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toHaveCount(0);

  // The audit log outlives the task.
  const logs = (await (await request.get(`${API}/tasks/${id}/audit-logs`)).json()) as {
    auditLogs: { action: string; actor: string }[];
  };
  expect(logs.auditLogs.map((l) => l.action)).toEqual([
    'created',
    'status_changed',
    'status_changed',
    'status_changed',
    'deleted',
  ]);
  expect(new Set(logs.auditLogs.map((l) => l.actor))).toEqual(new Set(['john.doe']));
  expect((await request.get(`${API}/tasks/${id}`)).status()).toBe(404);
});

test('dragging a card to the next column moves it and records who did it', async ({
  page,
  request,
}) => {
  await clearBoard(request);
  await page.goto('/');
  await pickActor(page, 'jane.smith');
  const title = unique('Drag me');
  const id = await addTask(page, title);

  const drag = await dragCardTo(page, title, 'pending');
  // While dragging, the only valid column is highlighted and says where to drop.
  await expect(column(page, 'pending')).toContainText('Drop here');
  await drag.drop();

  await expect(statusOf(page, title)).toHaveAttribute('data-status', 'pending');
  await expect(
    column(page, 'pending').getByRole('heading', { name: title, exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Moved to Pending')).toBeVisible();

  const { auditLogs } = (await (await request.get(`${API}/tasks/${id}/audit-logs`)).json()) as {
    auditLogs: {
      action: string;
      actor: string;
      fromStatus: string | null;
      toStatus: string | null;
    }[];
  };
  expect(auditLogs).toHaveLength(2);
  expect(auditLogs[1]).toMatchObject({
    action: 'status_changed',
    actor: 'jane.smith',
    fromStatus: 'to_do',
    toStatus: 'pending',
  });
});

test('dragging past the next column is refused with an explanation and changes nothing', async ({
  page,
  request,
}) => {
  await clearBoard(request);
  await page.goto('/');
  await pickActor(page, 'john.doe');
  const title = unique('No skipping');
  const id = await addTask(page, title);

  const drag = await dragCardTo(page, title, 'done');
  await drag.drop();

  await expect(
    page.getByText('Tasks move one step at a time. This one can go to Pending.'),
  ).toBeVisible();
  await expect(statusOf(page, title)).toHaveAttribute('data-status', 'to_do');
  const { auditLogs } = (await (await request.get(`${API}/tasks/${id}/audit-logs`)).json()) as {
    auditLogs: unknown[];
  };
  expect(auditLogs).toHaveLength(1);
});

test('a done card cannot be moved anywhere: the flow only goes forward', async ({
  page,
  request,
}) => {
  await clearBoard(request);
  await page.goto('/');
  await pickActor(page, 'john.doe');
  const title = unique('Finished');
  const id = await addTask(page, title);
  for (const [label, status] of [
    ['Pending', 'pending'],
    ['In progress', 'in_progress'],
    ['Done', 'done'],
  ] as const) {
    await taskItem(page, title)
      .getByRole('button', { name: new RegExp(`Move to ${label}`) })
      .click();
    await expect(statusOf(page, title)).toHaveAttribute('data-status', status);
  }
  await movedTo(page, 'Done'); // saved: a saving card is not draggable
  const drag = await dragCardTo(page, title, 'in_progress');
  await drag.drop();
  await expect(page.getByText("Done tasks can't move.")).toBeVisible();
  await expect(statusOf(page, title)).toHaveAttribute('data-status', 'done');

  const { auditLogs } = (await (await request.get(`${API}/tasks/${id}/audit-logs`)).json()) as {
    auditLogs: { toStatus: string }[];
  };
  expect(auditLogs.map((l) => l.toStatus)).toEqual(['to_do', 'pending', 'in_progress', 'done']); // the refused drop wrote nothing
});

test('dragging a card backward is refused with an explanation and changes nothing', async ({
  page,
  request,
}) => {
  await clearBoard(request);
  await page.goto('/');
  await pickActor(page, 'jane.smith');
  const title = unique('No way back');
  const id = await addTask(page, title);
  await taskItem(page, title)
    .getByRole('button', { name: /Move to Pending/ })
    .click();
  await expect(statusOf(page, title)).toHaveAttribute('data-status', 'pending');
  await movedTo(page, 'Pending');

  const drag = await dragCardTo(page, title, 'to_do');
  await expect(column(page, 'in_progress')).toContainText('Drop here'); // only the next column is a target
  await expect(column(page, 'to_do')).not.toContainText('Drop here');
  await drag.drop();
  await expect(
    page.getByText('Tasks move one step at a time. This one can go to In progress.'),
  ).toBeVisible();
  await expect(statusOf(page, title)).toHaveAttribute('data-status', 'pending');

  const { auditLogs } = (await (await request.get(`${API}/tasks/${id}/audit-logs`)).json()) as {
    auditLogs: unknown[];
  };
  expect(auditLogs).toHaveLength(2); // created + the one move
});

test('the Status dropdown in the popup offers only the next status', async ({ page, request }) => {
  await page.goto('/');
  await pickActor(page, 'budi.santoso');
  const title = unique('Dropdown');
  const id = await addTask(page, title);
  const dialog = await openCard(page, title);
  const status = dialog.getByLabel('Status');

  // All four statuses are listed so the flow is visible; only the next one can be chosen.
  await expect(status.locator('option')).toHaveText(['To do', 'Pending', 'In progress', 'Done']);
  await expect(status.locator('option[value="pending"]')).toBeEnabled();
  await expect(status.locator('option[value="in_progress"]')).toBeDisabled();
  await expect(status.locator('option[value="done"]')).toBeDisabled();

  await status.selectOption('pending');
  await expect(status).toHaveValue('pending');
  await expect(status.locator('option[value="to_do"]')).toBeDisabled(); // no way back
  await expect(status.locator('option[value="in_progress"]')).toBeEnabled();
  await expect(status.locator('option[value="done"]')).toBeDisabled();

  await status.selectOption('in_progress');
  await status.selectOption('done');
  await expect(status).toBeDisabled(); // done is the last status
  await expect(historyOf(page).getByRole('listitem')).toHaveCount(4);

  const { auditLogs } = (await (await request.get(`${API}/tasks/${id}/audit-logs`)).json()) as {
    auditLogs: { actor: string; toStatus: string | null }[];
  };
  expect(auditLogs.map((l) => [l.actor, l.toStatus])).toEqual([
    ['budi.santoso', 'to_do'],
    ['budi.santoso', 'pending'],
    ['budi.santoso', 'in_progress'],
    ['budi.santoso', 'done'],
  ]);
});

test('the inline composer supports rapid entry and closes with Escape', async ({ page }) => {
  await page.goto('/');
  await pickActor(page, 'john.doe');
  const first = unique('Rapid one');
  const second = unique('Rapid two');
  await addTask(page, first);
  await expect(page.getByLabel('Task title')).toBeFocused(); // still open, ready for the next one
  await addTask(page, second);
  await expect(
    column(page, 'to_do').getByRole('heading', { name: second, exact: true }),
  ).toBeVisible();
  await expect(
    column(page, 'to_do').getByRole('heading', { name: first, exact: true }),
  ).toBeVisible();

  await page.getByLabel('Task title').fill('Never saved');
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Task title')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add a task' })).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Never saved' })).toHaveCount(0);
});

test('edit a card in the popup: title, description, assignee, all attributed in the activity', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await pickActor(page, 'john.doe');
  const title = unique('Edit me');
  const id = await addTask(page, title);
  const dialog = await openCard(page, title);

  // Title: click, type, Enter.
  const renamed = `${title} v2`;
  await dialog.getByRole('button', { name: `Edit title: ${title}` }).click();
  await expect(dialog.getByRole('textbox', { name: 'Title' })).toBeFocused();
  await dialog.getByRole('textbox', { name: 'Title' }).fill(renamed);
  await dialog.getByRole('textbox', { name: 'Title' }).press('Enter');
  await expect(dialog.getByRole('button', { name: `Edit title: ${renamed}` })).toBeVisible();

  // Description: Save needs an explicit click and an "Unsaved changes" hint appears while editing.
  await dialog.getByRole('button', { name: 'Add a description' }).click();
  await dialog.getByRole('textbox', { name: 'Description' }).fill('Line one\nLine two');
  await expect(dialog.getByText('Unsaved changes')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Line one')).toBeVisible();
  await expect(dialog.getByText('Unsaved changes')).toHaveCount(0);

  // Assignee.
  await dialog.getByLabel('Assignee').selectOption('jane.smith');
  await expect(dialog.getByLabel('Assignee')).toHaveValue('jane.smith');

  // The activity pane lists each change, oldest first, with who did it.
  const sentences = historyOf(page).locator('li > .sr-only');
  await expect(sentences).toHaveCount(4);
  const texts = await sentences.allTextContents();
  expect(texts[1]).toContain(`john.doe renamed "${title}" to "${renamed}"`);
  expect(texts[2]).toContain(`john.doe added a description to "${renamed}"`);
  expect(texts[3]).toContain(`john.doe assigned "${renamed}" to jane.smith`);

  // The card reflects it, and it survives a reload.
  await page.keyboard.press('Escape');
  await expect(popup(page)).toHaveCount(0);
  await page.reload();
  const card = taskItem(page, renamed);
  await expect(card.getByText('Has a description')).toBeAttached();
  await expect(card.getByText('Assigned to jane.smith')).toBeAttached();
  await expect(card.getByText('JS')).toBeVisible();

  // The audit log recorded old and new values.
  const { auditLogs } = (await (await request.get(`${API}/tasks/${id}/audit-logs`)).json()) as {
    auditLogs: {
      action: string;
      field: string | null;
      fromValue: string | null;
      toValue: string | null;
    }[];
  };
  expect(
    auditLogs.filter((l) => l.action === 'edited').map((l) => [l.field, l.fromValue, l.toValue]),
  ).toEqual([
    ['title', title, renamed],
    ['description', null, 'Line one\nLine two'],
    ['assignee', null, 'jane.smith'],
  ]);
});

test('Escape and Discard changes only cancel the edit; unchanged fields are not saved', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await pickActor(page, 'john.doe');
  const title = unique('Cancel me');
  const id = await addTask(page, title);
  const dialog = await openCard(page, title);

  await dialog.getByRole('button', { name: `Edit title: ${title}` }).click();
  await dialog.getByRole('textbox', { name: 'Title' }).fill('Something else');
  await page.keyboard.press('Escape');
  await expect(popup(page)).toBeVisible(); // still open: Escape only cancelled the edit
  await expect(dialog.getByRole('button', { name: `Edit title: ${title}` })).toBeVisible();

  await dialog.getByRole('button', { name: 'Add a description' }).click();
  await dialog.getByRole('textbox', { name: 'Description' }).fill('discard this');
  await dialog.getByRole('button', { name: 'Discard changes' }).click();
  await expect(dialog.getByRole('button', { name: 'Add a description' })).toBeVisible();

  await dialog.getByRole('button', { name: `Edit title: ${title}` }).click();
  await page.keyboard.press('Tab'); // leave the field without changing it
  await page.keyboard.press('Escape');
  await expect(popup(page)).toHaveCount(0); // nothing being edited: Escape closes the popup

  const { auditLogs } = (await (await request.get(`${API}/tasks/${id}/audit-logs`)).json()) as {
    auditLogs: unknown[];
  };
  expect(auditLogs).toHaveLength(1); // only "created"
});

test('a blank title is refused next to the field and nothing is saved', async ({ page }) => {
  await page.goto('/');
  await pickActor(page, 'john.doe');
  const title = unique('Keep me');
  await addTask(page, title);
  const dialog = await openCard(page, title);
  await dialog.getByRole('button', { name: `Edit title: ${title}` }).click();
  await dialog.getByRole('textbox', { name: 'Title' }).fill('   ');
  await dialog.getByRole('textbox', { name: 'Title' }).press('Enter');
  await expect(dialog.getByText('Title is required')).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Title' })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
});

test('clicking opens the popup but dragging does not', async ({ page, request }) => {
  await clearBoard(request);
  await page.goto('/');
  await pickActor(page, 'john.doe');
  const title = unique('Click or drag');
  await addTask(page, title);
  await page.keyboard.press('Escape'); // close the composer

  const drag = await dragCardTo(page, title, 'pending');
  await drag.drop();
  await expect(statusOf(page, title)).toHaveAttribute('data-status', 'pending');
  await expect(popup(page)).toHaveCount(0); // the drop did not count as a click

  await movedTo(page, 'Pending'); // the move finished saving
  await taskItem(page, title).click({ position: { x: 20, y: 8 } }); // padding, not the title button
  await expect(popup(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popup(page)).toHaveCount(0);
});

test('"Add a task" sits at the bottom of the To do column and new cards land just above it', async ({
  page,
}) => {
  await page.goto('/');
  await pickActor(page, 'john.doe');
  const first = unique('First');
  const second = unique('Second');
  await addTask(page, first);
  await addTask(page, second);
  const boxes = await Promise.all([
    taskItem(page, first).boundingBox(),
    taskItem(page, second).boundingBox(),
    column(page, 'to_do').getByRole('form', { name: 'New task' }).boundingBox(),
  ]);
  const [a, b, composer] = boxes;
  expect(a && b && composer).toBeTruthy();
  expect(a!.y).toBeLessThan(b!.y); // oldest first
  expect(b!.y).toBeLessThan(composer!.y); // composer below the newest card
});

test('records who made each change, and the actor choice and tasks survive a reload', async ({
  page,
}) => {
  await page.goto('/');
  await pickActor(page, 'jane.smith');
  const title = unique('Shared task');
  await addTask(page, title);
  await pickActor(page, 'budi.santoso');
  await taskItem(page, title)
    .getByRole('button', { name: /Move to Pending/ })
    .click();
  await expect(statusOf(page, title)).toHaveAttribute('data-status', 'pending');

  await page.reload();
  await expect(page.getByLabel('Acting as')).toHaveValue('budi.santoso');
  await expect(statusOf(page, title)).toHaveAttribute('data-status', 'pending');
  await openCard(page, title);
  const entries = historyOf(page).locator('li > .sr-only');
  await expect(entries).toHaveCount(2);
  const texts = await entries.allTextContents();
  expect(texts[0]).toContain(`jane.smith created "${title}"`);
  expect(texts[1]).toContain(`budi.santoso changed "${title}" from "To do" to "Pending"`);
});

test('blocks changes until an actor is chosen and validates the title', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Choose who you are to add or change tasks.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add a task' })).toBeDisabled();
  await pickActor(page, 'john.doe');
  await page.getByRole('button', { name: 'Add a task' }).click();
  await page.getByLabel('Task title').fill('   ');
  await page.getByLabel('Task title').press('Enter');
  await expect(page.getByText('Title is required')).toBeVisible();
  await expect(page.getByLabel('Task title')).toHaveAttribute('aria-invalid', 'true');
});

test('a stale tab cannot corrupt history: duplicates are no-ops, outdated moves are explained', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const a = await context.newPage();
  const b = await context.newPage();
  await a.goto('/');
  await pickActor(a, 'john.doe');
  const title = unique('Race');
  const id = await addTask(a, title);
  await b.goto('/');
  await expect(statusOf(b, title)).toHaveAttribute('data-status', 'to_do');

  // Tab A moves it all the way to Done; tab B still shows "To do".
  for (const [label, status] of [
    ['Pending', 'pending'],
    ['In progress', 'in_progress'],
    ['Done', 'done'],
  ] as const) {
    await taskItem(a, title)
      .getByRole('button', { name: new RegExp(`Move to ${label}`) })
      .click();
    await expect(statusOf(a, title)).toHaveAttribute('data-status', status);
  }

  // Outdated request from B (Done -> Pending would be a skip) => explained, the card ends up where the server says.
  await taskItem(b, title)
    .getByRole('button', { name: /Move to Pending/ })
    .click();
  await expect(b.getByRole('alert')).toContainText(
    'This task was changed in another tab. The list was refreshed.',
  );
  await expect(statusOf(b, title)).toHaveAttribute('data-status', 'done');
  await expect(column(b, 'done').getByRole('heading', { name: title, exact: true })).toBeVisible();

  // A duplicate of an already-applied move is an idempotent no-op with no extra log.
  const api = context.request;
  const dup = await api.put(`${API}/tasks/${id}/status`, {
    headers: { 'X-Actor': 'john.doe' },
    data: { status: 'done' },
  });
  expect(await dup.json()).toMatchObject({ changed: false, auditLog: null });
  const { auditLogs } = (await (await api.get(`${API}/tasks/${id}/audit-logs`)).json()) as {
    auditLogs: unknown[];
  };
  expect(auditLogs).toHaveLength(4);
  await context.close();
});

test('hostile text is shown as text and never executed', async ({ page }) => {
  await page.goto('/');
  await pickActor(page, 'john.doe');
  const marker = unique('xss');
  const title = `<img src=x onerror="window.__pwned='${marker}'"> ${marker}`;
  await addTask(page, title, '<script>window.__pwned2=1</script>');
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const dialog = await openCard(page, title);
  await expect(dialog.getByText('<script>window.__pwned2=1</script>')).toBeVisible(); // shown as text
  expect(await dialog.locator('img, script').count()).toBe(0);
  await page.keyboard.press('Escape');
  expect(
    await page.evaluate(() => (window as unknown as Record<string, unknown>).__pwned),
  ).toBeUndefined();
  expect(
    await page.evaluate(() => (window as unknown as Record<string, unknown>).__pwned2),
  ).toBeUndefined();
  expect(await page.locator('main img, main script').count()).toBe(0);
  await openCard(page, title);
  await expect(historyOf(page)).toContainText(title);
});

test('the API refuses cross-site, rebound-host and unattributed requests', async ({ request }) => {
  const ok = await request.get(`${API}/actors`);
  expect(ok.status()).toBe(200);
  expect(ok.headers()).toMatchObject({
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  });
  expect(ok.headers()['x-powered-by']).toBeUndefined();
  expect(ok.headers()['access-control-allow-origin']).toBeUndefined();

  const rebound = await request.get(`${API}/actors`, { headers: { Host: 'evil.com' } });
  expect(rebound.status()).toBe(403);
  expect((await rebound.json()).error.code).toBe('FORBIDDEN_HOST');

  const preflight = await request.fetch(`${API}/tasks`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'DELETE' },
  });
  expect(preflight.headers()['access-control-allow-origin']).toBeUndefined();

  const noActor = await request.post(`${API}/tasks`, { data: { title: 'x' } });
  expect(noActor.status()).toBe(400);
  expect((await noActor.json()).error.code).toBe('INVALID_ACTOR');
  const formPost = await request.post(`${API}/tasks`, {
    headers: { 'X-Actor': 'john.doe', 'Content-Type': 'text/plain' },
    data: 'title=x',
  });
  expect(formPost.status()).toBe(400);
});
