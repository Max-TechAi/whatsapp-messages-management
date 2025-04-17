const express = require("express");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");
const bodyParser = require("body-parser");
const authRoutes = require("./routes/auth");
const app = express();
const port = 3000;
const path = require("path");

app.get("/register", (req, res) => {
  res.sendFile(__dirname + "/public/register.html");
});

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/login.html");
});

app.use(express.static("public"));
app.use(express.json());

// ربط المسارات
app.use("/auth", authRoutes);

// First, add Socket.IO setup at the top of server.js after your existing requires
const http = require("http");
const socketIO = require("socket.io");
const server = http.createServer(app);
const io = socketIO(server);

// Set up Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("A user connected");

  socket.on("disconnect", () => {
    console.log("User disconnected");
  });
});

app.use(function (req, res, next) {
  var data = "";
  req.setEncoding("utf8");
  req.on("data", function (chunk) {
    data += chunk;
  });

  req.on("end", function () {
    req.body = data;
    next();
  });
});

// Store clients and conversations
const clients = {};
let conversations = {};
const testFolder = "./.wwebjs_auth/";
const fs = require("fs");
const { console } = require("inspector");

// Function to initialize a WhatsApp client
async function initializeClient(clientId) {
  const client = new Client({
    authStrategy: new LocalAuth({ clientId: clientId }), // Unique client ID
    puppeteer: {
      headless: true,
      // Add these options to help prevent authentication issues
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
      ],
    },
  });

  clients[clientId] = client;

  client.on("qr", async (qr) => {
    //console.log(`QR code data for client ${clientId}:`, qr); // Log raw QR code data
    const qrDataUrl = await qrcode.toDataURL(qr);
    //console.log(`QR code data URL for client ${clientId}:`, qrDataUrl); // Log data URL
    clients[clientId].qrCode = qrDataUrl;
  });

  client.on("ready", async () => {
    console.log(`Client ${clientId} is ready!`);
    clients[clientId].qrCode = null; // Clear QR code after authentication

    try {
      // Fetch all chats
      const chats = await client.getChats();
      console.log(`Syncing ${chats.length} chats for client ${clientId}`);

      // Process each chat
      for (const chat of chats) {
        try {
          // Skip status messages
          if (chat.id._serialized === "status@broadcast") continue;

          // Fetch last 100 messages for each chat
          const messages = await chat.fetchMessages({ limit: 10 });
          const conversationId = chat.id._serialized + clientId;

          // Initialize conversation if it doesn't exist
          if (!conversations[conversationId]) {
            conversations[conversationId] = {
              messages: [],
            };
          }
          var msgDate = new Date(
            messages[messages.length - 1].timestamp * 1000
          );
          if (
            messages.length > 0 &&
            msgDate.getDay() != new Date().getDay() &&
            msgDate.getDay() != new Date().getDay() - 1
          ) {
            break;
          }
          // Process each message
          for (const msg of messages) {
            // Skip if message already exists
            if (
              conversations[conversationId].messages.some(
                (m) => m.id === msg.id.id
              )
            ) {
              continue;
            }

            const contact = await msg.getContact();
            const isGroup = (chat.id.server = "g.us");
            // Get sender and receiver names
            let senderName, receiverName;
            if (isGroup) {
              senderName = contact.pushname || contact.number;
              receiverName = chat.name;
            } else {
              if (msg.fromMe) {
                senderName = `You (${clientId})`;
                receiverName = contact.pushname || contact.number;
              } else {
                senderName = contact.pushname || contact.number;
                receiverName = `You (${clientId})`;
              }
            }

            // Process message content
            let messageContent;
            const processedText = await processMentions(msg, client);

            // **Handle System Messages (Join, Leave, Promote, Demote, etc.)**
            if (msg.type === "gp2") {
              // For group update messages, we should check the actual message content
              // and the subtype of the message if available
              try {
                // Extract the actual message content
                let systemMessageText = "";

                // First check if there's a specific format we can extract from
                if (msg.author && msg.body) {
                  // Some system messages have an author and body
                  const authorContact = await client.getContactById(msg.author);
                  const authorName =
                    authorContact.pushname || authorContact.number;
                  systemMessageText = `${authorName} ${msg.body}`;
                } else {
                  // Otherwise use the raw body
                  systemMessageText = msg.body;
                }

                // Create the message content object
                messageContent = {
                  type: "system",
                  text: systemMessageText || "Group update",
                };
              } catch (error) {
                console.error("Error processing system message:", error);
                messageContent = {
                  type: "system",
                  text: msg.body || "Group update",
                };
              }
            } else if (msg.hasMedia) {
              const media = await msg.downloadMedia(); // Download the media file
              console.log("media message detected:", msg);
              let mediaExtension;
              if (media === undefined) {
                mediaExtension = "mp4";
              }
              // Detect file extension based on the filename or MIME type
              if (media.filename) {
                mediaExtension = media.filename.split(".").pop(); // Get the file extension from the filename
              } else {
                mediaExtension = media.mimetype.split("/")[1]; // Get the file extension from the MIME type
              }
              const mediaType = media.mimetype.split("/")[0];

              // Save the media file to the "public/media" directory
              const mediaDir = path.join(__dirname, "public", "media");
              if (!fs.existsSync(mediaDir)) {
                fs.mkdirSync(mediaDir, { recursive: true });
              }

              const mediaFileName = `${
                msg.filename ? msg.filename : msg.id.id
              }.${mediaExtension}`;
              const mediaFilePath = path.join(mediaDir, mediaFileName);
              fs.writeFileSync(mediaFilePath, media.data, {
                encoding: "base64",
              });

              // Store the media URL in the message content
              messageContent = {
                type: mediaType,
                url: `/media/${mediaFileName}`, // URL to access the media file
                filename: msg.filename || mediaFileName, // Original filename (if available)
                text: processedText,
              };
            } else {
              messageContent = {
                type: "text",
                text: processedText,
              };
            }

            // Handle quoted messages
            let quotedMessage = null;
            if (msg.hasQuotedMsg) {
              const quotedMsg = await msg.getQuotedMessage();
              const quotedContact = await quotedMsg.getContact();
              quotedMessage = {
                id: quotedMsg.id.id,
                sender: quotedContact.pushname || quotedContact.number,
                content: {
                  type: "text",
                  text: quotedMsg.body,
                },
              };

              if (quotedMsg.hasMedia) {
                const quotedMedia = await quotedMsg.downloadMedia();
                quotedMessage.content.type = quotedMedia.mimetype.split("/")[0];
                quotedMessage.content.text = quotedMsg.body || "Media message";
              }
            }

            // Create message object
            const messageObj = {
              id: msg.id.id,
              chatid: chat.id._serialized,
              clientId: clientId,
              lastMessage: processedText,
              type: msg.fromMe ? "sent" : "received",
              senderName: senderName,
              receiverName: receiverName,
              isGroup: isGroup,
              content: messageContent,
              quotedMessage: quotedMessage,
              hasQuotedMsg: msg.hasQuotedMsg,
              timestamp: msg.timestamp
                ? new Date(msg.timestamp * 1000)
                : new Date(), // Convert to milliseconds
              status: msg.fromMe ? getMsgStatus(msg.ack) : "Coming Msg",
              conversationId,
              ack: msg.fromMe ? msg.ack : undefined,
            };

            conversations[conversationId].messages.push(messageObj);
          }

          // Sort messages by timestamp
          conversations[conversationId].messages.sort(
            (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
          );

          // Emit update for the UI
          io.emit("conversationSynced", {
            clientId,
            conversationId,
            messages: conversations[conversationId].messages,
          });
        } catch (chatError) {
          console.error(
            `Error syncing chat ${chat.id._serialized}:`,
            chatError
          );
        }
      }

      console.log(`Completed syncing chats for client ${clientId}`);
    } catch (error) {
      console.error(`Error during chat sync for client ${clientId}:`, error);
    }
  });

  client.on("message_revoke_everyone", async (after, before) => {
    if (!before) return; // The message was deleted before syncing, so ignore it.

    const conversationId = before.from + clientId; // Identify the chat
    if (!conversations[conversationId]) return; // Ensure chat exists in our storage

    // Find and update the message
    const messageIndex = conversations[conversationId].messages.findIndex(
      (m) => m.id === before.id.id
    );
    if (messageIndex !== -1) {
      conversations[conversationId].messages[messageIndex].content = {
        type: "deleted",
        text: "This message was deleted",
      };

      // Notify frontend that a message was deleted
      io.emit("messageDeleted", {
        conversationId,
        messageId: before.id.id,
      });

      console.log(`Message deleted in chat: ${conversationId}`);
    }
  });

  // Add disconnected event handler
  client.on("disconnected", async (reason) => {
    try {
      // Remove client from active clients
      delete clients[clientId];

      // Clear conversations for this client
      Object.keys(conversations).forEach((convId) => {
        if (convId.includes(clientId)) {
          delete conversations[convId];
        }
      });

      // Notify connected clients about disconnection
      // io.emit('clientDisconnected', {
      //     clientId,
      //     reason
      // });

      // Attempt cleanup after ensuring client is fully stopped
      await client.destroy();

      // Remove authentication data
      const authPath = path.join(
        __dirname,
        ".wwebjs_auth",
        `session-${clientId}`
      );
      if (fs.existsSync(authPath)) {
        try {
          fs.rmSync(authPath, { recursive: true, force: true });
          console.log(`Removed auth data for client ${clientId}`);
        } catch (fsError) {
          console.error(
            `Error removing auth data for client ${clientId}:`,
            fsError
          );
        }
      }
    } catch (error) {
      console.error(`Error handling disconnect for client ${clientId}:`, error);
    }
  });

  // Add authentication failure handler
  client.on("auth_failure", async (msg) => {
    console.log(`Authentication failed for client ${clientId}:`, msg);

    try {
      // Clean up on authentication failure
      if (clients[clientId]) {
        await clients[clientId].destroy();
        delete clients[clientId];
      }
      await deleteSessionDirectory(clientId);
    } catch (error) {
      console.error(
        `Error handling auth failure for client ${clientId}:`,
        error
      );
    }
  });

  client.on("change_state", async (state) => {
    console.log(`Client ${clientId} state changed to:`, state);
    if (state === "UNPAIRED" || state === "CONFLICT") {
      await deleteSessionDirectory(clientId);
    }
  });

  // Track received messages
  client.on("message", async (msg) => {
    const isGroup = msg.from.endsWith("@g.us"); // Check if the message is from a group
    const contact = await msg.getContact();
    const conversationId = msg.from + clientId; // Use the sender's ID as the conversation ID

    // Check if the message is a status update
    if (msg.from === "status@broadcast") return; // Skip processing this message

    let senderName, receiverName;
    if (isGroup) {
      const chat = await msg.getChat();
      senderName = contact.pushname || contact.number; // Sender name (individual in the group)
      receiverName = chat.name; // Group name
    } else {
      senderName = contact.pushname || contact.number; // Sender name
      receiverName = `You (${clientId})`; // Receiver is the client
    }
    if (!conversations[conversationId]) {
      conversations[conversationId] = {
        messages: [],
      };
    }

    const messageId = msg.id.id;

    const processedText = await processMentions(msg, client);

    // Ignore empty messages ("" or null)
    if (!processedText.trim() && !msg.hasMedia) {
      console.log(`Skipping empty message from ${msg.from}`);
      return;
    }
    // Check if the message contains media (image, audio, etc.)
    // Check if the message contains media (image, audio, document, etc.)
    if (msg.hasMedia) {
      const media = await msg.downloadMedia(); // Download the media file
      let mediaExtension;

      // Detect file extension based on the filename or MIME type
      if (media.filename) {
        mediaExtension = media.filename.split(".").pop(); // Get the file extension from the filename
      } else {
        mediaExtension = media.mimetype.split("/")[1]; // Get the file extension from the MIME type
      }
      const mediaType = media.mimetype.split("/")[0];

      // Save the media file to the "public/media" directory
      const mediaDir = path.join(__dirname, "public", "media");
      if (!fs.existsSync(mediaDir)) {
        fs.mkdirSync(mediaDir, { recursive: true });
      }

      const mediaFileName = `${messageId}.${mediaExtension}`;
      const mediaFilePath = path.join(mediaDir, mediaFileName);
      fs.writeFileSync(mediaFilePath, media.data, { encoding: "base64" });

      // Store the media URL in the message content
      messageContent = {
        type: mediaType,
        url: `/media/${mediaFileName}`, // URL to access the media file
        filename: msg.filename || mediaFileName, // Original filename (if available)
        text: processedText,
      };
    } else {
      // For text messages
      messageContent = {
        type: "text",
        text: processedText,
      };
    }

    // Handle quoted message
    let quotedMessage = null;
    if (msg.hasQuotedMsg) {
      const quotedMsg = await msg.getQuotedMessage();
      const quotedContact = await quotedMsg.getContact();
      quotedMessage = {
        id: quotedMsg.id.id,
        sender: quotedContact.pushname || quotedContact.number,
        content: {
          type: "text",
          text: quotedMsg.body,
        },
      };

      // If quoted message has media
      if (quotedMsg.hasMedia) {
        const quotedMedia = await quotedMsg.downloadMedia();
        quotedMessage.content.type = quotedMedia.mimetype.split("/")[0];
        quotedMessage.content.text = quotedMsg.body || "Media message";
      }
    }

    var chatid = (await msg.getChat()).id._serialized;
    var msgObj = {
      id: msg.id.id,
      chatid,
      clientId: clientId, // Add client ID to track which client received/sent the message
      lastMessage: processedText,
      type: "received",
      senderName: senderName,
      receiverName: receiverName,
      isGroup: isGroup,
      content: messageContent,
      quotedMessage: quotedMessage, // Add quoted message if exists
      hasQuotedMsg: msg.hasQuotedMsg, // Flag to indicate if message is a reply
      timestamp: new Date(),
      status: "Coming Msg",
      conversationId,
    };
    conversations[conversationId].messages.push(msgObj);

    // After adding the message to conversations, emit an update
    io.emit("messageReceived", {
      conversationId,
      message: msgObj,
    });
  });

  // Track sent messages
  client.on("message_create", async (msg) => {
    if (msg.fromMe) {
      // Check if the message was sent by the client
      const isGroup = msg.to.endsWith("@g.us"); // Check if the message is to a group
      const contact = await msg.getContact();
      const conversationId = msg.to + clientId; // Use the recipient's ID as the conversation ID
      // Check if the message is a status update
      if (msg.to === "status@broadcast") return;
      let senderName, receiverName;
      //if (isGroup) {
      const chat = await msg.getChat();
      senderName = `You (${clientId})`; // Sender is the client
      receiverName = chat.name; // Group name
      // } else {
      //     senderName = `You (${clientId})`; // Sender is the client
      //     receiverName = contact.pushname || contact.number; // Receiver name
      // }
      if (!conversations[conversationId]) {
        conversations[conversationId] = {
          messages: [],
        };
      }

      const messageId = msg.id.id;
      let messageContent;

      const processedText = await processMentions(msg, client);

      // Ignore empty messages ("" or null)
      if (!processedText.trim() && !msg.hasMedia) {
        console.log(`Skipping empty message from ${msg.from}`);
        return;
      }

      // Check if the message contains media (image, audio, etc.)
      if (msg.hasMedia) {
        const media = await msg.downloadMedia(); // Download the media file
        let mediaExtension;

        // Detect file extension based on the filename or MIME type
        // Detect file extension based on the filename or MIME type
        if (media.filename) {
          mediaExtension = media.filename.split(".").pop(); // Get the file extension from the filename
        } else {
          mediaExtension = media.mimetype.split("/")[1]; // Get the file extension from the MIME type
        }
        const mediaType = media.mimetype.split("/")[0];

        // Save the media file to the "public/media" directory
        const mediaDir = path.join(__dirname, "public", "media");
        if (!fs.existsSync(mediaDir)) {
          fs.mkdirSync(mediaDir, { recursive: true });
        }

        const mediaFileName = `${messageId}.${mediaExtension}`;
        const mediaFilePath = path.join(mediaDir, mediaFileName);
        fs.writeFileSync(mediaFilePath, media.data, { encoding: "base64" });

        // Store the media URL in the message content
        messageContent = {
          type: mediaType,
          url: `/media/${mediaFileName}`, // URL to access the media file
          filename: msg.filename || mediaFileName, // Original filename (if available)
          text: processedText,
        };
      } else {
        // For text messages
        messageContent = {
          type: "text",
          text: processedText,
        };
      }

      // Handle quoted message
      let quotedMessage = null;
      if (msg.hasQuotedMsg) {
        const quotedMsg = await msg.getQuotedMessage();
        const quotedContact = await quotedMsg.getContact();
        quotedMessage = {
          id: quotedMsg.id.id,
          sender: quotedContact.pushname || quotedContact.number,
          content: {
            type: "text",
            text: quotedMsg.body,
          },
        };

        // If quoted message has media
        if (quotedMsg.hasMedia) {
          const quotedMedia = await quotedMsg.downloadMedia();
          quotedMessage.content.type = quotedMedia.mimetype.split("/")[0];
          quotedMessage.content.text = quotedMsg.body || "Media message";
        }
      }
      var msgObj = {
        id: msg.id.id,
        chatid: chat.id._serialized,
        clientId: clientId, // Add client ID to track which client received/sent the message
        lastMessage: processedText,
        type: "sent",
        senderName: senderName,
        receiverName: receiverName,
        isGroup: isGroup,
        content: messageContent,
        quotedMessage: quotedMessage, // Add quoted message if exists
        hasQuotedMsg: msg.hasQuotedMsg, // Flag to indicate if message is a reply
        timestamp: new Date(),
        status: getMsgStatus(msg.ack),
        conversationId,
        ack: msg.ack,
      };

      conversations[conversationId].messages.push(msgObj);

      io.emit("messageSent", {
        conversationId,
        message: msgObj,
      });
    }
  });

  client.on("message_ack", (msg, ack) => {
    try {
      const conversationId = msg.to + clientId; // Use the sender's ID as the conversation ID

      if (conversations[conversationId]) {
        const message = conversations[conversationId].messages.find(
          (m) => m.id === msg.id.id
        );
        if (message) {
          message.status = getMsgStatus(ack); // Update the message status
          message.ack = ack; // Update the message status
          io.emit("statusUpdated", {
            conversationId,
            status: getMsgStatus(ack),
            ack,
          });
          console.log(
            `Message status updated for client ${message.clientId}:`,
            ack
          );
        }
      }
    } catch (error) {
      console.log("error", error);
    }
  });

  await client.initialize();

  //var chats =  client.getChats();
}

