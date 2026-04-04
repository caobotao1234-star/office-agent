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
    await ns.notify('hello');
    expect(cb).toHaveBeenCalledWith('hello');
  });

  it('should notify multiple channels', async () => {
    const ns = new NotificationService();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    ns.addChannel(cb1);
    ns.addChannel(cb2);
    await ns.notify('test');
    expect(cb1).toHaveBeenCalledWith('test');
    expect(cb2).toHaveBeenCalledWith('test');
  });

  it('should remove channels', async () => {
    const ns = new NotificationService();
    const cb = vi.fn();
    ns.addChannel(cb);
    ns.removeChannel(cb);
    expect(ns.hasChannels()).toBe(false);
    await ns.notify('ignored');
    expect(cb).not.toHaveBeenCalled();
  });

  it('should not throw if a channel callback fails', async () => {
    const ns = new NotificationService();
    ns.addChannel(() => { throw new Error('boom'); });
    const cb2 = vi.fn();
    ns.addChannel(cb2);
    await ns.notify('test');
    // Second channel still called despite first throwing
    expect(cb2).toHaveBeenCalledWith('test');
  });
});
