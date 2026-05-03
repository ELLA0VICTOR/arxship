import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import arciumRoutes from "./src/routes/arcium.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 4100);

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "arxship-api",
    version: "0.1.0",
  });
});

app.use("/api/arcium", arciumRoutes);

app.listen(PORT, () => {
  console.log(`ArxShip API listening on http://localhost:${PORT}`);
});
