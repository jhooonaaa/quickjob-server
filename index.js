import express from "express";
import cors from "cors";
import multer from "multer";
import db from "./db.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import path from "path"
import { fileURLToPath } from "url"
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ---------------- Multer setup for file uploads ----------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // folder where files go
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage });

// ---------------- Nodemailer setup ----------------
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,       // from .env
    pass: process.env.EMAIL_PASSWORD,   // Gmail app password
  },
});

// helper to send email
async function sendVerificationEmail(email, code) {
  await transporter.sendMail({
    from: `"QuickJob" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Verify your QuickJob account",
    text: `Your verification code is: ${code}`,
  });
}

// ---------------- Signup Client ----------------
app.post("/signup-client", upload.single("idPhoto"), async (req, res) => {
  try {
    const { name, email, password, contact } = req.body;
    const idPhoto = req.file ? req.file.path : null;

    const code = Math.floor(100000 + Math.random() * 900000).toString();

    await db.query(
      `INSERT INTO users (name, email, password, contact, id_photo, role, verification_code, is_verified)
       VALUES ($1,$2,$3,$4,$5,'client',$6,false)`,
      [name, email, password, contact, idPhoto, code]
    );

   

    res.json({ success: true, message: "Client registered. Please log in to verify your account." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Signup failed" });
  }
});


// ---------------- Signup Professional ----------------
app.post(
  "/signup-professional",
  upload.fields([{ name: "idPhoto" }, { name: "selfie" }]),
  async (req, res) => {
    try {
      const { name, email, password, profession } = req.body; // 👈 ADD THIS LINE

      const idPhoto = req.files["idPhoto"]
        ? `/uploads/${req.files["idPhoto"][0].filename}`
        : null;

      const selfie = req.files["selfie"]
        ? `/uploads/${req.files["selfie"][0].filename}`
        : null;

      const code = Math.floor(100000 + Math.random() * 900000).toString();

      await db.query(
        `INSERT INTO users (name, email, password, profession, id_photo, selfie, role, verification_code, is_verified)
         VALUES ($1,$2,$3,$4,$5,$6,'professional',$7,false)`,
        [name, email, password, profession, idPhoto, selfie, code]
      );

      res.json({
        success: true,
        message:
          "Professional registered. Please log in to verify your account.",
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "Signup failed" });
    }
  }
);


// ---------------- Verify ----------------
app.post("/verify", async (req, res) => {
  try {
    const { email, code } = req.body;

    const result = await db.query(
      "SELECT id, role, verification_code, name FROM users WHERE email=$1",
      [email]
    );

    if (result.rows.length === 0) {
      return res.json({ success: false, message: "Email not found" });
    }

    const user = result.rows[0];

    if (user.verification_code === code) {
      await db.query("UPDATE users SET is_verified=true WHERE email=$1", [email]);
      return res.json({
        success: true,
        id: user.id,
        name: user.name,
        email,
        role: user.role
      });
    } else {
      return res.json({ success: false, message: "Invalid code" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Verification failed" });
  }
});


// ---------------- Login ----------------
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await db.query(
      "SELECT id, role, is_verified, name FROM users WHERE email=$1 AND password=$2",
      [email, password]
    );

    if (result.rows.length === 0) {
      return res.json({ success: false, message: "Invalid credentials" });
    }

    const user = result.rows[0];

    if (!user.is_verified) {
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      await db.query(
        "UPDATE users SET verification_code=$1 WHERE email=$2",
        [code, email]
      );

      await sendVerificationEmail(email, code);

      return res.json({
        success: false,
        needsVerification: true,
        message: "A verification code was sent to your email.",
      });
    }

    // ✅ return full user info
    res.json({
      success: true,
       id: user.id,   
      role: user.role,
      email,
      name: user.name, 
      
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Login failed" });
  }
});

// Fetch profile
app.get("/profiles/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    // Fetch profile
    const profileResult = await db.query(
      `SELECT user_id, bio, address, home, contact, social_links, 
              profile_picture, cover_photo 
       FROM profiles WHERE user_id = $1`,
      [userId]
    );

    let profile;
    if (profileResult.rows.length === 0) {
      profile = {
        user_id: userId,
        bio: "",
        address: "",
        home: "",
        contact: "",
        social_links: [],
        profile_picture: null,
        cover_photo: null,
      };
    } else {
      profile = profileResult.rows[0];
    }

    // ✅ Fetch services of this user
    const servicesResult = await db.query(
      `SELECT id, name, description, rate, created_at 
       FROM services 
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    // ✅ Add services to profile
    profile.services = servicesResult.rows;

    // ✅ Auto-prefix file paths with full URL
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    if (profile.profile_picture) {
      profile.profile_picture = `${baseUrl}${profile.profile_picture}`;
    }
    if (profile.cover_photo) {
      profile.cover_photo = `${baseUrl}${profile.cover_photo}`;
    }

    res.json(profile);
  } catch (err) {
    console.error("Fetch profile error:", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});
// ✅ Update or insert bio
app.put("/profiles/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { bio } = req.body;

    // check if profile exists
    const existing = await db.query(
      "SELECT id FROM profiles WHERE user_id = $1",
      [userId]
    );

    if (existing.rows.length === 0) {
      // if no profile yet, create one
      await db.query(
        "INSERT INTO profiles (user_id, bio) VALUES ($1, $2)",
        [userId, bio]
      );
    } else {
      // update existing
      await db.query(
        "UPDATE profiles SET bio = $1 WHERE user_id = $2",
        [bio, userId]
      );
    }

    res.json({ success: true, message: "Bio updated successfully" });
  } catch (err) {
    console.error("Update bio error:", err);
    res.status(500).json({ success: false, message: "Failed to update bio" });
  }
});

