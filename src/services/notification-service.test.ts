import { describe, it, expect, vi } from 'vitest';
import { NotificationService } from './notification-service.js';

describe('NotificationService', () => {
  it('should start with no channels', () => {
    const ns = new NotificationService();
    expect(ns.hasChannels()).toBe(false);
  });

  it('should register and notify channels', async () => {
    const ns = new NotificationService();
    const cb = vi.fn();
    ns.addChannel(cb);
    expect(ns.hasChannels()).toBe(true);
    const result = await ns.notify('hello');
    expect(cb).toHaveBeenCalledWith('hello');
    expect(result).toMatchObject({ attempted: 1, succeeded: 1, failed: 0 });
  });

  it('should notify multiple channels', async () => {
    const ns = new NotificationService();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    ns.addChannel(cb1);
    ns.addChannel(cb2);
    const result = await ns.notify('test');
    expect(cb1).toHaveBeenCalledWith('test');
    expect(cb2).toHaveBeenCalledWith('test');
    expect(result).toMatchObject({ attempted: 2, succeeded: 2, failed: 0 });
  });

  it('should remove channels', async () => {
    const ns = new NotificationService();
    const cb = vi.fn();
    ns.addChannel(cb);
    ns.removeChannel(cb);
    expect(ns.hasChannels()).toBe(false);
    const result = await ns.notify('ignored');
    expect(cb).not.toHaveBeenCalled();
    expect(result).toMatchObject({ attempted: 0, succeeded: 0, failed: 0 });
  });

  it('should not throw if a channel callback fails', async () => {
    const ns = new NotificationService();
    ns.addChannel(() => { throw new Error('boom'); });
    const cb2 = vi.fn();
    ns.addChannel(cb2);
    const result = await ns.notify('test');
    // Second channel still called despite first throwing
    expect(cb2).toHaveBeenCalledWith('test');
    expect(result).toMatchObject({ attempted: 2, succeeded: 1, failed: 1 });
    expect(result.errors).toContain('boom');
  });

  it('reports all-failed delivery without throwing', async () => {
    const ns = new NotificationService();
    ns.addChannel(() => { throw new Error('boom'); });
    const result = await ns.notify('test');

    expect(result).toMatchObject({ attempted: 1, succeeded: 0, failed: 1 });
  });
});
