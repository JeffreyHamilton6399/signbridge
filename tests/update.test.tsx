/**
 * The update path.
 *
 * This exists because the previous version of it was a `console.info` call,
 * which meant a shipped fix could never reach anyone who had already loaded the
 * app: the service worker kept serving the old bundle and reloading changed
 * nothing. A silent update mechanism is indistinguishable from a broken one.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useUpdate } from '@/pwa';
import { UpdatePrompt } from '@/ui/UpdatePrompt';

beforeEach(() => {
  useUpdate.setState({ updateReady: false, offlineReady: false, dismissed: false });
});

describe('update prompt', () => {
  it('stays out of the way when there is no update', () => {
    render(<UpdatePrompt />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('appears when a newer build is waiting', () => {
    useUpdate.getState().setUpdateReady(true);
    render(<UpdatePrompt />);
    expect(screen.getByRole('status')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeVisible();
  });

  it('promises that settings survive the reload', () => {
    useUpdate.getState().setUpdateReady(true);
    render(<UpdatePrompt />);
    expect(screen.getByText(/settings and calibration are kept/i)).toBeVisible();
  });

  it('can be dismissed', async () => {
    useUpdate.getState().setUpdateReady(true);
    render(<UpdatePrompt />);
    await userEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('comes back when a further update arrives after being dismissed', () => {
    useUpdate.getState().setUpdateReady(true);
    useUpdate.getState().dismiss();
    expect(useUpdate.getState().dismissed).toBe(true);

    // A second update must clear the dismissal, or one "Later" silences every
    // future fix for the life of the tab.
    useUpdate.getState().setUpdateReady(true);
    expect(useUpdate.getState().dismissed).toBe(false);
  });

  it('applying the update triggers the reload path', async () => {
    useUpdate.getState().setUpdateReady(true);
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      reload,
    } as unknown as Location);

    render(<UpdatePrompt />);
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalled();
  });
});
