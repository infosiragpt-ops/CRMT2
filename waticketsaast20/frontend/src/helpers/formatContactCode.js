const getDisplayNumber = contactOrNumber => {
  if (contactOrNumber && typeof contactOrNumber === "object") {
    const number = String(contactOrNumber.number || "").replace(/\D/g, "");
    const lid = String(contactOrNumber.lid || "").replace(/\D/g, "");

    if (contactOrNumber.phoneNumber) {
      return contactOrNumber.phoneNumber;
    }

    if (lid && number === lid) {
      return "";
    }

    return contactOrNumber.number;
  }

  return contactOrNumber;
};

export const getContactRealNumber = contactOrNumber => {
  if (contactOrNumber && typeof contactOrNumber === "object") {
    const number = String(contactOrNumber.number || "").replace(/\D/g, "");
    const lid = String(contactOrNumber.lid || "").replace(/\D/g, "");
    const phoneNumber = String(contactOrNumber.phoneNumber || "").replace(/\D/g, "");

    if (phoneNumber) {
      return phoneNumber;
    }

    if (lid && number === lid) {
      return "";
    }

    return number;
  }

  return String(contactOrNumber || "").replace(/\D/g, "");
};

export const formatContactCode = contactOrNumber => {
  const number = getDisplayNumber(contactOrNumber);
  const digits = String(number || "").replace(/\D/g, "");
  const code = digits.slice(-6);

  if (code.length !== 6) {
    return "";
  }

  return `${code.slice(0, 3)} ${code.slice(3)}`;
};

export const formatContactRealNumber = contactOrNumber => {
  const number = getContactRealNumber(contactOrNumber);

  return number ? `+${number}` : "";
};

export const formatContactMainLabel = contactOrNumber => {
  const realNumber = formatContactRealNumber(contactOrNumber);
  const code = formatContactCode(contactOrNumber);

  if (!realNumber) {
    return "Sin numero real";
  }

  return code ? `${realNumber} (${code})` : realNumber;
};

export default formatContactCode;
