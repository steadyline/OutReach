import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { config, validateRuntimeConfig } from "./config.js";
import { runMigrations } from "./migrations.js";
import { router } from "./routes.js";
import { startDeliveryWorker } from "./delivery.js";

const app = express();

app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
  })
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked origin: ${origin}`));
    },
    credentials: true
  })
);

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(morgan(config.isProduction ? "combined" : "dev"));

app.get("/", (_req, res) => {
  res.json({ name: "Reach API", ok: true });
});

app.use("/api", router);

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(error);
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Unexpected server error" });
  }
);

async function main() {
  validateRuntimeConfig();

  if (config.runMigrations) {
    await runMigrations();
  }

  app.listen(config.port, () => {
    console.log(`Reach API listening on ${config.port}`);
  });

  if (config.enableWorker) {
    startDeliveryWorker();
    console.log("Delivery worker enabled");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
