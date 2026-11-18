/** All notification texts. SMS templates must be registered on DLT with exactly this text. */
export const TEMPLATES = {
  INVITE_LINK: {
    channel: 'SMS',
    text: '{hostName} has invited you to {siteName}. Please add your details: {link}',
  },
  PASS_READY: { channel: 'SMS', text: 'Your visitor pass is ready: {link}' },
  SELF_CHECKIN_LINK: {
    channel: 'SMS',
    text: 'Your request to visit {siteName} has been sent to {hostName}. Track it and get your pass here: {link}',
  },
  VISITOR_ARRIVED: { channel: 'PUSH', text: '{visitorName} has arrived at {gateName}.' },
  APPROVAL_REQUEST: {
    channel: 'PUSH',
    text: '{visitorName} ({company}) is at the gate to meet you. Please approve or reject.',
  },
  APPROVAL_REMINDER: { channel: 'PUSH', text: '{visitorName} is still waiting at the gate.' },
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

/** Fills a template. Throws when a variable is missing, so no half-filled message goes out. */
export function renderTemplate(template: TemplateKey, vars: Record<string, string>): string {
  return TEMPLATES[template].text.replace(PLACEHOLDER, (_, name: string) => {
    const value = vars[name];
    if (value === undefined) throw new Error(`Template ${template} is missing ${name}`);
    return value;
  });
}
