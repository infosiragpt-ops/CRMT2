import AppError from "../../errors/AppError";
import Contact from "../../models/Contact";
import ContactCustomField from "../../models/ContactCustomField";

interface ExtraInfo {
  id?: number;
  name: string;
  value: string;
}
interface ContactData {
  email?: string;
  number?: string;
  phoneNumber?: string;
  lid?: string;
  name?: string;
  active?: boolean;  
  extraInfo?: ExtraInfo[];
}

interface Request {
  contactData: ContactData;
  contactId: string;
  companyId: number;
}

const UpdateContactService = async ({
  contactData,
  contactId,
  companyId
}: Request): Promise<Contact> => {
  const { email, name, number, phoneNumber, lid, extraInfo, active } = contactData;

  const contact = await Contact.findOne({
    where: { id: contactId },
    attributes: ["id", "name", "number", "phoneNumber", "lid", "email", "companyId", "profilePicUrl", "active"],
    include: ["extraInfo"]
  });

  if (contact?.companyId !== companyId) {
    throw new AppError("Não é possível alterar registros de outra empresa");
  }

  if (!contact) {
    throw new AppError("ERR_NO_CONTACT_FOUND", 404);
  }

  if (extraInfo) {
    await Promise.all(
      extraInfo.map(async (info: any) => {
        await ContactCustomField.upsert({ ...info, contactId: contact.id });
      })
    );

    await Promise.all(
      contact.extraInfo.map(async oldInfo => {
        const stillExists = extraInfo.findIndex(info => info.id === oldInfo.id);

        if (stillExists === -1) {
          await ContactCustomField.destroy({ where: { id: oldInfo.id } });
        }
      })
    );
  }

  const updateData: Record<string, unknown> = {};

  if (name !== undefined) updateData.name = name;
  if (number !== undefined) updateData.number = number;
  if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;
  if (lid !== undefined) updateData.lid = lid;
  if (email !== undefined) updateData.email = email;
  if (active !== undefined) updateData.active = active;

  await contact.update(updateData);

  await contact.reload({
    attributes: ["id", "name", "number", "phoneNumber", "lid", "email", "profilePicUrl","active"],
    include: ["extraInfo"]
  });

  return contact;
};

export default UpdateContactService;
