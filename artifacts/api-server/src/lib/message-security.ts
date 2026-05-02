export const blockedPhoneNumberMessage =
  "Por seguridad no se puede enviar números de teléfono desde el CRM.";

export function containsBlockedPhoneNumber(value: string) {
  const candidates: string[] = value.match(/\b(?:\d[\s.-]?){9}\b/g) || [];
  return candidates.some((candidate) => candidate.replace(/\D/g, "").length === 9);
}
