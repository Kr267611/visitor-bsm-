/** Saare notification messages. SMS wale DLT par isi text se register honge. */
export const TEMPLATES = {
  INVITE_LINK: {
    channel: 'SMS',
    text: '{hostName} ne aapko {siteName} bulaya hai. Apni details bharein: {link}',
  },
  PASS_READY: { channel: 'SMS', text: 'Aapka visitor pass taiyaar hai: {link}' },
  VISITOR_ARRIVED: { channel: 'PUSH', text: '{visitorName} {gateName} par aa gaye hain.' },
  APPROVAL_REQUEST: {
    channel: 'PUSH',
    text: '{visitorName} ({company}) aapse milne gate par hain. Approve ya reject karein.',
  },
  APPROVAL_REMINDER: { channel: 'PUSH', text: '{visitorName} abhi bhi gate par intezaar kar rahe hain.' },
} as const;

export type TemplateKey = keyof typeof TEMPLATES;

export interface OutboxDraft {
  channel: 'PUSH' | 'SMS';
  template: TemplateKey;
  /** PUSH: user id. SMS: phone number. */
  recipient: string;
  vars: Record<string, string>;
  visitId?: string;
}

const PLACEHOLDER = /\{(\w+)\}/g;

/** Template bharta hai. Koi variable kam ho to throw, taaki adhoora message na jaye. */
export function renderTemplate(template: TemplateKey, vars: Record<string, string>): string {
  return TEMPLATES[template].text.replace(PLACEHOLDER, (_, name: string) => {
    const value = vars[name];
    if (value === undefined) throw new Error(`Template ${template} mein ${name} missing hai`);
    return value;
  });
}
