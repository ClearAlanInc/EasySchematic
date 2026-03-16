import { Hono } from "hono";
import { cors } from "hono/cors";
import { rowToTemplate } from "./db";

type Bindings = {
  easyschematic_db: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use(
  "*",
  cors({
    origin: [
      "https://easyschematic.live",
      "https://www.easyschematic.live",
      "http://localhost:5173",
    ],
    allowMethods: ["GET", "OPTIONS"],
  })
);

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=300, s-maxage=3600",
};

app.get("/templates", async (c) => {
  const { results } = await c.env.easyschematic_db.prepare(
    "SELECT * FROM templates ORDER BY sort_order, label"
  ).all();

  const templates = results.map((row) => rowToTemplate(row as never));
  return c.json(templates, 200, CACHE_HEADERS);
});

app.get("/templates/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.easyschematic_db.prepare(
    "SELECT * FROM templates WHERE id = ?"
  ).bind(id).first();

  if (!row) {
    return c.json({ error: "Template not found" }, 404);
  }

  return c.json(rowToTemplate(row as never), 200, CACHE_HEADERS);
});

app.get("/health", (c) => {
  return c.json({ ok: true });
});

export default app;
