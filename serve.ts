/**
 * Entry point started by `serve` in submission.yaml.
 *
 * The evaluator opens one WebSocket per task on 0.0.0.0:$PORT; everything else
 * lives in src/.
 */

import { startServer } from "./src/server";

startServer();