// Function to delete session directory
async function deleteSessionDirectory(clientId) {
  try {
    const sessionPath = path.join(
      __dirname,
      ".wwebjs_auth",
      `session-${clientId}`
    );
    await rmdir(sessionPath, { recursive: true });
    console.log(`Session directory deleted for client: ${clientId}`);
  } catch (error) {
    console.error(
      `Error deleting session directory for client ${clientId}:`,
      error
    );
  }
}

// Add this function to handle client disconnection cleanup
async function handleClientDisconnection(clientId) {
  try {
    console.log(`Starting cleanup for client ${clientId}`);

    // Get the client instance
    const client = clients[clientId];
    if (!client) {
      console.log(`Client ${clientId} already removed`);
      return;
    }

    // Clear any conversations for this client
    Object.keys(conversations).forEach((convId) => {
      if (convId.includes(clientId)) {
        delete conversations[convId];
      }
    });

    // Attempt graceful logout
    try {
      await client.logout();
    } catch (logoutError) {
      console.error(`Error during logout for client ${clientId}:`, logoutError);
    }

    // Destroy the client instance
    try {
      await client.destroy();
    } catch (destroyError) {
      console.error(`Error destroying client ${clientId}:`, destroyError);
    }

    // Remove client from clients object
    delete clients[clientId];

    // Remove authentication data
    const authPath = path.join(
      __dirname,
      ".wwebjs_auth",
      `session-${clientId}`
    );
    if (fs.existsSync(authPath)) {
      try {
        fs.rmSync(authPath, { recursive: true, force: true });
        console.log(`Removed auth data for client ${clientId}`);
      } catch (fsError) {
        console.error(
          `Error removing auth data for client ${clientId}:`,
          fsError
        );
      }
    }

    // Emit disconnection event to all connected socket clients
    io.emit("client_disconnected", {
      clientId,
      timestamp: new Date(),
      message: "WhatsApp client disconnected",
    });

    console.log(`Cleanup completed for client ${clientId}`);
  } catch (error) {
    console.error(`Error during cleanup for client ${clientId}:`, error);
  }
}

