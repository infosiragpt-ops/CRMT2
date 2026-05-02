import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Contacts", "phoneNumber", {
      type: DataTypes.STRING,
      allowNull: true
    });

    await queryInterface.addColumn("Contacts", "lid", {
      type: DataTypes.STRING,
      allowNull: true
    });

    await queryInterface.sequelize.query(`
      UPDATE "Contacts" c
      SET "lid" = c."number"
      WHERE EXISTS (
        SELECT 1
        FROM "Tickets" t
        INNER JOIN "Messages" m ON m."ticketId" = t."id"
        WHERE t."contactId" = c."id"
          AND m."remoteJid" LIKE '%@lid'
      )
    `);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Contacts", "lid");
    await queryInterface.removeColumn("Contacts", "phoneNumber");
  }
};
