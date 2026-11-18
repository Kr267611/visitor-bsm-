import { SmsProvider } from './sms.provider';

/** MSG91 gateway. Must be verified on staging with a real account and DLT templates. */
export class Msg91SmsProvider implements SmsProvider {
  constructor(
    private readonly authKey: string,
    private readonly sender: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(to: string, text: string) {
    const res = await this.fetchImpl('https://api.msg91.com/api/v2/sendsms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authkey: this.authKey },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        sender: this.sender,
        route: '4',
        country: '91',
        sms: [{ message: text, to: [to.replace(/^\+/, '')] }],
      }),
    });
    if (!res.ok) throw new Error(`SMS gateway ${res.status}`);
    const json = (await res.json()) as { message?: string };
    return { id: json.message ?? 'msg91' };
  }
}