function getMsgStatus(stat) {
  return stat === 3
    ? "Readed"
    : stat === 1
    ? "Sent"
    : stat === 2
    ? "Delivered"
    : "Not sent";
}
// Add this helper function at the top level
async function processMentions(msg, client) {
  if (!msg.mentionedIds || msg.mentionedIds.length === 0) {
    return msg.body;
  }

  let messageText = msg.body;

  // Process each mention
  for (const mentionId of msg.mentionedIds) {
    try {
      const contact = await client.getContactById(
        typeof mentionId === "string" ? mentionId : mentionId._serialized
      );
      const displayName =
        contact.pushname || contact.shortName || contact.name || contact.number;
      // Replace the number-based mention with the contact's name
      messageText = messageText.replace(
        `@${(mentionId === "string"
          ? mentionId
          : mentionId._serialized
        ).replace("@c.us", "")}`,
        `@${displayName}`
      );
    } catch (error) {
      console.error(`Error processing mention for ${mentionId}:`, error);
    }
  }

  return messageText;
}

// Route to initialize all clients
app.post("/initializeClients", async (req, res) => {
  console.log("start initialize clients");

  //  const filename = path.basename('/.wwebjs_auth/session-office-01');
  //  console.log("filename",filename.replace("session-",""))

  const files = await fs.readdirSync(testFolder);
  let clientId = "";
  for (const file of files) {
    clientId = file.replace("session-", "");
    if (clients[clientId] === undefined) {
      await initializeClient(clientId);
      deleteNotConnectedClient(clientId);
    } else {
      deleteNotConnectedClient(clientId);
    }
  }
  res.json({ status: true });
  // Generate a unique client ID
  //const clientId = `clientName-${Object.keys(clients).length + 1}`; // Generate a unique client ID
});

