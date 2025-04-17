// firebaseAdmin.js
const admin = require("firebase-admin");
const serviceAccount = require("../serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
console.log("firebase admin initialized");

const auth = admin.auth();
const db = admin.firestore();

module.exports = { admin, db, auth };
