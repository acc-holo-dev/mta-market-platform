// PLAN-006 Workstreams B/C: public read endpoints for the Daily Experience
// layer. Read-only, guest-accessible (§29), rate-limited like other bulk
// surfaces. /activity/live — the LIVE line; /activity — the Home snapshot
// (items + popular blocks). The potential continuous /activity feed route
// (DAILY-EXPERIENCE §21) is intentionally NOT built in PLAN-006.
import { Router, Response } from "express";
import { standardRateLimit } from "../lib/rateLimit";
import { getActivitySnapshot, getLiveAggregates } from "../lib/activity";
import { reqLog } from "../middleware/requestId";

const router: Router = Router();

// GET /activity/live — global live signal (players/servers online).
router.get("/live", standardRateLimit, async (_req, res: Response) => {
  try {
    res.json(await getLiveAggregates());
  } catch (error) {
    reqLog(_req).error("activity_live_failed", { error });
    res.status(500).json({ error: "Failed to compute live aggregates" });
  }
});

// GET /activity — Home snapshot: live + high-value items + popular blocks.
router.get("/", standardRateLimit, async (req, res: Response) => {
  try {
    const limitRaw = parseInt((req.query.limit as string) || "20", 10) || 20;
    const limit = Math.min(Math.max(limitRaw, 5), 50);
    res.json(await getActivitySnapshot(limit));
  } catch (error) {
    reqLog(req).error("activity_snapshot_failed", { error });
    res.status(500).json({ error: "Failed to build activity snapshot" });
  }
});

export default router;