// Route to send a reply
app.post("/replyconversation", async (req, res) => {
  const { clientId, message, chatid, userName } = JSON.parse(req.body);
  const client = clients[clientId];
  try {
    if (client) {
      try {
        const messageWithUserName = `${message}\n\n<div class='message-sentby'>Sent by: ${userName}</div>`; // Append userName to the message
        await client.sendMessage(chatid, messageWithUserName);
        res.json({ success: true });
      } catch (error) {
        console.error("Error sending message:", error);
        res.status(200).json({
          errormsg: "Failed to send message",
          clientId,
          message,
          chatid,
          error: error.message,
        });
      }
    } else {
      res.status(404).json({ error: "Client not found" });
    }
  } catch (error) {
    console.error("Error sending message:", error);
    res.status(500).json({
      errormsg: "Failed to send message",
      clientId,
      message,
      chatid,
      error,
    });
  }
});

async function deleteNotConnectedClient(clientId) {
  setTimeout(async () => {
    var stat = await clients[clientId].getState();
    console.log("clientId***" + clientId + "|", stat);
    if (stat != "CONNECTED") {
      clients[clientId].logout();
      delete clients[clientId];
    }
  }, 5000);
}

// Route to add a new client
app.post("/add-client/:clientName", async (req, res) => {
  console.log("add-client");
  const clientId = req.params.clientName;
  if (clientId.length === 0) {
    res.status(400).json({ error: "Client name is empty" });
    return;
  }
  if (clientId.split(" ").length > 1) {
    res.status(400).json({ error: "Client name cannot contain spaces" });
    return;
  }
  if (clients[clientId] !== undefined) {
    res.status(400).json({ error: "Client name already exists" });
    return;
  }
  //const clientId = `clientName-${Object.keys(clients).length + 1}`; // Generate a unique client ID
  await initializeClient(clientId);
  setTimeout(async () => {
    var stat = await clients[clientId].getState();
    console.log("clientId***" + clientId + "|", stat);
    if (JSON.parse(req.body).isInit && stat != "CONNECTED") {
      clients[clientId].logout();
      delete clients[clientId];
    }
    res.json({ clientId: clientId, status: stat });
  }, 2000);
});

