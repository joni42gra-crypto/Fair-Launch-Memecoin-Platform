import { Router, type IRouter } from "express";
import healthRouter from "./health";
import supportedPairsRouter from "./supported-pairs";

const router: IRouter = Router();

router.use(healthRouter);
router.use(supportedPairsRouter);

export default router;
