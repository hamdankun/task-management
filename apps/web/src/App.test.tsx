import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { App } from './App';
import { createFakeApi } from './test/fake-api';

async function renderApp(
  setup?: (ctx: ReturnType<typeof createFakeApi>) => Promise<void> | void,
  actor: string | null = 'john.doe',
) {
  const ctx = createFakeApi();
  await setup?.(ctx);
  if (actor) localStorage.setItem('tm.actor', actor);
  const user = userEvent.setup();
  render(<App api={ctx.api} />);
  return { ...ctx, user };
}
const column = (label: string) => screen.getByRole('region', { name: label });
const cardIn = (label: string, title: string) =>
  within(column(label)).getByRole('heading', { name: title }).closest('li') as HTMLElement;
const card = (title: string) =>
  screen.getByRole('heading', { name: title }).closest('li') as HTMLElement;
const boardCard = (title: string) =>
  screen.getByRole('heading', { name: title, level: 3, hidden: true }).closest('li') as HTMLElement;
const statusOf = (title: string) => card(title).getAttribute('data-status');
const openComposer = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: 'Add a task' }));
  return screen.getByLabelText('Task title');
};

describe('board', () => {
  it('should place each task in the column of its status, newest first, with counts', async () => {
    await renderApp(async ({ seed }) => {
      await seed('Older task');
      await seed('Newer task');
      await seed('Prepare invoice', ['pending']);
      await seed('Finished', ['pending', 'in_progress', 'done']);
    });
    await screen.findByRole('heading', { name: 'Prepare invoice' });
    expect(
      within(column('To do'))
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(['Older task', 'Newer task']); // oldest first: new cards land above the composer
    expect(
      within(column('Pending')).getByRole('heading', { name: 'Prepare invoice' }),
    ).toBeInTheDocument();
    expect(within(column('In progress')).getByText('Nothing in progress.')).toBeInTheDocument();
    expect(within(column('Done')).getByRole('heading', { name: 'Finished' })).toBeInTheDocument();
    expect(within(column('To do')).getByLabelText('2 tasks')).toHaveTextContent('2');
    expect(statusOf('Prepare invoice')).toBe('pending');
  });

  it('should show small indicators for a description and an assignee, not the description text', async () => {
    await renderApp(async ({ seed }) => {
      await seed('Plain');
      await seed('Detailed', [], 'Send to finance', 'jane.smith');
    });
    await screen.findByRole('heading', { name: 'Detailed' });
    expect(within(card('Detailed')).getByText('Has a description')).toBeInTheDocument();
    expect(within(card('Detailed')).getByText('Assigned to jane.smith')).toBeInTheDocument();
    expect(within(card('Detailed')).getByText('JS')).toBeInTheDocument(); // avatar initials
    expect(screen.queryByText('Send to finance')).not.toBeInTheDocument();
    expect(
      within(card('Plain')).queryByText(/Has a description|Assigned to/),
    ).not.toBeInTheDocument();
  });

  it('should show skeleton columns while loading', async () => {
    const ctx = createFakeApi();
    ctx.api.listTasks.mockReturnValue(new Promise(() => undefined));
    render(<App api={ctx.api} />);
    expect(await screen.findByLabelText('Loading tasks')).toBeInTheDocument();
  });

  it('should show empty columns', async () => {
    await renderApp();
    expect(await screen.findByText('Nothing waiting.')).toBeInTheDocument();
    expect(screen.getByText('Nothing done yet.')).toBeInTheDocument();
  });

  it('should show a load error and recover on Retry', async () => {
    const ctx = createFakeApi();
    await ctx.seed('Prepare invoice');
    ctx.api.listTasks.mockRejectedValueOnce(new ApiError('NETWORK_ERROR', 'down'));
    const user = userEvent.setup();
    render(<App api={ctx.api} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Can't reach the task service. Check your connection and try again.",
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Prepare invoice' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should render hostile text as plain text, never as markup', async () => {
    const xss = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    await renderApp(async ({ seed }) => void (await seed(xss, [], '<b>bold</b>')));
    expect(await screen.findByRole('heading', { name: xss })).toBeInTheDocument();
    expect(document.querySelector('img, script, b')).toBeNull();
  });
});

describe('acting as', () => {
  it('should disable changes and explain why until an actor is chosen', async () => {
    const { user } = await renderApp(
      async ({ seed }) => void (await seed('Prepare invoice')),
      null,
    );
    await screen.findByRole('heading', { name: 'Prepare invoice' });
    expect(screen.getByText('Choose who you are to add or change tasks.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a task' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Move to Pending/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Delete Prepare invoice/ })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Acting as'), 'jane.smith');
    expect(screen.getByRole('button', { name: 'Add a task' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Move to Pending/ })).toBeEnabled();
    expect(
      screen.queryByText('Choose who you are to add or change tasks.'),
    ).not.toBeInTheDocument();
    expect(localStorage.getItem('tm.actor')).toBe('jane.smith');
  });

  it('should restore a saved actor and say the choice is not authenticated', async () => {
    await renderApp(undefined, 'jane.smith');
    await waitFor(() => expect(screen.getByLabelText('Acting as')).toHaveValue('jane.smith'));
    expect(screen.getByText(/Not authenticated/)).toBeInTheDocument();
  });

  it('should discard a saved actor that is not in the server list', async () => {
    await renderApp(undefined, 'ghost');
    await screen.findByText('Nothing waiting.');
    expect(screen.getByLabelText('Acting as')).toHaveValue('');
    expect(localStorage.getItem('tm.actor')).toBeNull();
  });

  it('should still work when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { user } = await renderApp(undefined, null);
    await user.selectOptions(await screen.findByLabelText('Acting as'), 'john.doe');
    expect(screen.getByLabelText('Acting as')).toHaveValue('john.doe');
  });
});

describe('inline composer', () => {
  it('should add on Enter, keep the composer open and focused for the next task, and confirm', async () => {
    const { api, user } = await renderApp();
    const title = await openComposer(user);
    expect(title).toHaveFocus();
    await user.type(title, '  Prepare invoice {Enter}');
    expect(
      await within(column('To do')).findByRole('heading', { name: 'Prepare invoice' }),
    ).toBeInTheDocument();
    expect(api.createTask).toHaveBeenCalledWith('john.doe', {
      title: '  Prepare invoice ',
      description: undefined,
    });
    expect(screen.getByLabelText('Task title')).toHaveValue('');
    expect(screen.getByLabelText('Task title')).toHaveFocus();
    expect(await screen.findByText('Task added')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Task title'), 'Second{Enter}');
    expect(await screen.findByRole('heading', { name: 'Second' })).toBeInTheDocument();
  });

  it('should add on the button and send an optional description', async () => {
    const { api, user } = await renderApp();
    await user.type(await openComposer(user), 'Prepare invoice');
    await user.click(screen.getByRole('button', { name: 'Add description' }));
    await user.type(screen.getByLabelText('Task description'), 'Send to finance');
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    expect(api.createTask).toHaveBeenCalledWith('john.doe', {
      title: 'Prepare invoice',
      description: 'Send to finance',
    });
    expect(
      await within(
        await screen
          .findByRole('heading', { name: 'Prepare invoice' })
          .then((h) => h.closest('li') as HTMLElement),
      ).findByText('Has a description'),
    ).toBeInTheDocument();
  });

  it('should close on Escape or Cancel, discarding the draft and returning focus to the opener', async () => {
    const { api, user } = await renderApp();
    await user.type(await openComposer(user), 'Draft{Escape}');
    expect(screen.queryByLabelText('Task title')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add a task' })).toHaveFocus());
    await user.type(await openComposer(user), 'Another');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Task title')).not.toBeInTheDocument();
    expect(api.createTask).not.toHaveBeenCalled();
  });

  it('should show validation under the field, not in the banner, and keep the text', async () => {
    const { user } = await renderApp();
    await user.type(await openComposer(user), '   {Enter}');
    expect(await screen.findByText('Title is required')).toBeInTheDocument();
    expect(screen.getByLabelText('Task title')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Task title')).toHaveValue('   ');
  });

  it('should submit once even if Enter is pressed twice while saving', async () => {
    const { api, user } = await renderApp();
    const title = await openComposer(user);
    let release!: () => void;
    const original = api.createTask.getMockImplementation()!;
    api.createTask.mockImplementationOnce(async (...args) => {
      await new Promise<void>((r) => (release = r));
      return original(...args);
    });
    await user.type(title, 'Once{Enter}');
    const busy = await screen.findByRole('button', { name: 'Adding…' });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    await user.type(title, '{Enter}');
    release();
    await screen.findByRole('heading', { name: 'Once' });
    expect(api.createTask).toHaveBeenCalledTimes(1);
  });

  it('should show a server error in the banner and keep the typed text', async () => {
    const { api, user } = await renderApp();
    const title = await openComposer(user);
    api.createTask.mockRejectedValueOnce(
      new ApiError('INTERNAL_ERROR', 'boom', 500, { requestId: 'req-123' }),
    );
    await user.type(title, 'Keep me{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong on our side. Try again. (Ref: req-123)',
    );
    expect(screen.getByLabelText('Task title')).toHaveValue('Keep me');
  });

  it('should offer the composer only in the To do column', async () => {
    await renderApp();
    await screen.findByText('Nothing waiting.');
    expect(within(column('To do')).getByRole('button', { name: 'Add a task' })).toBeInTheDocument();
    for (const label of ['Pending', 'In progress', 'Done']) {
      expect(
        within(column(label)).queryByRole('button', { name: 'Add a task' }),
      ).not.toBeInTheDocument();
    }
  });
});

describe('moving a task (button alternative to dragging)', () => {
  it('should offer only the next step and move the card to the next column', async () => {
    const { api, user } = await renderApp(async ({ seed }) => void (await seed('Prepare invoice')));
    await screen.findByRole('heading', { name: 'Prepare invoice' });
    expect(screen.getAllByRole('button', { name: /^Move to/ })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Move to Pending: Prepare invoice' }));
    await waitFor(() =>
      expect(
        within(column('Pending')).getByRole('heading', { name: 'Prepare invoice' }),
      ).toBeInTheDocument(),
    );
    expect(
      within(column('To do')).queryByRole('heading', { name: 'Prepare invoice' }),
    ).not.toBeInTheDocument();
    expect(api.changeStatus).toHaveBeenCalledWith('john.doe', expect.any(String), 'pending');
    expect(
      screen.getByRole('button', { name: 'Move to In progress: Prepare invoice' }),
    ).toBeEnabled();
    expect(await screen.findByText('Moved to Pending')).toBeInTheDocument();
  });

  it('should offer no move once a task is done', async () => {
    await renderApp(
      async ({ seed }) => void (await seed('Finished', ['pending', 'in_progress', 'done'])),
    );
    await screen.findByRole('heading', { name: 'Finished' });
    expect(statusOf('Finished')).toBe('done');
    expect(screen.queryByRole('button', { name: /^Move to/ })).not.toBeInTheDocument();
  });

  it('should show the card in its target column while the request is in flight, then settle on the server state', async () => {
    const { api, user } = await renderApp(async ({ seed }) => void (await seed('Prepare invoice')));
    await screen.findByRole('heading', { name: 'Prepare invoice' });
    let release!: () => void;
    const original = api.changeStatus.getMockImplementation()!;
    api.changeStatus.mockImplementationOnce(async (...args) => {
      await new Promise<void>((r) => (release = r));
      return original(...args);
    });
    await user.click(screen.getByRole('button', { name: /Move to Pending/ }));
    const moving = cardIn('Pending', 'Prepare invoice');
    expect(moving).toHaveAttribute('aria-busy', 'true');
    const button = within(moving).getByRole('button', { name: /Move to In progress/ });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await user.click(button); // ignored while saving
    release();
    await waitFor(() =>
      expect(cardIn('Pending', 'Prepare invoice')).not.toHaveAttribute('aria-busy'),
    );
    expect(api.changeStatus).toHaveBeenCalledTimes(1);
  });

  it('should put the card back and explain when the server refuses (the task changed in another tab)', async () => {
    const { api, user, tasks } = await renderApp(
      async ({ seed }) => void (await seed('Prepare invoice')),
    );
    await screen.findByRole('heading', { name: 'Prepare invoice' });
    tasks[0]!.status = 'done'; // another tab moved it all the way; this tab still shows "To do"
    const before = api.listTasks.mock.calls.length;
    await user.click(screen.getByRole('button', { name: /Move to Pending/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This task was changed in another tab. The list was refreshed.',
    );
    await waitFor(() =>
      expect(
        within(column('Done')).getByRole('heading', { name: 'Prepare invoice' }),
      ).toBeInTheDocument(),
    );
    expect(api.listTasks.mock.calls.length).toBeGreaterThan(before);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should report a no-op when the server says nothing changed', async () => {
    const { api, user } = await renderApp(async ({ seed }) => void (await seed('Prepare invoice')));
    await screen.findByRole('heading', { name: 'Prepare invoice' });
    api.changeStatus.mockImplementationOnce(async (_a, taskId) => ({
      task: {
        ...(await api.listTasks()).find((t) => t.id === taskId)!,
        status: 'pending' as const,
      },
      changed: false,
      auditLog: null,
    }));
    await user.click(screen.getByRole('button', { name: /Move to Pending/ }));
    expect(await screen.findByText('Already Pending. Nothing changed.')).toBeInTheDocument();
  });
});

describe('deleting', () => {
  it('should ask first, keep the task on Cancel, and delete on confirm', async () => {
    const { api, user } = await renderApp(async ({ seed }) => void (await seed('Prepare invoice')));
    await screen.findByRole('heading', { name: 'Prepare invoice' });

    await user.click(screen.getByRole('button', { name: 'Delete Prepare invoice' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Delete “Prepare invoice”?')).toBeInTheDocument();
    expect(
      within(dialog).getByText('The task leaves the board. Its history is kept.'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.deleteTask).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Prepare invoice' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete Prepare invoice' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete task' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Prepare invoice' })).not.toBeInTheDocument(),
    );
    expect(api.deleteTask).toHaveBeenCalledWith('john.doe', expect.any(String));
    expect(await screen.findByText('Task deleted')).toBeInTheDocument();
  });

  it('should explain and refresh when the task is already gone', async () => {
    const { api, user, tasks } = await renderApp(
      async ({ seed }) => void (await seed('Prepare invoice')),
    );
    await screen.findByRole('heading', { name: 'Prepare invoice' });
    tasks.length = 0; // deleted elsewhere
    await user.click(screen.getByRole('button', { name: 'Delete Prepare invoice' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete task' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That task no longer exists. The list was refreshed.',
    );
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Prepare invoice' })).not.toBeInTheDocument(),
    );
    expect(api.deleteTask).toHaveBeenCalledTimes(1);
  });
});

describe('card popup', () => {
  const openCard = async (user: ReturnType<typeof userEvent.setup>, title: string) => {
    await user.click(within(card(title)).getByRole('button', { name: title }));
    return screen.findByRole('dialog', { name: 'Task details' });
  };

  it('should open on click of the title or the card and show title, assignee, description and activity', async () => {
    const { user } = await renderApp(async ({ seed }) => {
      await seed('Other task');
      await seed('Prepare invoice', ['pending'], 'Send to finance', 'jane.smith');
    });
    await screen.findByRole('heading', { name: 'Prepare invoice' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const dialog = await openCard(user, 'Prepare invoice');
    expect(
      within(dialog).getByRole('button', { name: 'Edit title: Prepare invoice' }),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Assignee')).toHaveValue('jane.smith');
    expect(within(dialog).getByText('Send to finance')).toBeInTheDocument();
    expect(dialog.querySelector('[data-status]')).toHaveAttribute('data-status', 'pending'); // header badge
    const ledger = await within(dialog).findByRole('list', { name: 'History, oldest first' });
    expect(within(ledger).getAllByRole('listitem')).toHaveLength(3); // created, moved, assigned
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(card('Other task')); // anywhere on the card, not only the title
    expect(await screen.findByRole('dialog', { name: 'Task details' })).toBeInTheDocument();
  });

  it('should list activity oldest first with full sentences, including edits', async () => {
    const { api, user } = await renderApp(
      async ({ seed }) => void (await seed('Prepare invoice', ['pending'])),
    );
    await screen.findByRole('heading', { name: 'Prepare invoice' });
    const dialog = await openCard(user, 'Prepare invoice');
    await user.selectOptions(within(dialog).getByLabelText('Assignee'), 'jane.smith');
    await waitFor(() => expect(api.updateTask).toHaveBeenCalled());
    const ledger = await within(dialog).findByRole('list', { name: 'History, oldest first' });
    await waitFor(() => expect(within(ledger).getAllByRole('listitem')).toHaveLength(3));
    const sentences = within(ledger)
      .getAllByRole('listitem')
      .map((li) => li.querySelector('.sr-only')?.textContent);
    expect(sentences).toEqual([
      'john.doe created "Prepare invoice" at 2025-01-01 09:00',
      'john.doe changed "Prepare invoice" from "To do" to "Pending" at 2025-01-01 09:01',
      'john.doe assigned "Prepare invoice" to jane.smith at 2025-01-01 09:02',
    ]);
    expect(within(ledger).queryByRole('button')).not.toBeInTheDocument(); // read-only: no edit/delete controls
  });

  it('should edit the title inline: Enter saves, the card updates, the change is logged', async () => {
    const { api, user } = await renderApp(async ({ seed }) => void (await seed('Prepare invoice')));
    await screen.findByRole('heading', { name: 'Prepare invoice' });
    const dialog = await openCard(user, 'Prepare invoice');
    await user.click(within(dialog).getByRole('button', { name: 'Edit title: Prepare invoice' }));
    const input = within(dialog).getByRole('textbox', { name: 'Title' });
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, 'Prepare invoice v2{Enter}');
    await waitFor(() =>
      expect(api.updateTask).toHaveBeenCalledWith('john.doe', expect.any(String), {
        title: 'Prepare invoice v2',
      }),
    );
    expect(
      await within(dialog).findByRole('button', { name: 'Edit title: Prepare invoice v2' }),
    ).toBeInTheDocument();
    expect((await screen.findAllByText('Saved')).length).toBeGreaterThan(0);
    expect(api.updateTask).toHaveBeenCalledTimes(1); // Enter + the blur that follows must not save twice
    expect(await within(dialog).findByText('renamed the task')).toBeInTheDocument();
  });

  it('should save the title when the field loses focus, and do nothing when unchanged', async () => {
    const { api, user } = await renderApp(async ({ seed }) => void (await seed('Prepare invoice')));
    await screen.findByRole('heading', { name: 'Prepare invoice' });
    const dialog = await openCard(user, 'Prepare invoice');
    await user.click(within(dialog).getByRole('button', { name: 'Edit title: Prepare invoice' }));
    await user.tab(); // leaves the field without changes
    expect(api.updateTask).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Edit title: Prepare invoice' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Title' }), ' now');
    await user.tab();
    await waitFor(() =>
      expect(api.updateTask).toHaveBeenCalledWith('john.doe', expect.any(String), {
        title: 'Prepare invoice now',
      }),
    );
  });

  it('should cancel a title edit with Escape without closing the dialog', async () => {
    const { api, user } = await renderApp(async ({ seed }) => void (await seed('Prepare invoice')));
    await screen.findByRole('heading', { name: 'Prepare invoice' });
    const dialog = await openCard(user, 'Prepare invoice');
    await user.click(within(dialog).getByRole('button', { name: 'Edit title: Prepare invoice' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Title' }), ' changed{Escape}');
    expect(screen.getByRole('dialog', { name: 'Task details' })).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'Edit title: Prepare invoice' }),
    ).toBeInTheDocument();
    expect(api.updateTask).not.toHaveBeenCalled();
    await user.keyboard('{Escape}'); // now nothing is being edited: Escape closes the dialog
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('should show a blank title as an error next to the field and keep editing', async () => {
    const { user } = await renderApp(async ({ seed }) => void (await seed('Prepare invoice')));
    await screen.findByRole('heading', { name: 'Prepare invoice' });
    const dialog = await openCard(user, 'Prepare invoice');
    await user.click(within(dialog).getByRole('button', { name: 'Edit title: Prepare invoice' }));
    await user.clear(within(dialog).getByRole('textbox', { name: 'Title' }));
    await user.keyboard('{Enter}');
    expect(await within(dialog).findByText('Title is required')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Title' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('should edit the description with Save, show "Unsaved changes", and offer Discard changes', async () => {
    const { api, user } = await renderApp(
      async ({ seed }) => void (await seed('Prepare invoice', [], 'Old text')),
    );
    await screen.findByRole('heading', { name: 'Prepare invoice' });
    const dialog = await openCard(user, 'Prepare invoice');
    await user.click(within(dialog).getByRole('button', { name: 'Edit description' }));
    const field = within(dialog).getByRole('textbox', { name: 'Description' });
    expect(within(dialog).queryByText('Unsaved changes')).not.toBeInTheDocument();
    await user.type(field, ' and more');
    expect(within(dialog).getByText('Unsaved changes')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Discard changes' }));
    expect(api.updateTask).not.toHaveBeenCalled();
    expect(within(dialog).getByText('Old text')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Edit description' }));
    await user.clear(within(dialog).getByRole('textbox', { name: 'Description' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Description' }), 'New text');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.updateTask).toHaveBeenCalledWith('john.doe', expect.any(String), {
        description: 'New text',
      }),
    );
    expect(await within(dialog).findByText('New text')).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox', { name: 'Description' })).not.toBeInTheDocument();
  });

  it('should clear a description by saving it empty and offer to add one again', async () => {
    const { api, user } = await renderApp(
      async ({ seed }) => void (await seed('Prepare invoice', [], 'Old text')),
    );
    await screen.findByRole('heading', { name: 'Prepare invoice' });
    const dialog = await openCard(user, 'Prepare invoice');
    await user.click(within(dialog).getByRole('button', { name: 'Edit description' }));
    await user.clear(within(dialog).getByRole('textbox', { name: 'Description' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.updateTask).toHaveBeenCalledWith('john.doe', expect.any(String), {
        description: '',
      }),
    );
    expect(
      await within(dialog).findByRole('button', { name: 'Add a description' }),
    ).toBeInTheDocument();
  });

  it('should cancel a description edit with Escape without closing the dialog', async () => {
    const { user } = await renderApp(async ({ seed }) => void (await seed('Prepare invoice')));
    await screen.findByRole('heading', { name: 'Prepare invoice' });
    const dialog = await openCard(user, 'Prepare invoice');
    await user.click(within(dialog).getByRole('button', { name: 'Add a description' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Description' }), 'draft{Escape}');
    expect(screen.getByRole('dialog', { name: 'Task details' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox', { name: 'Description' })).not.toBeInTheDocument();
  });

  it('should assign and unassign a user and reflect it on the card', async () => {
    const { api, user } = await renderApp(async ({ seed }) => void (await seed('Prepare invoice')));
    await screen.findByRole('heading', { name: 'Prepare invoice' });
    const dialog = await openCard(user, 'Prepare invoice');
    const select = within(dialog).getByLabelText('Assignee');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Unassigned', 'john.doe', 'jane.smith']);
    await user.selectOptions(select, 'jane.smith');
    await waitFor(() =>
      expect(api.updateTask).toHaveBeenCalledWith('john.doe', expect.any(String), {
        assignee: 'jane.smith',
      }),
    );
    await waitFor(() =>
      expect(
        within(boardCard('Prepare invoice')).queryByText('Assigned to jane.smith'),
      ).toBeInTheDocument(),
    );
    await user.selectOptions(within(dialog).getByLabelText('Assignee'), '');
    await waitFor(() =>
      expect(api.updateTask).toHaveBeenLastCalledWith('john.doe', expect.any(String), {
        assignee: null,
      }),
    );
    await waitFor(() =>
      expect(
        within(boardCard('Prepare invoice')).queryByText(/Assigned to/),
      ).not.toBeInTheDocument(),
    );
  });

  it('should be read-only until an actor is chosen', async () => {
    const { user } = await renderApp(
      async ({ seed }) => void (await seed('Prepare invoice', [], 'Text')),
      null,
    );
    await screen.findByRole('heading', { name: 'Prepare invoice' });
    const dialog = await openCard(user, 'Prepare invoice');
    expect(
      within(dialog).getByRole('button', { name: 'Edit title: Prepare invoice' }),
    ).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Edit description' })).toBeDisabled();
    expect(within(dialog).getByLabelText('Assignee')).toBeDisabled();
    expect(within(dialog).getByText('Choose who you are to edit this task.')).toBeInTheDocument();
    expect(within(dialog).getByRole('list', { name: 'History, oldest first' })).toBeInTheDocument(); // history stays readable
  });

  it('should list all four statuses in the Status dropdown and allow only the next one', async () => {
    const { user } = await renderApp(
      async ({ seed }) => void (await seed('Prepare invoice', ['pending'])),
    );
    await screen.findByRole('heading', { name: 'Prepare invoice' });
    const dialog = await openCard(user, 'Prepare invoice');
    const select = within(dialog).getByLabelText('Status');
    expect(select).toHaveValue('pending');
    const options = within(select).getAllByRole('option') as HTMLOptionElement[];
    expect(options.map((o) => [o.textContent, o.disabled])).toEqual([
      ['To do', true], // going back is not allowed
      ['Pending', false], // current
      ['In progress', false], // the next status
      ['Done', true], // a skip
    ]);
  });

  it('should move the task forward from the Status dropdown', async () => {
    const { api, user } = await renderApp(async ({ seed }) => void (await seed('Prepare invoice')));
    await screen.findByRole('heading', { name: 'Prepare invoice' });
    const dialog = await openCard(user, 'Prepare invoice');
    await user.selectOptions(within(dialog).getByLabelText('Status'), 'pending');
    await waitFor(() =>
      expect(api.changeStatus).toHaveBeenCalledWith('john.doe', expect.any(String), 'pending'),
    );
    await waitFor(() => expect(within(dialog).getByLabelText('Status')).toHaveValue('pending'));
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Pending', hidden: true })).getByRole('heading', {
          name: 'Prepare invoice',
          hidden: true,
        }),
      ).toBeInTheDocument(),
    );
  });

  it('should not let the Status dropdown go back or skip, and disable it once done', async () => {
    const { api, user } = await renderApp(async ({ seed }) => {
      await seed('Midway', ['pending']);
      await seed('Finished', ['pending', 'in_progress', 'done']);
    });
    await screen.findByRole('heading', { name: 'Midway' });
    let dialog = await openCard(user, 'Midway');
    await user.selectOptions(within(dialog).getByLabelText('Status'), 'to_do'); // disabled option: ignored
    await user.selectOptions(within(dialog).getByLabelText('Status'), 'done'); // disabled option: ignored
    expect(api.changeStatus).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    dialog = await openCard(user, 'Finished');
    expect(within(dialog).getByLabelText('Status')).toBeDisabled();
  });

  it('should disable the Status dropdown until an actor is chosen', async () => {
    const { user } = await renderApp(
      async ({ seed }) => void (await seed('Prepare invoice')),
      null,
    );
    await screen.findByRole('heading', { name: 'Prepare invoice' });
    const dialog = await openCard(user, 'Prepare invoice');
    expect(within(dialog).getByLabelText('Status')).toBeDisabled();
  });

  it('should explain a server error from a save and keep the popup open', async () => {
    const { api, user } = await renderApp(async ({ seed }) => void (await seed('Prepare invoice')));
    await screen.findByRole('heading', { name: 'Prepare invoice' });
    const dialog = await openCard(user, 'Prepare invoice');
    api.updateTask.mockRejectedValueOnce(
      new ApiError('INTERNAL_ERROR', 'boom', 500, { requestId: 'req-9' }),
    );
    await user.selectOptions(within(dialog).getByLabelText('Assignee'), 'jane.smith');
    expect(await screen.findByText(/Something went wrong on our side/)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Task details' })).toBeInTheDocument();
  });

  it('should show a history error with Retry', async () => {
    const { api, user } = await renderApp(async ({ seed }) => void (await seed('Prepare invoice')));
    await screen.findByRole('heading', { name: 'Prepare invoice' });
    api.listAuditLogs.mockRejectedValueOnce(new ApiError('NETWORK_ERROR', 'down'));
    const dialog = await openCard(user, 'Prepare invoice');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "Can't reach the task service",
    );
    await user.click(within(dialog).getByRole('button', { name: 'Retry' }));
    expect(
      await within(dialog).findByRole('list', { name: 'History, oldest first' }),
    ).toBeInTheDocument();
  });

  it('should close the popup if its task disappears', async () => {
    const { user, tasks, api } = await renderApp(
      async ({ seed }) => void (await seed('Prepare invoice')),
    );
    await screen.findByRole('heading', { name: 'Prepare invoice' });
    await openCard(user, 'Prepare invoice');
    tasks.length = 0; // deleted elsewhere
    api.updateTask.mockRejectedValueOnce(new ApiError('TASK_NOT_FOUND', 'gone', 404));
    await user.selectOptions(screen.getByLabelText('Assignee'), 'jane.smith');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Task details' })).not.toBeInTheDocument(),
    );
  });
});

describe('composer placement', () => {
  it('should sit below the cards in the To do column, like Trello', async () => {
    await renderApp(async ({ seed }) => void (await seed('First')));
    const heading = await screen.findByRole('heading', { name: 'First' });
    const opener = within(column('To do')).getByRole('button', { name: 'Add a task' });
    expect(heading.compareDocumentPosition(opener) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
