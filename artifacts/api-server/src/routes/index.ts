import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import devicesRouter from "./devices";
import labelsRouter from "./labels";
import chatStateRouter from "./chat-state";
import chatNotesRouter from "./chat-notes";
import quickRepliesRouter from "./quick-replies";
import collaboratorsRouter from "./collaborators";
import agentSettingsRouter from "./agent-settings";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(devicesRouter);
router.use(labelsRouter);
router.use(chatStateRouter);
router.use(chatNotesRouter);
router.use(quickRepliesRouter);
router.use(collaboratorsRouter);
router.use(agentSettingsRouter);

export default router;