app.post("/profile/update", async (req, res) => {
  try {
    const { userId, bio, address, home, contact, socialLinks } = req.body;

    await db.query(
      `INSERT INTO profiles (user_id, bio, address, home, contact, social_links)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE 
       SET bio = $2, address = $3, home = $4, contact = $5, social_links = $6`,
      [userId, bio, address, home, contact, JSON.stringify(socialLinks)]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Update profile error:", err);
    res.status(500).json({ success: false });
  }
});

app.post("/upload/:type", upload.single("file"), async (req, res) => {
  try {
    const { userId } = req.body;
    const { type } = req.params;

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const filePath = `/uploads/${req.file.filename}`;

    // Validate type
    if (!["profilePicture", "coverPhoto"].includes(type)) {
      return res.status(400).json({ error: "Invalid upload type" });
    }

    // Map type → column
    const column = type === "profilePicture" ? "profile_picture" : "cover_photo";

    // ✅ Insert or update profile row
    await db.query(
      `
      INSERT INTO profiles (user_id, ${column})
      VALUES ($2, $1)
      ON CONFLICT (user_id)
      DO UPDATE SET ${column} = EXCLUDED.${column}
      `,
      [filePath, userId]
    );

    res.json({ success: true, filePath });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});

// ✅ Fetch all services (already correct)
app.get("/services/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await db.query(
      "SELECT id, name, description, rate FROM services WHERE user_id = $1 ORDER BY created_at DESC",
      [userId]
    );
    res.json({ success: true, services: result.rows });
  } catch (err) {
    console.error("Fetch services error:", err);
    res.status(500).json({ success: false });
  }
});

// ✅ Add service (already correct)
app.post("/services/add", async (req, res) => {
  try {
    const { userId, name, description, rate } = req.body;

    await db.query(
      `INSERT INTO services (user_id, name, description, rate)
       VALUES ($1, $2, $3, $4)`,
      [userId, name, description, rate]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Add service error:", err);
    res.status(500).json({ success: false, error: "Failed to add service" });
  }
});

// ✅ Update service
app.put("/services/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, rate } = req.body;

    await db.query(
      `UPDATE services
       SET name = $1, description = $2, rate = $3
       WHERE id = $4`,
      [name, description, rate, id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Update service error:", err);
    res.status(500).json({ success: false, error: "Failed to update service" });
  }
});

// ✅ Delete service
app.delete("/services/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await db.query("DELETE FROM services WHERE id = $1", [id]);

    res.json({ success: true });
  } catch (err) {
    console.error("Delete service error:", err);
    res.status(500).json({ success: false, error: "Failed to delete service" });
  }
});

