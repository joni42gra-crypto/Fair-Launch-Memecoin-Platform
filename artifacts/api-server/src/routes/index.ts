import { Router, type IRouter } from "express";
import healthRouter from "./health";
import supportedPairsRouter from "./supported-pairs";
import devnetQuoteRouter from "./devnet-quote";

const router: IRouter = Router();

router.use(healthRouter);
router.use(supportedPairsRouter);
router.use(devnetQuoteRouter);

export default router;