// Route to get the QR code for a client
app.get("/qr-code/:clientId", (req, res) => {
  const clientId = req.params.clientId;
  console.log(`Fetching QR code for client: ${clientId}`);
  const client = clients[clientId];
  if (client && client.qrCode) {
    console.log(`QR code found for client: ${clientId}`);
    res.json({ qrCode: client.qrCode });
  } else {
    console.log(`QR code not found for client: ${clientId}`);
    res.status(404).json({ error: "QR code not found" });
  }
});

// Route to fetch conversations
app.get("/conversations", (req, res) => {
  const formattedConversations = Object.entries(conversations)
    .filter(([e, msg]) => msg.messages.length > 0)
    .map(([conversationId, msg]) => {
      return msg.messages[msg.messages.length - 1];
    });
  res.json({
    conversations: formattedConversations,
    clintscount: Object.keys(clients).length,
  });
});

// Route to fetch conversation details
app.get("/conversation/:conversationId", (req, res) => {
  const conversationId = req.params.conversationId;
  const conversation = conversations[conversationId];
  if (conversation) {
    res.json({ conversations: conversation.messages });
  } else {
    res.status(404).json({ error: "Conversation not found" });
  }
});

app.get("/availablechats/:clientId", async (req, res) => {
  try {
    const clientId = req.params.clientId;
    const client = clients[clientId];
    const chats = await client.getChats();
    res.json({ chats: chats });
  } catch (error) {
    console.error("Error fetching chats:", error);
    res.status(500).json({ error: "Failed to fetch chats" });
  }
});

