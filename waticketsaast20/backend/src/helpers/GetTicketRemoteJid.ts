import { Op } from "sequelize";

import Message from "../models/Message";
import Ticket from "../models/Ticket";

export const isUsableWhatsappJid = (remoteJid?: string | null): remoteJid is string => {
  if (!remoteJid || remoteJid === "status@broadcast") {
    return false;
  }

  return (
    remoteJid.endsWith("@lid") ||
    remoteJid.endsWith("@s.whatsapp.net") ||
    remoteJid.endsWith("@g.us")
  );
};

const GetTicketRemoteJid = async (
  ticket: Ticket,
  preferredRemoteJid?: string | null
): Promise<string> => {
  if (isUsableWhatsappJid(preferredRemoteJid)) {
    return preferredRemoteJid;
  }

  if (ticket.isGroup) {
    return `${ticket.contact.number}@g.us`;
  }

  const lastInboundMessage = await Message.findOne({
    where: {
      ticketId: ticket.id,
      fromMe: false,
      remoteJid: { [Op.not]: null }
    },
    order: [["createdAt", "DESC"]]
  });

  if (isUsableWhatsappJid(lastInboundMessage?.remoteJid)) {
    return lastInboundMessage.remoteJid;
  }

  return `${ticket.contact.number}@s.whatsapp.net`;
};

export default GetTicketRemoteJid;
