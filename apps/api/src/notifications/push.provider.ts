export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

export interface PushMessage {
  token: string;
  body: string;
  data: Record<string, string>;
}

export interface PushProvider {
  /** Fail hone par throw karta hai. */
  send(message: PushMessage): Promise<void>;
}

/** Sirf tests ke liye. */
export class FakePushProvider implements PushProvider {
  readonly sent: PushMessage[] = [];
  failing = false;

  async send(message: PushMessage) {
    if (this.failing) throw new Error('Push service down');
    this.sent.push(message);
  }
}

/** Expo push service. Android par yeh FCM se bhejta hai. */
export class ExpoPushProvider implements PushProvider {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async send(message: PushMessage) {
    const res = await this.fetchImpl('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ to: message.token, body: message.body, data: message.data, sound: 'default' }),
    });
    if (!res.ok) throw new Error(`Expo push ${res.status}`);
    const json = (await res.json()) as { data?: { status?: string; message?: string } };
    if (json.data?.status === 'error') throw new Error(json.data.message ?? 'Expo push error');
  }
}
