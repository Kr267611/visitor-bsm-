import { ApiError, NetworkError, ScanRequest } from '@visitor/shared';
import { createScanGate } from './createScanGate';
import { scanWithRetry } from './scanWithRetry';

describe('createScanGate', () => {
  it('same value within cooldown is rejected', () => {
    const gate = createScanGate(3000);
    expect(gate.accept('qr', 1000)).toBe(true);
    expect(gate.accept('qr', 1100)).toBe(false);
    expect(gate.accept('qr', 3999)).toBe(false);
  });

  it('same value after cooldown accepted; different value accepted at once', () => {
    const gate = createScanGate(3000);
    gate.accept('qr', 1000);
    expect(gate.accept('qr', 4000)).toBe(true);
    expect(gate.accept('other', 4001)).toBe(true);
  });

  it('camera reading a QR repeatedly keeps extending nothing', () => {
    const gate = createScanGate(3000);
    gate.accept('qr', 0);
    for (let t = 100; t < 3000; t += 100) gate.accept('qr', t);
    expect(gate.accept('qr', 3000)).toBe(true);
  });
});

describe('scanWithRetry', () => {
  const req: ScanRequest = { qr: 'q', gateId: 'g', mode: 'IN', clientEventId: 'event-1' };
  const ok = { result: 'CHECKED_IN', visitId: 'v', visitor: { name: 'R', company: null, photoUrl: null }, host: 'A', validTo: 'x' };

  it('retries network error with same clientEventId', async () => {
    const seen: string[] = [];
    const api = {
      gate: {
        scan: jest.fn(async (body: ScanRequest) => {
          seen.push(body.clientEventId);
          if (seen.length === 1) throw new NetworkError();
          return ok;
        }),
      },
    };
    const res = await scanWithRetry(api as never, req, 0);
    expect(res).toEqual({ kind: 'ok', data: ok });
    expect(seen).toEqual(['event-1', 'event-1']);
  });

  it('does not retry ApiError', async () => {
    const error = new ApiError(409, 'ALREADY_CHECKED_IN', 'Already inside', { gate: 'G' });
    const api = { gate: { scan: jest.fn(async () => Promise.reject(error)) } };
    const res = await scanWithRetry(api as never, req, 0);
    expect(res).toEqual({ kind: 'rejected', error });
    expect(api.gate.scan).toHaveBeenCalledTimes(1);
  });

  it('returns network after 2 retries', async () => {
    const api = { gate: { scan: jest.fn(async () => Promise.reject(new NetworkError())) } };
    const res = await scanWithRetry(api as never, req, 0);
    expect(res).toEqual({ kind: 'network' });
    expect(api.gate.scan).toHaveBeenCalledTimes(3);
  });
});
