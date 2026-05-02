import { isNil } from "lodash";
import { Op } from "sequelize";

import { normalizeContactNumber } from "../../helpers/ContactIdentity";
import { getIO } from "../../libs/socket";
import Contact from "../../models/Contact";
import ContactCustomField from "../../models/ContactCustomField";

interface ExtraInfo extends ContactCustomField {
  name: string;
  value: string;
}

interface Request {
  name: string;
  number: string;
  isGroup: boolean;
  email?: string;
  profilePicUrl?: string;
  phoneNumber?: string;
  lid?: string;
  companyId: number;
  extraInfo?: ExtraInfo[];
  whatsappId?: number;
}

const CreateOrUpdateContactService = async ({
  name,
  number: rawNumber,
  profilePicUrl,
  phoneNumber,
  lid,
  isGroup,
  email = "",
  companyId,
  extraInfo = [],
  whatsappId
}: Request): Promise<Contact> => {
  const number = isGroup ? rawNumber : normalizeContactNumber(rawNumber);
  const normalizedPhoneNumber = phoneNumber
    ? normalizeContactNumber(phoneNumber)
    : undefined;
  const normalizedLid = lid ? normalizeContactNumber(lid) : undefined;

  const io = getIO();
  const contactLookup: Array<Record<string, string>> = [{ number }];

  if (normalizedPhoneNumber) {
    contactLookup.push({ number: normalizedPhoneNumber });
    contactLookup.push({ phoneNumber: normalizedPhoneNumber });
  }

  if (normalizedLid) {
    contactLookup.push({ number: normalizedLid });
    contactLookup.push({ lid: normalizedLid });
  }

  const findContact = () =>
    Contact.findOne({
      where: {
        companyId,
        [Op.or]: contactLookup
      }
    });

  let contact = await findContact();

  try {
    if (contact) {
      const updateData: Partial<Contact> = {};

      if (!isNil(profilePicUrl)) updateData.profilePicUrl = profilePicUrl;
      if (!isNil(normalizedPhoneNumber)) {
        updateData.phoneNumber = normalizedPhoneNumber;
      }
      if (!isNil(normalizedLid)) updateData.lid = normalizedLid;

      await contact.update(updateData);

      if (isNil(contact.whatsappId) && !isNil(whatsappId)) {
        await contact.update({ whatsappId });
      }

      io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-contact`, {
        action: "update",
        contact
      });
    } else {
      contact = await Contact.create({
        name,
        number,
        phoneNumber: normalizedPhoneNumber,
        lid: normalizedLid,
        profilePicUrl,
        email,
        isGroup,
        extraInfo,
        companyId,
        whatsappId
      });

      io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-contact`, {
        action: "create",
        contact
      });
    }
  } catch (err) {
    if (err?.name !== "SequelizeUniqueConstraintError") {
      throw err;
    }

    contact = await findContact();
    if (!contact) throw err;

    const updateData: Partial<Contact> = {};
    if (!isNil(profilePicUrl)) updateData.profilePicUrl = profilePicUrl;
    if (!isNil(normalizedPhoneNumber)) {
      updateData.phoneNumber = normalizedPhoneNumber;
    }
    if (!isNil(normalizedLid)) updateData.lid = normalizedLid;

    await contact.update(updateData);

    io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-contact`, {
      action: "update",
      contact
    });
  }

  return contact;
};

export default CreateOrUpdateContactService;