// Upload credential
app.post("/credentials/upload", upload.single("file"), async (req, res) => {
  try {
    const { userId, name } = req.body;
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const filePath = `/uploads/${req.file.filename}`;

    const result = await db.query(
      `INSERT INTO credentials (user_id, file_path, status, name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, file_path, status, uploaded_at, name`,
      [userId, filePath, "pending", name || null]
    );

    res.json({ success: true, credential: result.rows[0] });
  } catch (err) {
    console.error("Credential upload error:", err);
    res.status(500).json({ error: "Upload failed" });
  }
});

// Fetch credentials
app.get("/credentials/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await db.query(
      `SELECT id, file_path, status, uploaded_at, name
       FROM credentials 
       WHERE user_id = $1 
       ORDER BY uploaded_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch credentials error:", err);
    res.status(500).json({ error: "Failed to fetch credentials" });
  }
});

app.delete("/credentials/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // Get credential info
    const result = await db.query("SELECT user_id FROM credentials WHERE id=$1", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Credential not found" });
    }
    const userId = result.rows[0].user_id;

    // Delete the credential
    await db.query("DELETE FROM credentials WHERE id=$1", [id]);

    // Count remaining approved credentials
    const remaining = await db.query(
      "SELECT COUNT(*) AS count FROM credentials WHERE user_id=$1 AND status='success'",
      [userId]
    );
    const remainingApproved = parseInt(remaining.rows[0].count);

    // Update verification table
    if (remainingApproved > 0) {
      await db.query(
        "UPDATE verification SET credentials_status='success' WHERE user_id=$1",
        [userId]
      );
    } else {
      await db.query(
        "UPDATE verification SET credentials_status='pending' WHERE user_id=$1"
      , [userId]);
    }

    // Optionally update overall status
    const v = await db.query("SELECT * FROM verification WHERE user_id=$1", [userId]);
    const verification = v.rows[0];
    const overall =
      verification.email_status === "success" &&
      verification.id_photo_status === "success" &&
      verification.selfie_status === "success" &&
      remainingApproved > 0
        ? "success"
        : "pending";

    await db.query("UPDATE verification SET overall_status=$1 WHERE user_id=$2", [
      overall,
      userId,
    ]);

    res.json({ success: true, message: "Credential deleted" });
  } catch (err) {
    console.error("Delete credential error:", err);
    res.status(500).json({ success: false, message: "Failed to delete credential" });
  }
});


app.post("/verification/init", async (req, res) => {
  try {
    const { userId } = req.body;

    const exists = await db.query("SELECT * FROM verification WHERE user_id=$1", [userId]);
    if (exists.rows.length > 0) {
      return res.json({ success: true, message: "Already exists" });
    }

    await db.query(
      `INSERT INTO verification (user_id, email_status, id_photo_status, selfie_status, credentials_status, overall_status) 
       VALUES ($1, 'success', 'pending', 'pending', 'pending', 'pending')`,
      [userId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Init verification error:", err);
    res.status(500).json({ error: "Failed to initialize verification" });
  }
});
//admin approve
app.post("/verification/review", async (req, res) => {
  const { userId, step, status, credentialId } = req.body;

  try {
    // 1️⃣ Update verification
    if (step === "credentials" && credentialId) {
      // Update only one credential
      await db.query(
        "UPDATE credentials SET status=$1 WHERE id=$2 AND user_id=$3",
        [status, credentialId, userId]
      );

      // Compute credentials_status for verification
      const creds = await db.query(
        "SELECT id, name, status FROM credentials WHERE user_id=$1",
        [userId]
      );

      let credStatus = "pending";
      const approvedCount = creds.rows.filter((c) => c.status === "success").length;
      const rejectedCount = creds.rows.filter((c) => c.status === "failed").length;

      if (approvedCount === creds.rows.length && creds.rows.length > 0) {
        credStatus = "success";
      } else if (rejectedCount > 0) {
        credStatus = "failed";
      }

      await db.query(
        "UPDATE verification SET credentials_status=$1 WHERE user_id=$2",
        [credStatus, userId]
      );
    } else {
      // Update verification table step (id_photo/selfie)
      await db.query(
        `UPDATE verification SET ${step}_status = $1 WHERE user_id = $2`,
        [status, userId]
      );
    }

    // 2️⃣ Recalculate overall
    const result = await db.query("SELECT * FROM verification WHERE user_id=$1", [userId]);
    const v = result.rows[0];

    let overall = "pending";
    if (
      v.id_photo_status === "success" &&
      v.selfie_status === "success" &&
      v.credentials_status === "success"
    ) {
      overall = "success";
      await db.query("UPDATE users SET is_verified=true WHERE id=$1", [userId]);
    } else if (
      v.id_photo_status === "failed" ||
      v.selfie_status === "failed" ||
      v.credentials_status === "failed"
    ) {
      overall = "failed";
    }

    await db.query("UPDATE verification SET overall_status=$1 WHERE user_id=$2", [
      overall,
      userId,
    ]);

    // 3️⃣ Send notification
    let message = "";
    if (overall === "success") {
      message = "🎉 Your account has been successfully verified!";
    } else if (overall === "failed") {
      // Check what failed
      const rejectedCreds = await db.query(
        "SELECT name FROM credentials WHERE user_id=$1 AND status='failed'",
        [userId]
      );

      const failedCredNames = rejectedCreds.rows.map((c) => c.name);
      const failedMessages = [];

      if (v.id_photo_status === "failed") failedMessages.push("ID photo rejected");
      if (v.selfie_status === "failed") failedMessages.push("Selfie rejected");
      failedCredNames.forEach((name) => failedMessages.push(`Certificate rejected: ${name}`));

      message = "⚠️ Verification failed: " + failedMessages.join(", ");
    }

    if (overall !== "pending") {
      await db.query(
        "INSERT INTO notifications (user_id, message, target_tab) VALUES ($1, $2, $3)",
        [userId, message, "verification"]
      );
    }

    // 4️⃣ Always return updated verification + credentials
    const updatedVerification = await db.query(
      "SELECT * FROM verification WHERE user_id=$1",
      [userId]
    );
    const updatedCreds = await db.query(
      "SELECT id, name, status, file_path FROM credentials WHERE user_id=$1",
      [userId]
    );

    res.json({
      success: true,
      verification: updatedVerification.rows[0],
      credentials: updatedCreds.rows,
    });
  } catch (err) {
    console.error("Verification review error:", err);
    res.status(500).json({ error: "Failed to update verification" });
  }
});

app.get("/verification/credentials/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await db.query(
      "SELECT id, file_path, status FROM credentials WHERE user_id=$1",
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch credentials error:", err);
    res.status(500).json({ error: "Failed to fetch credentials" });
  }
});

app.get("/verification/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await db.query("SELECT * FROM verification WHERE user_id=$1", [userId]);

    if (result.rows.length === 0) {
      return res.json({
        email: "success",
        idPhoto: "pending",
        selfie: "pending",
        credentials: "pending",
        overall: "pending",
      });
    }

    const v = result.rows[0];

    res.json({
      email: v.email_status,
      idPhoto: v.id_photo_status,
      selfie: v.selfie_status,
      credentials: v.credentials_status,
      overall: v.overall_status,
    });
  } catch (err) {
    console.error("Fetch verification error:", err);
    res.status(500).json({ error: "Failed to fetch verification" });
  }
});

app.delete("/notifications/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await db.query("DELETE FROM notifications WHERE id=$1", [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Delete notification error:", err);
    res.status(500).json({ error: "Failed to delete notification" });
  }
});


app.get("/notifications/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await db.query(
      `SELECT id,
              message,
              target_tab AS "targetTab",
              is_read AS "read",
              created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch notifications error:", err);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});


app.post("/notifications/read-all", async (req, res) => {
  try {
    const { userId } = req.body;
    await db.query("UPDATE notifications SET is_read = TRUE WHERE user_id = $1", [userId]);
    res.json({ success: true });
  } catch (err) {
    console.error("Mark all as read error:", err);
    res.status(500).json({ error: "Failed to mark all as read" });
  }
});
app.post("/notifications/read", async (req, res) => {
  try {
    const { id } = req.body; // notification id
    await db.query("UPDATE notifications SET is_read = TRUE WHERE id = $1", [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Mark notification as read error:", err);
    res.status(500).json({ error: "Failed to mark notification as read" });
  }
});


app.post("/notifications/add", async (req, res) => {
  try {
    const { userId, message, targetTab } = req.body;
    const result = await db.query(
      "INSERT INTO notifications (user_id, message, target_tab) VALUES ($1, $2, $3) RETURNING *",
      [userId, message, targetTab]
    );
    res.json({ success: true, notification: result.rows[0] });
  } catch (err) {
    console.error("Add notification error:", err);
    res.status(500).json({ error: "Failed to add notification" });
  }
});

// NOT TOTALLY WORK

// 1️⃣ Fetch all client requests for a professional
app.get("/requests/:professionalId", async (req, res) => {
  try {
    const { professionalId } = req.params;

    const result = await db.query(
      `
      SELECT r.id, r.service, r.date, r.time, r.urgency, r.message, 
             r.status, r.created_at,
             u.name AS client
      FROM requests r
      JOIN users u ON r.client_id = u.id
      WHERE r.professional_id = $1
      ORDER BY r.created_at DESC
      `,
      [professionalId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Fetch requests error:", err);
    res.status(500).json({ error: "Failed to fetch client requests" });
  }
});

// 2️⃣ Update request status
app.post("/requests/update", async (req, res) => {
  try {
    const { requestId, status } = req.body;

    // only allow valid statuses
    if (!["pending", "confirmed", "declined", "completed"].includes(status)) {
      return res.status(400).json({ success: false, error: "Invalid status" });
    }

    await db.query(
      `UPDATE requests SET status = $1 WHERE id = $2`,
      [status, requestId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Update request error:", err);
    res.status(500).json({ success: false, error: "Failed to update request" });
  }
});


// Fetch ratings for a professional
app.get("/ratings/:professionalId", async (req, res) => {
  const { professionalId } = req.params;
  try {
    const result = await db.query(
      `SELECT r.id, r.stars, r.comment, r.created_at, u.name AS client_name
       FROM ratings r
       JOIN users u ON r.client_id = u.id
       WHERE r.professional_id = $1
       ORDER BY r.created_at DESC`,
      [professionalId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch ratings" });
  }
});

// Add new rating (client -> professional)
app.post("/ratings/add", async (req, res) => {
  const { professionalId, clientId, stars, comment } = req.body;
  try {
    await db.query(
      `INSERT INTO ratings (professional_id, client_id, stars, comment)
       VALUES ($1, $2, $3, $4)`,
      [professionalId, clientId, stars, comment]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add rating" });
  }
});



 
app.get("/messages/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      "SELECT * FROM messages WHERE sender_id=$1 OR receiver_id=$1 ORDER BY created_at ASC",
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

app.post("/messages/send", async (req, res) => {
  try {
    const { from, to, message } = req.body;
    await db.query(
      "INSERT INTO messages (sender_id, receiver_id, message) VALUES ($1,$2,$3)",
      [from, to, message]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});


app.get("/earnings/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query("SELECT * FROM earnings WHERE user_id=$1", [id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch earnings" });
  }
});
app.get("/analytics/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query("SELECT * FROM analytics WHERE user_id=$1", [id]);
    res.json(result.rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});
app.get("/schedule/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query("SELECT * FROM schedules WHERE user_id=$1", [id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch schedule" });
  }
});

app.post("/schedule/update", async (req, res) => {
  try {
    const { userId, availability } = req.body;
    await db.query("DELETE FROM schedules WHERE user_id=$1", [userId]);
    for (const [day, slots] of Object.entries(availability)) {
      await db.query(
        "INSERT INTO schedules (user_id, day, slots) VALUES ($1,$2,$3)",
        [userId, day, slots]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.get("/appointments/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query("SELECT * FROM appointments WHERE professional_id=$1", [id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch appointments" });
  }
});

app.post("/appointments/add", async (req, res) => {
  try {
    const { userId, clientId, date, time } = req.body;
    await db.query(
      "INSERT INTO appointments (professional_id, client_id, date, time) VALUES ($1,$2,$3,$4)",
      [userId, clientId, date, time]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.get("/bank/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await db.query(
      "SELECT * FROM bank_accounts WHERE user_id = $1 LIMIT 1",
      [userId]
    );

    if (result.rows.length === 0) return res.json(null);
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error fetching bank info:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Save or update professional’s bank info
app.post("/bank/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { payoutMethod, bankName, accountNumber, accountName } = req.body;

    const existing = await db.query(
      "SELECT id FROM bank_accounts WHERE user_id = $1",
      [userId]
    );

    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE bank_accounts 
         SET payout_method=$1, bank_name=$2, account_number=$3, account_name=$4, updated_at=NOW()
         WHERE user_id=$5`,
        [payoutMethod, bankName, accountNumber, accountName, userId]
      );
    } else {
      await db.query(
        `INSERT INTO bank_accounts (user_id, payout_method, bank_name, account_number, account_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, payoutMethod, bankName, accountNumber, accountName]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Error saving bank info:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/payments/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await db.query(
      `SELECT * FROM transactions 
       WHERE professional_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching transactions:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create a new transaction (client → admin)
app.post("/payments/create", async (req, res) => {
  try {
    const { clientId, professionalId, amount } = req.body;
    const commission = amount * 0.05;
    const netAmount = amount - commission;

    const result = await db.query(
      `INSERT INTO transactions (client_id, professional_id, amount, commission, net_amount)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [clientId, professionalId, amount, commission, netAmount]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error creating transaction:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Admin releases payment to professional
app.post("/payments/release/:transactionId", async (req, res) => {
  try {
    const { transactionId } = req.params;

    await db.query(
      `UPDATE transactions 
       SET status='released', released_at=NOW()
       WHERE id=$1`,
      [transactionId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Error releasing payment:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

//ADMIN BACKEND

// Admin login route
app.post("/auth/admin-login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await db.query("SELECT * FROM users WHERE email = $1", [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const user = result.rows[0];

    if (user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Not an admin account" });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    // Optional: create JWT token
    const token = jwt.sign({ id: user.id, role: user.role }, "your_jwt_secret", { expiresIn: "1h" });

    return res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      token,
    });
  } catch (error) {
    console.error("Admin login error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Admin - Get all professionals with verification status
app.get("/admin/professionals", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.name, u.email, u.profession, u.id_photo, u.selfie,
              v.id_photo_status, v.selfie_status, v.credentials_status, v.overall_status
       FROM users u
       LEFT JOIN verification v ON u.id = v.user_id
       WHERE u.role = 'professional'
       ORDER BY u.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Admin fetch professionals error:", err);
    res.status(500).json({ error: "Failed to fetch professionals" });
  }
});
// Admin - Get credentials for a professional
app.get("/admin/professionals/:userId/credentials", async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await db.query(
      "SELECT id, file_path, status, uploaded_at FROM credentials WHERE user_id=$1 ORDER BY uploaded_at DESC",
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Admin fetch credentials error:", err);
    res.status(500).json({ error: "Failed to fetch credentials" });
  }
});



const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
