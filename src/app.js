// ===========================================
// Express Application Setup
// Configures middleware and mounts API routes
// ===========================================

import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import chatRoutes from "./routes/chat.routes.js";
import courseRoutes from "./routes/course.routes.js";
import lectureRoutes from "./routes/lecture.routes.js";
import voiceRoutes from "./routes/voice.routes.js";
import enrichmentRoutes from "./routes/enrichment.routes.js";
import projectRoutes from "./routes/project.routes.js";
import routineRoutes from "./routes/routine.routes.js";
import authRoutes from "./routes/auth.routes.js";
import { notFoundHandler, errorHandler } from "./errors/index.js";

const app = express();

// Trust the first proxy hop so req.ip / secure cookies work behind a
// reverse proxy (needed for correct rate-limit keys + Secure cookies).
app.set("trust proxy", 1);

// --- Middleware ---

app.use(helmet());

// CORS. In dev the SPA talks to the API same-origin via the Vite proxy,
// so the default open config is fine. In production with a separate
// frontend sub-domain we must echo that exact origin AND allow
// credentials so the httpOnly refresh cookie works cross-origin.
// FRONTEND_ORIGIN = comma-separated allowed origins (e.g.
//   https://app.saidrix.com).
const allowedOrigins = (process.env.FRONTEND_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors(
    allowedOrigins.length
      ? {
          origin(origin, cb) {
            // Same-origin / curl (no Origin header) is always allowed.
            if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
            return cb(new Error(`Origin not allowed by CORS: ${origin}`));
          },
          credentials: true,
        }
      : undefined
  )
);

app.use(express.json());
app.use(cookieParser());

// --- Health Check ---

app.get("/", (req, res) => {
  res.json({ message: "Server is running" });
});

// --- API Routes ---

app.use("/api/auth", authRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api", courseRoutes);
app.use("/api/lectures", lectureRoutes);
app.use("/api/voice", voiceRoutes);
app.use("/api/enrichment", enrichmentRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/routines", routineRoutes);

// --- 404 + central error handler (must be last) ---

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
