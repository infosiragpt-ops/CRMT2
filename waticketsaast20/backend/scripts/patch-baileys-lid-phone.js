const fs = require("fs");
const path = require("path");

const target = path.resolve(
  __dirname,
  "../node_modules/@whiskeysockets/baileys/lib/Utils/chat-utils.js"
);

const before = `    else if (action === null || action === void 0 ? void 0 : action.contactAction) {
        ev.emit('contacts.upsert', [{ id, name: action.contactAction.fullName }]);
    }
    else if (action === null || action === void 0 ? void 0 : action.pushNameSetting) {`;

const after = `    else if (action === null || action === void 0 ? void 0 : action.contactAction) {
        ev.emit('contacts.upsert', [{ id, name: action.contactAction.fullName, lid: action.contactAction.lidJid }]);
    }
    else if (action === null || action === void 0 ? void 0 : action.pnForLidChatAction) {
        if (id && action.pnForLidChatAction.pnJid) {
            ev.emit('chats.phoneNumberShare', { lid: id, jid: action.pnForLidChatAction.pnJid });
        }
    }
    else if (action === null || action === void 0 ? void 0 : action.pushNameSetting) {`;

if (!fs.existsSync(target)) {
  console.warn("Baileys chat-utils.js not found; skipping LID phone patch.");
  process.exit(0);
}

const source = fs.readFileSync(target, "utf8");

if (source.includes(after)) {
  process.exit(0);
}

if (!source.includes(before)) {
  console.warn("Baileys LID phone patch target changed; skipping patch.");
  process.exit(0);
}

fs.writeFileSync(target, source.replace(before, after));
console.log("Applied Baileys LID phone patch.");
