export interface SmsContact {
  sms_phone_e164: string | null;
  sms_consent_status: string;
  sms_suppression_status: string;
}

export type ContactFailureCategory =
  | "missing_contact"
  | "invalid_contact"
  | "contact_unconsented"
  | "contact_suppressed";

export function contactEligibilityFailure(
  contact: SmsContact,
): ContactFailureCategory | null {
  if (contact.sms_phone_e164 === null) return "missing_contact";
  if (!/^\+[1-9]\d{1,14}$/.test(contact.sms_phone_e164)) {
    return "invalid_contact";
  }
  if (contact.sms_consent_status !== "consented") {
    return "contact_unconsented";
  }
  if (contact.sms_suppression_status !== "not_suppressed") {
    return "contact_suppressed";
  }
  return null;
}
