export const normalizeContactNumber = (value?: string | null): string =>
  String(value || "").replace(/\D/g, "");

export const getJidNumber = (jid?: string | null): string =>
  normalizeContactNumber(String(jid || "").split("@")[0].split(":")[0]);

export const isPhoneJid = (jid?: string | null): boolean =>
  String(jid || "").includes("@s.whatsapp.net");

export const isLidJid = (jid?: string | null): boolean =>
  String(jid || "").includes("@lid");

export const getPhoneNumberFromJid = (jid?: string | null): string | undefined => {
  if (!isPhoneJid(jid)) return undefined;

  const number = getJidNumber(jid);
  return number || undefined;
};

export const getLidFromJid = (jid?: string | null): string | undefined => {
  if (!isLidJid(jid)) return undefined;

  const lid = getJidNumber(jid);
  return lid || undefined;
};

export const pickPhoneNumberFromJids = (
  ...jids: Array<string | null | undefined>
): string | undefined => {
  for (const jid of jids) {
    const phoneNumber = getPhoneNumberFromJid(jid);
    if (phoneNumber) return phoneNumber;
  }

  return undefined;
};

export const pickLidFromJids = (
  ...jids: Array<string | null | undefined>
): string | undefined => {
  for (const jid of jids) {
    const lid = getLidFromJid(jid);
    if (lid) return lid;
  }

  return undefined;
};
