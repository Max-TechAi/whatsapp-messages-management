// routes/auth.js
const express = require("express");
const router = express.Router();
const { db, auth } = require("../config/firebase");

router.post("/register", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await auth.createUser({
      email: email,
      password: password,
    });

    // تخزين بيانات المستخدم في Firestore
    await db.collection("users").doc(user.uid).set({
      email,
      createdAt: new Date(),
    });

    res.status(201).json({ message: "تم تسجيل المستخدم بنجاح", uid: user.uid });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/login", async (req, res) => {
  const { uid } = req.body;

  try {
    // تحقق من صحة UID
    const userRecord = await auth.getUser(uid);

    // تخزين معلومات المستخدم في Firestore
    await db.collection("users").doc(uid).set(
      {
        email: userRecord.email,
        lastLogin: new Date(),
      },
      { merge: true }
    );

    // سجل حركة الدخول
    await db.collection("logs").add({
      uid,
      action: "login",
      timestamp: new Date(),
    });

    // Redirect to index.html
    res.status(200).json({
      message: "User logged in and activity logged.",
      redirect: "/index.html",
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
