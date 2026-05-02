import {
  WASocket,
  BinaryNode,
  Contact as BContact,
  proto,
} from "@whiskeysockets/baileys";
import { downloadHistory, getHistoryMsg } from "@whiskeysockets/baileys/lib/Utils/history";
import * as Sentry from "@sentry/node";

import { Op } from "sequelize";
// import { getIO } from "../../libs/socket";
import { getIO } from "../../libs/socket";
import { Store } from "../../libs/store";
import Baileys from "../../models/Baileys";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import {
  getJidNumber,
  getPhoneNumberFromJid,
  normalizeContactNumber
} from "../../helpers/ContactIdentity";
import Setting from "../../models/Setting";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import { logger } from "../../utils/logger";
import createOrUpdateBaileysService from "../BaileysServices/CreateOrUpdateBaileysService";
import CreateMessageService from "../MessageServices/CreateMessageService";

type Session = WASocket & {
  id?: number;
  store?: Store;
};

interface IContact {
  contacts: BContact[];
}

const APP_STATE_PATCH_NAMES = [
  "critical_block",
  "critical_unblock_low",
  "regular_high",
  "regular_low",
  "regular"
];

const wbotMonitor = async (
  wbot: Session,
  whatsapp: Whatsapp,
  companyId: number
): Promise<void> => {
  try {
    const io = getIO();
    const requestedPhoneHistoryJids = new Set<string>();

    const updateKnownPhoneNumber = async (lidJid?: string, phoneJid?: string) => {
      const lid = getJidNumber(lidJid);
      const phoneNumber = getPhoneNumberFromJid(phoneJid) || normalizeContactNumber(phoneJid);

      if (!lid || !phoneNumber || lid === phoneNumber) {
        return;
      }

      const contacts = await Contact.findAll({
        where: {
          companyId,
          [Op.or]: [{ number: lid }, { lid }]
        }
      });

      if (!contacts.length) return;

      await Promise.all(
        contacts.map(async contact => {
          await contact.update({ lid, phoneNumber });
          logger.info(`Resolved WhatsApp phone number ${phoneNumber} for LID ${lid}`);
          io.to(`company-${companyId}-mainchannel`).emit(`company-${companyId}-contact`, {
            action: "update",
            contact
          });
        })
      );
    };

    const resyncAppStateForPhoneNumbers = async () => {
      const missingPhoneNumbers = await Contact.count({
        where: {
          companyId,
          isGroup: false,
          [Op.or]: [{ phoneNumber: null }, { phoneNumber: "" }]
        }
      });

      if (!missingPhoneNumbers) return;

      const resetVersions = APP_STATE_PATCH_NAMES.reduce((acc, name) => {
        acc[name] = null;
        return acc;
      }, {} as Record<string, null>);

      await (wbot as any).authState.keys.set({
        "app-state-sync-version": resetVersions
      });

      logger.info(
        `Requesting WhatsApp app-state resync to resolve ${missingPhoneNumbers} real phone number(s)`
      );

      await wbot.resyncAppState(APP_STATE_PATCH_NAMES as any, true);
    };

    const updateKnownPhoneNumbersFromHistoryChats = async (
      chats: Array<proto.IConversation> = []
    ) => {
      await Promise.all(
        chats.map(chat => {
          const chatId = chat.id || undefined;
          const lidJid = chat.lidJid || (String(chatId || "").includes("@lid") ? chatId : undefined);
          const phoneJid = chat.pnJid || (String(chatId || "").includes("@s.whatsapp.net") ? chatId : undefined);

          return updateKnownPhoneNumber(lidJid, phoneJid);
        })
      );
    };

    const updateKnownPhoneNumbersFromHistory = async (
      history: proto.IHistorySync
    ) => {
      logger.info(
        `WhatsApp history sync received with ${(history.phoneNumberToLidMappings || []).length} phone/LID mapping(s) and ${(history.conversations || []).length} chat(s)`
      );

      const mappingUpdates = (history.phoneNumberToLidMappings || []).map(mapping =>
        updateKnownPhoneNumber(mapping.lidJid, mapping.pnJid)
      );

      await Promise.all(mappingUpdates);
      await updateKnownPhoneNumbersFromHistoryChats(history.conversations || []);
    };

    const syncPhoneNumbersFromHistoryMessage = async (
      message: proto.IWebMessageInfo
    ) => {
      const historyNotification = message.message ? getHistoryMsg(message.message) : undefined;
      if (!historyNotification) return;

      try {
        const history = await downloadHistory(historyNotification, {});
        await updateKnownPhoneNumbersFromHistory(history);
      } catch (err) {
        Sentry.captureException(err);
        logger.warn("Unable to sync phone numbers from WhatsApp history");
      }
    };

    const toMessageTimestampMs = (
      value: proto.IWebMessageInfo["messageTimestamp"] | Date | null | undefined
    ) => {
      if (value instanceof Date) return value.getTime();

      const timestamp = Number(value?.toString ? value.toString() : value);
      if (!Number.isFinite(timestamp) || timestamp <= 0) return Date.now();

      return timestamp > 9999999999 ? timestamp : timestamp * 1000;
    };

    const requestPhoneNumberHistorySync = async (
      key: proto.IMessageKey,
      timestamp: proto.IWebMessageInfo["messageTimestamp"] | Date | null | undefined
    ) => {
      const remoteJid = key.remoteJid || undefined;
      if (!remoteJid || !remoteJid.includes("@lid") || !key.id) return;

      if (requestedPhoneHistoryJids.has(remoteJid)) return;
      requestedPhoneHistoryJids.add(remoteJid);

      setTimeout(() => requestedPhoneHistoryJids.delete(remoteJid), 15 * 60 * 1000);

      try {
        await wbot.fetchMessageHistory(
          1,
          {
            remoteJid,
            id: key.id,
            fromMe: key.fromMe,
            participant: key.participant || undefined
          },
          toMessageTimestampMs(timestamp)
        );
        logger.info(`Requested WhatsApp history to resolve real phone number for ${remoteJid}`);
      } catch (err) {
        Sentry.captureException(err);
        logger.warn(`Unable to request WhatsApp history for ${remoteJid}`);
      }
    };

    const requestMissingPhoneNumbersFromStoredMessages = async () => {
      const messages = await Message.findAll({
        where: {
          companyId,
          remoteJid: { [Op.like]: "%@lid" }
        },
        include: [
          {
            model: Ticket,
            required: true,
            where: {
              companyId,
              whatsappId: whatsapp.id,
              isGroup: false
            },
            include: [
              {
                model: Contact,
                required: true,
                where: {
                  companyId,
                  [Op.or]: [{ phoneNumber: null }, { phoneNumber: "" }]
                }
              }
            ]
          }
        ],
        order: [["createdAt", "DESC"]],
        limit: 50
      });

      logger.info(`Found ${messages.length} stored @lid message(s) to request real phone numbers`);

      await Promise.all(
        messages.map(message =>
          requestPhoneNumberHistorySync(
            {
              remoteJid: message.remoteJid,
              id: message.id,
              fromMe: message.fromMe,
              participant: message.participant || undefined
            },
            message.createdAt
          )
        )
      );
    };

    const updateKnownPhoneNumberFromContact = async (contact: Partial<BContact>) => {
      await updateKnownPhoneNumber(contact.lid, contact.id);
    };

    const syncStoredBaileysContacts = async () => {
      const baileys = await Baileys.findOne({
        where: { whatsappId: whatsapp.id }
      });

      if (!baileys?.contacts) return;

      let contacts: Partial<BContact>[] = [];
      try {
        contacts = JSON.parse(baileys.contacts);
      } catch (err) {
        logger.warn("Unable to parse stored Baileys contacts");
      }

      if (!Array.isArray(contacts)) return;

      await Promise.all(
        contacts.map(contact => updateKnownPhoneNumberFromContact(contact))
      );
    };

    await syncStoredBaileysContacts();
    setTimeout(() => {
      (async () => {
        await requestMissingPhoneNumbersFromStoredMessages();
        await resyncAppStateForPhoneNumbers();
      })().catch(err => {
        Sentry.captureException(err);
        logger.warn("Unable to request stored WhatsApp history for phone numbers");
      });
    }, 3000);

    wbot.ws.on("CB:call", async (node: BinaryNode) => {
      const content = node.content[0] as any;

      if (content.tag === "offer") {
        const { from, id } = node.attrs;

      }

      if (content.tag === "terminate") {
        const sendMsgCall = await Setting.findOne({
          where: { key: "call", companyId },
        });

        if (sendMsgCall.value === "disabled") {
          await wbot.sendMessage(node.attrs.from, {
            text:
              "*Mensagem Automática:*\n\nAs chamadas de voz e vídeo estão desabilitas para esse WhatsApp, favor enviar uma mensagem de texto. Obrigado",
          });

          const number = node.attrs.from.replace(/\D/g, "");

          const contact = await Contact.findOne({
            where: { companyId, number },
          });

          const ticket = await Ticket.findOne({
            where: {
              contactId: contact.id,
              whatsappId: wbot.id,
              //status: { [Op.or]: ["close"] },
              companyId
            },
          });
          // se não existir o ticket não faz nada.
          if (!ticket) return;

          const date = new Date();
          const hours = date.getHours();
          const minutes = date.getMinutes();

          const body = `Chamada de voz/vídeo perdida às ${hours}:${minutes}`;
          const messageData = {
            id: content.attrs["call-id"],
            ticketId: ticket.id,
            contactId: contact.id,
            body,
            fromMe: false,
            mediaType: "call_log",
            read: true,
            quotedMsgId: null,
            ack: 1,
          };

          await ticket.update({
            lastMessage: body,
          });


          if(ticket.status === "closed") {
            await ticket.update({
              status: "pending",
            });
          }

          return CreateMessageService({ messageData, companyId: companyId });
        }
      }
    });

    wbot.ev.on("contacts.upsert", async (contacts: BContact[]) => {

      await createOrUpdateBaileysService({
        whatsappId: whatsapp.id,
        contacts,
      });

      await Promise.all(
        contacts.map(contact => updateKnownPhoneNumberFromContact(contact))
      );
    });

    wbot.ev.on("contacts.update", async (contacts: Partial<BContact>[]) => {
      await Promise.all(
        contacts.map(contact => updateKnownPhoneNumberFromContact(contact))
      );
    });

    wbot.ev.on("chats.phoneNumberShare", async ({ lid, jid }) => {
      await updateKnownPhoneNumber(lid, jid);
    });

    wbot.ev.on("messages.upsert", async ({ messages }) => {
      await Promise.all(
        messages.map(async message => {
          await syncPhoneNumbersFromHistoryMessage(message);
          await requestPhoneNumberHistorySync(message.key, message.messageTimestamp);
        })
      );
    });

    wbot.ev.on("messaging-history.set", async ({ contacts, chats }) => {
      if (contacts?.length) {
        await createOrUpdateBaileysService({
          whatsappId: whatsapp.id,
          contacts,
        });

        await Promise.all(
          contacts.map(contact => updateKnownPhoneNumberFromContact(contact))
        );
      }

      await updateKnownPhoneNumbersFromHistoryChats(chats || []);
    });

  } catch (err) {
    Sentry.captureException(err);
    logger.error(err);
  }
};

export default wbotMonitor;