app.post("/forwardtochat", async (req, res) => {
  try {
    const reqbody = JSON.parse(req.body);
    const selectedMessage = reqbody.selectedMessage;
    const chatId = reqbody.chatId;

    // Get the client instance
    const client = clients[selectedMessage.clientId];
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    try {
      // Get the original chat where the message is from
      const chat = await client.getChatById(selectedMessage.chatid);
      if (!chat) {
        return res.status(404).json({ error: "Original chat not found" });
      }

      // Fetch the specific message using the message ID
      const messages = await chat.fetchMessages({ limit: 100 }); // Adjust limit as needed
      const messageToForward = messages.find(
        (msg) => msg.id.id === selectedMessage.id
      );

      if (!messageToForward) {
        return res.status(404).json({ error: "Original message not found" });
      }

      // Forward the message to the target chat
      await messageToForward.forward(chatId);

      //
      return res.status(200).json({
        success: true,
        status: "Message forwarded successfully",
      });
    } catch (error) {
      console.error("Error in message forwarding:", error);
      return res.status(500).json({
        error: "Failed to forward message",
        details: error.message,
      });
    }
  } catch (error) {
    console.error("Error processing request:", error);
    return res.status(500).json({
      error: "Failed to process forward request",
      details: error.message,
    });
  }
});

app.post("/replytomsg", async (req, res) => {
  try {
    const reqbody = JSON.parse(req.body);
    const selectedMessage = reqbody.selectedMessage;
    const replyText = reqbody.replyText || "test reply"; // Allow custom reply text

    // Get the client instance
    const client = clients[selectedMessage.clientId];
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    try {
      // Get the chat where the message is from
      const chat = await client.getChatById(selectedMessage.chatid);
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }

      // Fetch the message that we want to reply to
      const messages = await chat.fetchMessages({ limit: 100 });
      const messageToReplyTo = messages.find(
        (msg) => msg.id.id === selectedMessage.id
      );

      if (!messageToReplyTo) {
        return res.status(404).json({ error: "Original message not found" });
      }

      // Use the message object directly for reply
      await messageToReplyTo.reply(replyText);

      return res.status(200).json({
        success: true,
        status: "Message replied successfully",
      });
    } catch (error) {
      console.error("Error in message reply:", error);
      return res.status(500).json({
        error: "Failed to reply to message",
        details: error.message,
      });
    }
  } catch (error) {
    console.error("Error processing request:", error);
    return res.status(500).json({
      error: "Failed to process reply request",
      details: error.message,
    });
  }
});

// Start the server
server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
