import { SmsProvider } from './sms.provider';

/** Tests only. Sent messages are kept in `sent`. */
export class FakeSmsProvider implements SmsProvider {
  readonly sent: { to: string; text: string }[] = [];
  failing = false;

  async send(to: string, text: string) {
    if (this.failing) throw new Error('SMS gateway down');
    this.sent.push({ to, text });
    return { id: `fake-${this.sent.length}` };
  }
}
