import React, { useState, useEffect } from "react";

import { Avatar, CardHeader } from "@material-ui/core";
import { getInitials } from "../../helpers/getInitials";
import { generateColor } from "../../helpers/colorGenerator";
import { formatContactMainLabel } from "../../helpers/formatContactCode";
import { i18n } from "../../translate/i18n";

const TicketInfo = ({ contact, ticket, onClick }) => {
	const { user } = ticket
	const [userName, setUserName] = useState('')
	const contactLabel = formatContactMainLabel(contact);

	useEffect(() => {
		if (user && contact) {
			setUserName(`${i18n.t("messagesList.header.assignedTo")} ${user.name}`);

			if(document.body.offsetWidth < 600) {
				setUserName(`${user.name}`);
			}
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	return (
		<CardHeader
			onClick={onClick}
			style={{ cursor: "pointer" }}
			titleTypographyProps={{ noWrap: true }}
			subheaderTypographyProps={{ noWrap: true }}
			avatar={        <Avatar
          style={{ backgroundColor: generateColor(contact?.number), color: "white", fontWeight: "bold" }}
          src={contact.profilePicUrl}
          alt="contact_image">
          {getInitials(contact?.name)}
        </Avatar>}
			title={`${contactLabel} #${ticket.id}`}
			subheader={ticket.user && `${userName}`}
		/>
	);
};

export default TicketInfo;
