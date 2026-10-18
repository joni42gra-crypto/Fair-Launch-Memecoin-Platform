import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tokensRouter from "./tokens";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tokensRouter);

export default router;
