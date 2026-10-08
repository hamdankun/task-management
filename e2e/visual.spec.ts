import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  addTask,
  clearBoard,
  dragCardTo,
  historyOf,
  openCard,
  pickActor,
  popup,
  statusOf,
  taskItem,
  unique,
} from './helpers';

const VIEWPORTS = [
  { name: 'mobile', width: 360, height: 800 },
  { name: 'tablet', width: 768, height: 900 },
  { name: 'desktop', width: 1280, height: 900 },
] as const;

async function populate(page: Page, request: APIRequestContext) {
  await clearBoard(request);
  await page.goto('/');
  await pickActor(page, 'john.doe');
  const done = unique('Ship the quarterly report with a deliberately long title to test wrapping');
  const wip = unique('Prepare invoice');
  const todo = unique('Book venue');
  await addTask(page, todo, 'Check capacity and catering for the offsite.');
  await addTask(page, wip, 'Send to finance by Friday.\nCheck totals twice.');
  await addTask(page, done);
  await page.keyboard.press('Escape'); // close the composer so the board is at rest
  const path = ['pending', 'in_progress', 'done'] as const;
  for (const [t, steps] of [
    [wip, 2],
    [done, 3],
  ] as const) {
    for (const status of path.slice(0, steps)) {
      await taskItem(page, t)
        .getByRole('button', { name: /^Move to/ })
        .click();
      await expect(statusOf(page, t)).toHaveAttribute('data-status', status);
    }
  }
  return { wip, todo };
}

const settle = (page: Page) =>
  page.waitForFunction(() => document.getAnimations().every((a) => a.playState === 'finished'));

for (const scheme of ['light', 'dark'] as const) {
  for (const vp of VIEWPORTS) {
    test(`${scheme} ${vp.name}: no page overflow and no accessibility violations`, async ({
      page,
      request,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const { wip } = await populate(page, request);
      await settle(page);

      // The page content never scrolls sideways: on narrow screens the board scrolls inside its own
      // region. (Measured on the content, not the document: toasts slide in from off-screen.)
      expect(
        await page.evaluate(() => {
          const content = document.querySelector('#root > div') as HTMLElement;
          return content.scrollWidth - content.clientWidth;
        }),
      ).toBeLessThanOrEqual(0);
      await page.screenshot({
        path: `test-results/screens/${scheme}-${vp.name}.png`,
        fullPage: true,
      });
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(
        results.violations.map(
          (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
        ),
      ).toEqual([]);

      // The composer open, the history dialog and the delete dialog are part of the UI too.
      await page.getByRole('button', { name: 'Add a task' }).click();
      await settle(page);
      await page.screenshot({ path: `test-results/screens/${scheme}-${vp.name}-composer.png` });
      const composer = await new AxeBuilder({ page })
        .include('form[aria-label="New task"]')
        .analyze();
      expect(composer.violations.map((v) => v.id)).toEqual([]);
      await page.keyboard.press('Escape');

      await openCard(page, wip);
      await expect(historyOf(page).getByRole('listitem')).toHaveCount(3);
      await settle(page);
      await page.screenshot({ path: `test-results/screens/${scheme}-${vp.name}-popup.png` });
      const history = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
      expect(
        history.violations.map(
          (v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 120)).join(' | ')}`,
        ),
      ).toEqual([]);

      // Editing states: title input, description editor with "Unsaved changes".
      await popup(page)
        .getByRole('button', { name: `Edit title: ${wip}` })
        .click();
      await popup(page).getByRole('button', { name: 'Edit description' }).click({ force: true });
      await popup(page)
        .getByRole('textbox', { name: 'Description' })
        .fill('Edited but not saved yet');
      await settle(page);
      await page.screenshot({
        path: `test-results/screens/${scheme}-${vp.name}-popup-editing.png`,
      });
      const editing = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
      expect(editing.violations.map((v) => v.id)).toEqual([]);
      await popup(page).getByRole('button', { name: 'Discard changes' }).click();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(popup(page)).toHaveCount(0);

      await taskItem(page, wip)
        .getByRole('button', { name: `Delete ${wip}` })
        .click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await settle(page); // mid fade-in the browser blends colours, which makes contrast checks meaningless
      await page.screenshot({ path: `test-results/screens/${scheme}-${vp.name}-delete.png` });
      const dialog = await new AxeBuilder({ page }).include('[role="alertdialog"]').analyze();
      expect(dialog.violations.map((v) => v.id)).toEqual([]);
      await page.getByRole('button', { name: 'Cancel' }).click();
    });
  }
}

test('desktop: the drop target is highlighted while dragging (screenshot)', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { todo } = await populate(page, request);
  const drag = await dragCardTo(page, todo, 'pending');
  await expect(page.locator('[data-column="pending"]')).toContainText('Drop here');
  await page.screenshot({ path: 'test-results/screens/dragging.png' });
  await drag.drop();
  await expect(statusOf(page, todo)).toHaveAttribute('data-status', 'pending');
});

test('desktop: card quick actions appear on hover (screenshot)', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const { wip } = await populate(page, request);
  const card = taskItem(page, wip);
  const quick = card.getByRole('button', { name: `Move to Done: ${wip}` });
  const group = quick.locator('xpath=..'); // the fade is on the wrapper of the quick actions
  await page.mouse.move(0, 0);
  await expect(group).toHaveCSS('opacity', '0'); // hidden until hover or focus...
  await card.hover();
  await expect(group).toHaveCSS('opacity', '1');
  await page.screenshot({ path: 'test-results/screens/card-hover.png' });
  await page.mouse.move(0, 0);
  await quick.focus(); // ...and shown for keyboard users
  await expect(group).toHaveCSS('opacity', '1');
  await expect(quick).toHaveAccessibleName(`Move to Done: ${wip}`);
});

test('respects reduced motion and has visible keyboard focus', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await pickActor(page, 'john.doe');
  await addTask(page, unique('Keyboard'));
  await page.keyboard.press('Escape');
  await page.getByLabel('Acting as').focus();
  await page.keyboard.press('Tab');
  const outline = await page.evaluate(() => {
    const cs = getComputedStyle(document.activeElement as HTMLElement);
    return { style: cs.outlineStyle, ring: cs.boxShadow };
  });
  expect(outline.style !== 'none' || outline.ring !== 'none').toBe(true);
  const duration = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.querySelector('[data-status]')!).transitionDuration),
  );
  expect(duration).toBeLessThan(0.01);
});
